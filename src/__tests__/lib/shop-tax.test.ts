/**
 * Phase 1c (2 Oct 2026) — the shop's GST status decides whether its bills
 * carry GST and whether the GST it pays is cost. (#165, #175)
 *
 * Section 32(1) CGST Act: a person who is not registered shall not collect any
 * amount by way of tax. Section 10(4): a composition dealer shall not collect
 * tax nor take input credit. EkBook had no registration status at all, so a
 * shop with no GSTIN charged GST on every bill.
 *
 * Master plan v3, Phase 1 proof: "a not-registered shop's bill carries no tax".
 */
import fs from 'fs'
import path from 'path'
import { computeLineItems } from '@/lib/line-items'
import {
  gstStatus, chargesGstOnSales, claimsInputCredit, isOutwardDocument, lineCarriesGst, resolveGstRegistration,
  type GstStatus,
} from '@/lib/shop-tax'
import { purchaseCostPerUnit } from '@/lib/unit-profit'

const ALL: GstStatus[] = ['unregistered', 'regular', 'composition']

describe('gstStatus()', () => {
  test('not registered is the default — nothing set means no GST', () => {
    expect(gstStatus(undefined)).toBe('unregistered')
    expect(gstStatus(null)).toBe('unregistered')
    expect(gstStatus({})).toBe('unregistered')
    expect(gstStatus({ gstRegistered: false })).toBe('unregistered')
  })
  test('registered without a category is regular', () => {
    expect(gstStatus({ gstRegistered: true })).toBe('regular')
    expect(gstStatus({ gstRegistered: true, compositionCategory: null })).toBe('regular')
  })
  test('a composition category is composition, whatever the flag says', () => {
    expect(gstStatus({ gstRegistered: true, compositionCategory: 'trader' })).toBe('composition')
    expect(gstStatus({ gstRegistered: false, compositionCategory: 'service' })).toBe('composition')
  })
})

describe('what each status may do', () => {
  test('only a regular registration charges GST on sales or claims it back', () => {
    expect(ALL.filter(chargesGstOnSales)).toEqual(['regular'])
    expect(ALL.filter(claimsInputCredit)).toEqual(['regular'])
  })
  test('outward documents are the ones the shop issues', () => {
    expect(['sale', 'credit-note', 'estimate'].every(isOutwardDocument)).toBe(true)
    expect(['purchase', 'debit-note', 'expense', 'income'].some(isOutwardDocument)).toBe(false)
  })
  test('a supplier\'s bill keeps its GST for every status; the shop\'s own bills follow the status', () => {
    for (const st of ALL) {
      expect(lineCarriesGst(st, 'purchase')).toBe(true)
      expect(lineCarriesGst(st, 'debit-note')).toBe(true)
      expect(lineCarriesGst(st, 'sale')).toBe(st === 'regular')
      expect(lineCarriesGst(st, 'credit-note')).toBe(st === 'regular')
      expect(lineCarriesGst(st, 'estimate')).toBe(st === 'regular')
    }
  })
})

function bill(type: string, chargesGst: boolean, opts: { mrp?: boolean; qty?: number; price?: number; rate?: number } = {}) {
  const { mrp = false, qty = 3, price = 255, rate = 5 } = opts
  const product = { id: 'p1', name: 'Atta', unit: 'pcs', salePrice: price, purchasePrice: 230, gstRate: rate, priceIncludesGst: mrp }
  return computeLineItems({
    items: [{ productId: 'p1', productName: 'Atta', quantity: qty, unitPrice: price, gstRate: rate, unit: 'pcs', priceIncludesGst: mrp }],
    productMap: new Map([['p1', product]]),
    isInterState: false, orderDiscount: 0, type, chargesGst,
  })
}

describe('#165 — a not-registered shop\'s bill carries no tax', () => {
  test('every rate, every outward document, MRP or not: zero GST, total = qty × price', () => {
    for (const rate of [0.25, 3, 5, 12, 18, 28, 40]) {
      for (const type of ['sale', 'credit-note', 'estimate']) {
        for (const mrp of [true, false]) {
          const r = bill(type, false, { mrp, rate, qty: 7, price: 99.5 })
          expect(r.cgst + r.sgst + r.igst).toBe(0)
          expect(r.totalBeforeRoundOff).toBe(696.5)
          expect(r.txItems[0].gstRate).toBe(0)
        }
      }
    }
  })
  test('the same sale for a regular shop still carries GST', () => {
    const r = bill('sale', true, { mrp: true })
    expect(r.totalBeforeRoundOff).toBe(765)
    expect(r.cgst + r.sgst).toBeCloseTo(36.43, 2)
  })
})

describe('purchases keep the supplier\'s GST whatever the shop\'s status', () => {
  test('₹230 + 5% from a supplier is ₹241.50 for a not-registered or composition buyer too', () => {
    for (const chargesGst of [true, false]) {
      const r = bill('purchase', chargesGst, { qty: 1, price: 230 })
      expect(r.totalBeforeRoundOff).toBe(241.5)
      expect(r.cgst + r.sgst).toBe(11.5)
    }
  })
  test('the old composition switch (isComposition) no longer strips a purchase\'s GST', () => {
    const r = computeLineItems({
      items: [{ productId: null, productName: 'X', quantity: 1, unitPrice: 230, gstRate: 5, unit: 'pcs' }],
      productMap: new Map(), isInterState: false, orderDiscount: 0, type: 'purchase', isComposition: true,
    })
    expect(r.totalBeforeRoundOff).toBe(241.5)
  })
})

describe('#175 — the GST is part of the cost when it cannot be claimed back', () => {
  test('₹230 + 5%: cost ₹230 with credit, ₹241.50 without', () => {
    expect(purchaseCostPerUnit({ unitPrice: 230, gstRate: 5 }, { claimsItc: true })).toBe(230)
    expect(purchaseCostPerUnit({ unitPrice: 230, gstRate: 5 }, { claimsItc: false })).toBe(241.5)
  })
  test('an MRP-style purchase line (₹219.05 before GST) costs ₹230 without credit', () => {
    expect(purchaseCostPerUnit({ unitPrice: 219.05, gstRate: 5 }, { claimsItc: false })).toBe(230)
  })
  test('0% GST is the same either way', () => {
    expect(purchaseCostPerUnit({ unitPrice: 120, gstRate: 0 }, { claimsItc: false })).toBe(120)
  })
})

describe('resolveGstRegistration() — settings stay consistent', () => {
  test('not registered clears the scheme', () => {
    expect(resolveGstRegistration(false, undefined)).toEqual({ gstRegistered: false, clearComposition: true })
    expect(resolveGstRegistration(false, null)).toEqual({ gstRegistered: false, clearComposition: true })
  })
  test('a category means registered', () => {
    expect(resolveGstRegistration(undefined, 'trader')).toEqual({ gstRegistered: true, clearComposition: false })
    expect(resolveGstRegistration(true, 'trader')).toEqual({ gstRegistered: true, clearComposition: false })
  })
  test('both "not registered" and a category is refused, not guessed', () => {
    expect('error' in resolveGstRegistration(false, 'trader')).toBe(true)
  })
  test('a non-boolean is refused', () => {
    expect('error' in resolveGstRegistration('yes', undefined)).toBe(true)
  })
  test('nothing sent changes nothing', () => {
    expect(resolveGstRegistration(undefined, undefined)).toEqual({ gstRegistered: undefined, clearComposition: false })
  })
})

/**
 * THE CLASS: every place that calculates a bill must say whether the shop
 * charges GST. Estimate → sale and the bill screen's preview both forgot (the
 * composition switch existed only on two server routes), so a composition shop's
 * converted estimate charged GST and the preview showed GST the server removed.
 */
function computeCallsWithoutChargesGst(source: string): number[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, b => b.replace(/[^\n]/g, ''))
    .replace(/(^|[ \t])\/\/[^\n]*/gm, (_m, lead) => lead)
  const out: number[] = []
  const re = /computeLineItems\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    let depth = 0
    let j = code.indexOf('{', m.index)
    const start = j
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++
      else if (code[j] === '}' && --depth === 0) break
    }
    if (!/\bchargesGst\s*:/.test(code.slice(start, j))) out.push(code.slice(0, m.index).split(/\r?\n/).length)
  }
  return out
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('guard — every bill calculation passes the shop\'s GST status', () => {
  test('catches a call without chargesGst, including a nested object', () => {
    expect(computeCallsWithoutChargesGst(`const r = computeLineItems({\n items: x.map(i => ({ a: 1 })),\n type: 'sale',\n})`)).toEqual([1])
  })
  test('passes a call with it, and ignores a comment that mentions it', () => {
    expect(computeCallsWithoutChargesGst(`computeLineItems({ items, type, chargesGst: true })`)).toEqual([])
    expect(computeCallsWithoutChargesGst(`computeLineItems({ items, type, // chargesGst: false\n })`)).toEqual([1])
  })
  test('sweep: no call in src leaves it out, and the sweep sees them all', () => {
    const root = path.join(__dirname, '..', '..')
    const offenders: string[] = []
    let calls = 0
    for (const file of sourceFiles(root)) {
      const src = fs.readFileSync(file, 'utf8')
      calls += (src.match(/computeLineItems\(\s*\{/g) || []).length
      for (const line of computeCallsWithoutChargesGst(src)) {
        offenders.push(`${path.relative(path.join(root, '..'), file).replace(/\\/g, '/')}:${line}`)
      }
    }
    expect(offenders).toEqual([])
    // POST, PUT, estimate convert, bill screen preview, scanner preview.
    expect(calls).toBeGreaterThanOrEqual(5)
  })
})
