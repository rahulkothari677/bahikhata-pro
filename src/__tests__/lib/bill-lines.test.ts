/**
 * Phase 7e — bill lines: no sale above the printed MRP (Legal Metrology
 * (Packaged Commodities) Rules 2011, rule 18(2)), loose goods by rupees, and a
 * removed line comes back with Undo.
 *
 * One rule for "above MRP" (lib/unit-profit.ts lineAboveMrp / linesAboveMrp):
 * the bill screen flags the line and waits, and the server refuses the same
 * lines on create, edit and estimate → sale. The check reads a request line the
 * way the bill engine does (line-items.ts mrpCheckLines), and a sweep below
 * proves it agrees with the engine's own line total.
 */
import { describe, test, expect } from '@jest/globals'
import { computeLineItems, mrpCheckLines, savedMrpCheckLines } from '@/lib/line-items'
import { lineAboveMrp, linesAboveMrp, mrpRefusalMessage } from '@/lib/unit-profit'
import { quantityForAmount } from '@/lib/loose-amount'
import { readCode } from '@/test-support/read-source'

const gst = { chargesGst: true }
const noGst = { chargesGst: false }

describe('lineAboveMrp — one line against its printed MRP', () => {
  test('a before-GST price: GST goes on top, then compared', () => {
    expect(lineAboveMrp({ unitPrice: 230, gstRate: 5 }, { mrp: 240 }, gst)).toBe(241.5)
    expect(lineAboveMrp({ unitPrice: 230, gstRate: 5 }, { mrp: 241.5 }, gst)).toBeNull() // exactly MRP is allowed
  })
  test('an MRP (GST-included) price is compared as it stands', () => {
    expect(lineAboveMrp({ unitPrice: 255, gstRate: 5, priceIncludesGst: true }, { mrp: 255 }, gst)).toBeNull()
    expect(lineAboveMrp({ unitPrice: 255.01, gstRate: 5, priceIncludesGst: true }, { mrp: 255 }, gst)).toBe(255.01)
  })
  test('a shop that charges no GST adds none', () => {
    expect(lineAboveMrp({ unitPrice: 250, gstRate: 5 }, { mrp: 255 }, noGst)).toBeNull()
    expect(lineAboveMrp({ unitPrice: 256, gstRate: 5 }, { mrp: 255 }, noGst)).toBe(256)
  })
  test('no MRP → nothing to break', () => {
    expect(lineAboveMrp({ unitPrice: 9999, gstRate: 18 }, { mrp: null }, gst)).toBeNull()
    expect(lineAboveMrp({ unitPrice: 9999, gstRate: 18 }, { mrp: 0 }, gst)).toBeNull()
    expect(lineAboveMrp({ unitPrice: 9999, gstRate: 18 }, null, gst)).toBeNull()
  })
})

describe('linesAboveMrp — the list the server refuses and the screen flags', () => {
  const products = new Map([
    ['salt', { name: 'Tata Salt 1 kg', mrp: 28 }],
    ['atta', { name: 'Aashirvaad Atta 5 kg', mrp: 255 }],
  ])
  const of = (id: string) => products.get(id)

  test('only the line above its MRP, by its index; typed-in lines have no MRP', () => {
    const lines = [
      { productId: 'salt', unitPrice: 28, gstRate: 0 },
      { productId: 'atta', unitPrice: 260, gstRate: 5, priceIncludesGst: true },
      { productId: null, unitPrice: 5000, gstRate: 0 },
    ]
    expect(linesAboveMrp(lines, of, gst)).toEqual([{ index: 1, name: 'Aashirvaad Atta 5 kg', pays: 260, mrp: 255 }])
  })

  test('an edit keeps a line the customer already paid (the MRP was higher then); it may not raise it', () => {
    const saved = [{ productId: 'atta', unitPrice: 265, gstRate: 5, priceIncludesGst: true }] // sold at ₹265 before a price cut
    expect(linesAboveMrp([{ productId: 'atta', unitPrice: 265, gstRate: 5, priceIncludesGst: true }], of, gst, saved)).toEqual([])
    expect(linesAboveMrp([{ productId: 'atta', unitPrice: 262, gstRate: 5, priceIncludesGst: true }], of, gst, saved)).toEqual([]) // lowered, still above today's MRP
    expect(linesAboveMrp([{ productId: 'atta', unitPrice: 266, gstRate: 5, priceIncludesGst: true }], of, gst, saved)).toHaveLength(1) // raised
    // another item's saved price exempts nothing
    expect(linesAboveMrp([{ productId: 'salt', unitPrice: 30, gstRate: 0 }], of, gst, saved)).toHaveLength(1)
  })

  test('the refusal names each item, what it was and its MRP', () => {
    const msg = mrpRefusalMessage([{ name: 'Aashirvaad Atta 5 kg', pays: 260.5, mrp: 255 }])
    expect(msg).toContain('Aashirvaad Atta 5 kg: ₹260.50 each, MRP ₹255')
  })
})

describe('the check reads a line exactly as the bill engine does', () => {
  test('a line with no "includes GST" of its own takes the item\'s (as computeLineItems does)', () => {
    const productMap = new Map([['atta', { id: 'atta', name: 'Atta', mrp: 255, priceIncludesGst: true, unit: 'pcs' }]])
    const lines = mrpCheckLines([{ productId: 'atta', productName: 'Atta', quantity: 1, unitPrice: '256', gstRate: 5 }], productMap)
    expect(lines[0]).toEqual({ productId: 'atta', unitPrice: 256, gstRate: 5, priceIncludesGst: true })
    // read as before-GST it would be 268.80 — the same verdict here, but a ₹250 line shows the difference:
    const at250 = mrpCheckLines([{ productId: 'atta', productName: 'Atta', quantity: 1, unitPrice: 250, gstRate: 5 }], productMap)
    expect(linesAboveMrp(at250, (id) => productMap.get(id), gst)).toEqual([]) // ₹250 incl. GST — under MRP
  })

  test('a saved line comes back by the one refill rule (#130): the price as typed', () => {
    expect(savedMrpCheckLines([{ productId: 'atta', unitPrice: 242.86, enteredPrice: 255, priceIncludesGst: true, gstRate: 5 }]))
      .toEqual([{ productId: 'atta', gstRate: 5, unitPrice: 255, priceIncludesGst: true }])
    // a line saved before those columns existed: the before-GST price, flag off
    expect(savedMrpCheckLines([{ productId: 'atta', unitPrice: 242.86, enteredPrice: null, priceIncludesGst: null, gstRate: 5 }]))
      .toEqual([{ productId: 'atta', gstRate: 5, unitPrice: 242.86, priceIncludesGst: false }])
  })

  test('sweep: flagged exactly when the engine bills one unit above the MRP', () => {
    let checked = 0
    for (const chargesGst of [true, false]) {
      for (const rate of [0, 5, 18, 40]) {
        for (const inclusive of [true, false]) {
          for (const price of [90, 95.23, 95.24, 99.99, 100, 100.01, 105, 118]) {
            const mrp = 100
            const productMap = new Map([['p', { id: 'p', name: 'P', mrp, priceIncludesGst: inclusive, unit: 'pcs' }]])
            const raw = [{ productId: 'p', productName: 'P', quantity: 1, unitPrice: price, gstRate: rate, unit: 'pcs' }]
            const billed = computeLineItems({ items: raw, productMap, isInterState: false, orderDiscount: 0, type: 'sale', chargesGst }).txItems[0].total
            const flagged = linesAboveMrp(mrpCheckLines(raw, productMap), (id) => productMap.get(id), { chargesGst }).length > 0
            expect({ chargesGst, rate, inclusive, price, flagged }).toEqual({ chargesGst, rate, inclusive, price, flagged: Math.round(billed * 100) > mrp * 100 })
            checked++
          }
        }
      }
    }
    expect(checked).toBe(128)
  })
})

describe('loose goods by rupees', () => {
  test('₹50 of sugar at ₹44 a kg is 1.136 kg, and the bill says ₹49.98', () => {
    const q = quantityForAmount(50, { unitPrice: 44, unit: 'kg' }, 'kg', noGst)
    expect(q).toBe(1.136)
    const productMap = new Map([['sugar', { id: 'sugar', name: 'Sugar', unit: 'kg', priceIncludesGst: false }]])
    const line = computeLineItems({ items: [{ productId: 'sugar', productName: 'Sugar', quantity: q!, unitPrice: 44, gstRate: 0, unit: 'kg' }], productMap, isInterState: false, orderDiscount: 0, type: 'sale', chargesGst: false }).txItems[0]
    expect(line.total).toBe(49.98)
  })
  test('rounded to the nearest gram, not cut: ₹100 at ₹44 = 2.273 kg', () => {
    expect(quantityForAmount(100, { unitPrice: 44, unit: 'kg' }, 'kg', noGst)).toBe(2.273)
  })
  test('a line in grams stays in grams', () => {
    expect(quantityForAmount(50, { unitPrice: 44, unit: 'gm' }, 'kg', noGst)).toBe(1136)
    expect(quantityForAmount(30, { unitPrice: 120, unit: 'ml' }, 'ltr', noGst)).toBe(250)
  })
  test('GST on top for a before-GST price: ₹105 at ₹100 + 5% is 1 kg; a no-GST shop adds none', () => {
    expect(quantityForAmount(105, { unitPrice: 100, gstRate: 5, unit: 'kg' }, 'kg', gst)).toBe(1)
    expect(quantityForAmount(105, { unitPrice: 100, gstRate: 5, priceIncludesGst: true, unit: 'kg' }, 'kg', gst)).toBe(1.05)
    expect(quantityForAmount(100, { unitPrice: 100, gstRate: 5, unit: 'kg' }, 'kg', noGst)).toBe(1)
  })
  test('never for counted things, a zero price or a zero amount', () => {
    expect(quantityForAmount(50, { unitPrice: 10, unit: 'pcs' }, 'pcs', noGst)).toBeNull()
    expect(quantityForAmount(50, { unitPrice: 10, unit: 'dozen' }, 'pcs', noGst)).toBeNull()
    expect(quantityForAmount(50, { unitPrice: 0, unit: 'kg' }, 'kg', noGst)).toBeNull()
    expect(quantityForAmount(0, { unitPrice: 44, unit: 'kg' }, 'kg', noGst)).toBeNull()
  })
})

describe('wired where it must be', () => {
  test('every sale writer refuses a line above MRP — create, edit (keeping saved lines), estimate → sale', () => {
    // The condition too, not only the call: a check behind the wrong `if` never runs.
    const create = readCode('src/app/api/transactions/route.ts')
    expect(create).toMatch(/if \(type === 'sale'\) \{\s*const above = linesAboveMrp\(mrpCheckLines\(items, productMap\)/)
    const edit = readCode('src/app/api/transactions/[id]/route.ts')
    expect(edit).toMatch(/if \(type === 'sale'\) \{\s*const above = linesAboveMrp\(mrpCheckLines\(items, productMap\)[^\n]*savedMrpCheckLines\(oldItems\)\)/)
    const convert = readCode('src/app/api/transactions/[id]/convert/route.ts')
    expect(convert).toMatch(/linesAboveMrp\(mrpCheckLines\(items, productMap\)/)
    for (const code of [create, edit, convert]) expect(code).toContain("error: 'Price above MRP'")
  })

  test('the bill screen flags the line, and Save, Pay and F10 wait while any line is above MRP', () => {
    const code = readCode('src/components/ledger/TransactionEntry.tsx')
    expect(code).toMatch(/const mrpOver = actualType === 'sale'\s*\?\s*linesAboveMrp\(computeInput,/)
    expect(code).toContain('const saveBlocked = hasStockBlock || hasMrpBlock')
    expect(code).toContain('if (saving || saveBlocked) return') // F10
    expect(code).toMatch(/if \(hasMrpBlock\) \{\s*sonnerToast\.error\('Price above MRP'/) // Enter / any other path into handleSave
    expect(code).not.toMatch(/disabled=\{saving \|\| hasStockBlock/) // every Save/Pay button uses saveBlocked
    expect((code.match(/disabled=\{saving \|\| saveBlocked/g) || []).length).toBe(4)
    expect(code).toContain('onClick={() => sellAtMrp(i, over.mrp)}')
    expect(code).toMatch(/unitPrice: mrp, priceIncludesGst: true/)
  })

  test('a removed line comes back where it was, with Undo', () => {
    const code = readCode('src/components/ledger/TransactionEntry.tsx')
    expect(code).toMatch(/label: 'Undo', onClick: \(\) => setItems\(\(now\) => \[\.\.\.now\.slice\(0, index\), removed, \.\.\.now\.slice\(index\)\]\)/)
  })
})
