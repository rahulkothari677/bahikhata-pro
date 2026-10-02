/**
 * Phase 1b-2 (2 Oct 2026) — a line refilled from a saved bill charges what the
 * original charged, and a supplier's rate never borrows the product's MRP flag.
 *
 * #130: "Load all items from original sale" put the stored EX-GST price into a
 *       line that still followed the product's "price includes GST" flag, so
 *       GST came out twice — a full return of a ₹765.01 sale refunded ₹728.60.
 * #173: "Repeat Last Sale" refilled every line at ₹0 (the list API carries no
 *       prices); the fix reads the bill and refills the same way as a return.
 * Estimate → sale convert had the #130 fault on the server.
 * #135: a purchase took the product's SALE-side flag, so a ₹230 supplier cost
 *       became ₹219.05 + GST.
 *
 * Swept, not sampled: every quantity 1–300 × ten MRPs × every rate.
 */
import fs from 'fs'
import path from 'path'
import { computeLineItems } from '@/lib/line-items'
import { refillPrice, resolveLineIncludesGst } from '@/lib/refill-line'

const toPaise = (r: number) => Math.round(r * 100)

const MRP_PRODUCT = (mrp: number, rate: number) => ({
  id: 'p1', name: 'MRP Atta', unit: 'pcs', salePrice: mrp, purchasePrice: 0,
  gstRate: rate, priceIncludesGst: true,
})

/** The original sale, as the bill screen sends it for an MRP product. */
function originalSale(qty: number, mrp: number, rate: number) {
  const product = MRP_PRODUCT(mrp, rate)
  return computeLineItems({
    items: [{ productId: 'p1', productName: product.name, quantity: qty, unitPrice: mrp, gstRate: rate, unit: 'pcs', priceIncludesGst: true }],
    productMap: new Map([['p1', product]]),
    isInterState: false, orderDiscount: 0, type: 'sale',
  })
}

/**
 * Refill one stored line the way every refill path now does, then recompute.
 * `priceIncludesGst` is what the bill screen will send for that line: its own
 * value — never the product's flag.
 */
function refilled(stored: any, product: any, type: 'sale' | 'credit-note') {
  return computeLineItems({
    items: [{ productId: 'p1', productName: stored.productName, quantity: stored.enteredQuantity ?? stored.quantity, ...refillPrice(stored), gstRate: stored.gstRate, unit: stored.enteredUnit ?? stored.unit }],
    productMap: new Map([['p1', product]]),
    isInterState: false, orderDiscount: 0, type,
  })
}

const MRPS = [1, 9.99, 10, 25.5, 99, 110, 230, 255, 1199, 4999.99]
const RATES = [0.25, 1.5, 3, 5, 12, 18, 28, 40]

describe('refillPrice()', () => {
  test('a line saved with its typed price comes back as typed, with its own setting', () => {
    expect(refillPrice({ unitPrice: 242.86, enteredPrice: 255, priceIncludesGst: true })).toEqual({ unitPrice: 255, priceIncludesGst: true })
    expect(refillPrice({ unitPrice: 230, enteredPrice: 230, priceIncludesGst: false })).toEqual({ unitPrice: 230, priceIncludesGst: false })
  })

  test('a line saved before 2 Oct 2026 comes back ex-GST with the setting OFF', () => {
    expect(refillPrice({ unitPrice: 242.86, enteredPrice: null, priceIncludesGst: null })).toEqual({ unitPrice: 242.86, priceIncludesGst: false })
    expect(refillPrice({ unitPrice: 242.86 })).toEqual({ unitPrice: 242.86, priceIncludesGst: false })
  })

  test('an enteredPrice of 0 is a real price (a free line), not "missing"', () => {
    expect(refillPrice({ unitPrice: 0, enteredPrice: 0, priceIncludesGst: true })).toEqual({ unitPrice: 0, priceIncludesGst: true })
  })
})

describe('#130 / #173 — a refilled MRP line charges exactly what the original charged', () => {
  test('every quantity 1–300 × ten MRPs × every rate: full return = sale, repeat = sale', () => {
    const failures: string[] = []
    for (const rate of RATES) {
      for (const mrp of MRPS) {
        const product = MRP_PRODUCT(mrp, rate)
        for (let qty = 1; qty <= 300; qty++) {
          const sale = originalSale(qty, mrp, rate)
          const stored = sale.txItems[0]
          const ret = refilled(stored, product, 'credit-note')
          const again = refilled(stored, product, 'sale')
          if (toPaise(ret.totalBeforeRoundOff) !== toPaise(sale.totalBeforeRoundOff)
            || toPaise(again.totalBeforeRoundOff) !== toPaise(sale.totalBeforeRoundOff)
            || toPaise(ret.cgst + ret.sgst) !== toPaise(sale.cgst + sale.sgst)) {
            failures.push(`${qty} × ₹${mrp} @${rate}%: sale ₹${sale.totalBeforeRoundOff}, return ₹${ret.totalBeforeRoundOff}, repeat ₹${again.totalBeforeRoundOff}`)
            if (failures.length > 10) break
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  test('the case seen first-hand: 3 × ₹255 @5% returns ₹765, not ₹728.60', () => {
    const sale = originalSale(3, 255, 5)
    expect(sale.totalBeforeRoundOff).toBe(765)
    expect(refilled(sale.txItems[0], MRP_PRODUCT(255, 5), 'credit-note').totalBeforeRoundOff).toBe(765)
  })

  test('the OLD refill (stored ex-GST price, product flag) is still wrong — so the sweep above can fail', () => {
    const sale = originalSale(3, 255, 5)
    const stored = sale.txItems[0]
    const old = computeLineItems({
      items: [{ productId: 'p1', productName: stored.productName, quantity: stored.quantity, unitPrice: stored.unitPrice, gstRate: 5, unit: 'pcs' }],
      productMap: new Map([['p1', MRP_PRODUCT(255, 5)]]),
      isInterState: false, orderDiscount: 0, type: 'credit-note',
    })
    expect(old.totalBeforeRoundOff).toBeLessThan(729)
  })

  test('a line saved before the new columns refills within rounding paise, never by the GST', () => {
    for (const rate of RATES) {
      for (const mrp of MRPS) {
        for (const qty of [1, 3, 7, 50, 299]) {
          const sale = originalSale(qty, mrp, rate)
          const legacy = { ...sale.txItems[0], enteredPrice: null, priceIncludesGst: null }
          const ret = refilled(legacy, MRP_PRODUCT(mrp, rate), 'credit-note')
          // The old per-unit rounding: at most half a paisa per unit, each way.
          const slack = Math.ceil(qty * 0.5 * (1 + rate / 100)) + 1
          expect(Math.abs(toPaise(ret.totalBeforeRoundOff) - toPaise(sale.totalBeforeRoundOff))).toBeLessThanOrEqual(slack)
        }
      }
    }
  })
})

describe('#135 — whose flag decides a line', () => {
  test('a line that states its own value keeps it, on either side', () => {
    for (const isPurchaseSide of [true, false]) {
      for (const purchaseRatesIncludeGst of [true, false]) {
        for (const productFlag of [true, false, null]) {
          expect(resolveLineIncludesGst({ lineFlag: true, isPurchaseSide, purchaseRatesIncludeGst, productFlag })).toBe(true)
          expect(resolveLineIncludesGst({ lineFlag: false, isPurchaseSide, purchaseRatesIncludeGst, productFlag })).toBe(false)
        }
      }
    }
  })

  test('a purchase follows the bill switch and never the product MRP flag', () => {
    expect(resolveLineIncludesGst({ isPurchaseSide: true, purchaseRatesIncludeGst: false, productFlag: true })).toBe(false)
    expect(resolveLineIncludesGst({ isPurchaseSide: true, purchaseRatesIncludeGst: true, productFlag: false })).toBe(true)
  })

  test('a sale follows the product MRP flag and never the purchase switch', () => {
    expect(resolveLineIncludesGst({ isPurchaseSide: false, purchaseRatesIncludeGst: true, productFlag: false })).toBe(false)
    expect(resolveLineIncludesGst({ isPurchaseSide: false, purchaseRatesIncludeGst: false, productFlag: true })).toBe(true)
    expect(resolveLineIncludesGst({ isPurchaseSide: false, purchaseRatesIncludeGst: false, productFlag: null })).toBe(false)
  })

  test('the case seen first-hand: ₹230 from the supplier @5% on an MRP product = ₹230 + ₹11.50', () => {
    const product = MRP_PRODUCT(255, 5)
    const flag = resolveLineIncludesGst({ isPurchaseSide: true, purchaseRatesIncludeGst: false, productFlag: product.priceIncludesGst })
    const r = computeLineItems({
      items: [{ productId: 'p1', productName: product.name, quantity: 1, unitPrice: 230, gstRate: 5, unit: 'pcs', priceIncludesGst: flag }],
      productMap: new Map([['p1', product]]),
      isInterState: false, orderDiscount: 0, type: 'purchase',
    })
    expect(r.txItems[0].unitPrice).toBe(230)
    expect(r.cgst + r.sgst).toBe(11.5)
    expect(r.totalBeforeRoundOff).toBe(241.5)
  })

  test('with "Rates include GST" on, ₹230 is the total and the cost is ₹219.05', () => {
    const product = MRP_PRODUCT(255, 5)
    const flag = resolveLineIncludesGst({ isPurchaseSide: true, purchaseRatesIncludeGst: true, productFlag: product.priceIncludesGst })
    const r = computeLineItems({
      items: [{ productId: 'p1', productName: product.name, quantity: 1, unitPrice: 230, gstRate: 5, unit: 'pcs', priceIncludesGst: flag }],
      productMap: new Map([['p1', product]]),
      isInterState: false, orderDiscount: 0, type: 'purchase',
    })
    expect(r.totalBeforeRoundOff).toBe(230)
    expect(r.txItems[0].unitPrice).toBe(219.05)
  })
})

/**
 * THE CLASS: a line built from a SAVED BILL's lines must go through
 * refillPrice(). A second hand-written copy of the rule in one screen is how
 * the double extraction came back four times (return, repeat, convert, edit).
 *
 * A "saved-bill source" is a `.map(` over `<transaction|txn|sale|estimate|
 * original|invoice|bill…>.items` or `originalItems`. It "builds a line" when the
 * callback sets `productId:` and a price (`unitPrice:` or refillPrice). Those
 * that build a line with `unitPrice:` and no refillPrice( are reported, by line.
 */
const SAVED_BILL_SOURCE = /(?:transaction|txn|sale|estimate|original|invoice|bill)\w*\??\.items\??$|originalItems$/i

function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ''))
    .replace(/(^|[ \t])\/\/[^\n]*/gm, (_m, lead) => lead)
}

function mapCallsOverSavedLines(source: string): { line: number; body: string }[] {
  const code = blankComments(source)
  const out: { line: number; body: string }[] = []
  const re = /([\w?.]+)\.map\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (!SAVED_BILL_SOURCE.test(m[1])) continue
    let depth = 0
    let j = m.index + m[0].length - 1
    for (; j < code.length; j++) {
      if (code[j] === '(') depth++
      else if (code[j] === ')' && --depth === 0) break
    }
    out.push({ line: code.slice(0, m.index).split(/\r?\n/).length, body: code.slice(m.index, j + 1) })
  }
  return out
}

const buildsLine = (body: string) => /\bproductId\s*:/.test(body) && (/\bunitPrice\s*:/.test(body) || body.includes('refillPrice('))

function findRefillsWithoutRefillPrice(source: string): number[] {
  return mapCallsOverSavedLines(source)
    .filter(c => buildsLine(c.body) && /\bunitPrice\s*:/.test(c.body) && !c.body.includes('refillPrice('))
    .map(c => c.line)
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

describe('guard — refills from a saved bill use refillPrice()', () => {
  test('catches the old return refill', () => {
    const bad = `
      setItems(originalItems.map((item: any) => ({
        productId: item.productId || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice || 0,
        gstRate: item.gstRate || 0,
      })))`
    expect(findRefillsWithoutRefillPrice(bad)).toEqual([2])
  })

  test('catches the old convert route and repeat-sale shapes', () => {
    expect(findRefillsWithoutRefillPrice(`const items = estimate.items.map(item => ({ productId: item.productId, unitPrice: item.unitPrice, gstRate: item.gstRate }))`)).toEqual([1])
    expect(findRefillsWithoutRefillPrice(`items: latestSale.items.map((item: any) => ({\n productId: item.productId || '',\n unitPrice: item.unitPrice,\n }))`)).toEqual([1])
    expect(findRefillsWithoutRefillPrice(`setItems(transaction.items?.map((i: any) => ({ productId: i.productId, unitPrice: i.unitPrice })))`)).toEqual([1])
  })

  test('passes the fixed shapes', () => {
    expect(findRefillsWithoutRefillPrice(`setItems(originalItems.map((item: any) => ({ productId: item.productId, ...refillPrice(item), gstRate: 5 })))`)).toEqual([])
  })

  test('a comment mentioning refillPrice does not satisfy it', () => {
    const bad = `estimate.items.map(item => ({\n  // uses refillPrice(item) — not really\n  productId: item.productId,\n  unitPrice: item.unitPrice,\n}))`
    expect(findRefillsWithoutRefillPrice(bad)).toEqual([1])
  })

  test('display maps over saved lines are not refills', () => {
    expect(findRefillsWithoutRefillPrice(`txn.items.map(it => <Row key={it.id} price={it.unitPrice} />)`)).toEqual([])
  })

  test('sweep: no file refills a saved line by hand, and the sweep is not vacuous', () => {
    const root = path.join(__dirname, '..', '..')
    const offenders: string[] = []
    let refillSites = 0
    for (const file of sourceFiles(root)) {
      const src = fs.readFileSync(file, 'utf8')
      for (const c of mapCallsOverSavedLines(src)) if (buildsLine(c.body)) refillSites++
      for (const line of findRefillsWithoutRefillPrice(src)) {
        offenders.push(`${path.relative(path.join(root, '..'), file).replace(/\\/g, '/')}:${line}`)
      }
    }
    expect(offenders).toEqual([])
    // Return (TransactionEntry), repeat (Dashboard), edit (TransactionDetail),
    // estimate convert (route). Fewer means the matcher stopped seeing them.
    expect(refillSites).toBeGreaterThanOrEqual(4)
  })
})
