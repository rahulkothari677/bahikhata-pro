/**
 * 🔒 AUDIT G1 — the taxable value GSTR-1 files must equal the taxable value the
 * invoice was actually computed from.
 *
 * WHY THIS IS NOT OBVIOUS: the two are computed in different units, in
 * different files, in different rounding orders.
 *
 *   computeLineItems (line-items.ts)   works in PAISE:
 *       grossPaise   = multiplyPaise(qty, unitPricePaise)   // Math.round
 *       taxablePaise = grossPaise - discountPaise
 *
 *   gstr1-builder.itemTaxable()        works in RUPEES:
 *       roundMoney(quantity * unitPrice - (discountAmount || 0))
 *
 * For whole quantities these trivially agree. For FRACTIONAL quantities
 * (0.5 kg, 2.75 ltr, 0.333 kg — all ordinary in a kirana shop) the rounding
 * order differs, and a one-paisa divergence would put the filed `txval` out of
 * step with the stored cgst/sgst/igst. The portal validates tax against txval,
 * so a paisa of drift there is a filing rejection, not a cosmetic issue.
 *
 * This test pins the relationship so a future change to either side cannot
 * silently break the other.
 */

import { computeLineItems } from '@/lib/line-items'
import { roundMoney, toPaise } from '@/lib/money'

/** Re-implementation of gstr1-builder's private itemTaxable(). */
function gstr1ItemTaxable(item: { quantity: number; unitPrice: number; discountAmount?: number }) {
  return roundMoney(item.quantity * item.unitPrice - (item.discountAmount || 0))
}

/**
 * The taxable value computeLineItems actually taxed, recovered from the stored
 * line: total = taxable + gst, so taxable = total - (cgst + sgst + igst).
 */
function taxableActuallyUsed(stored: {
  total: number; cgst: number; sgst: number; igst: number
}) {
  return roundMoney(stored.total - (stored.cgst + stored.sgst + stored.igst))
}

const productMap = new Map()

function run(quantity: number, unitPrice: number, gstRate: number, orderDiscount = 0) {
  return computeLineItems({
    items: [{ productId: null, productName: 'X', quantity, unitPrice, gstRate, unit: 'pcs' }],
    productMap,
    isInterState: false,
    orderDiscount,
    type: 'sale',
  })
}

describe('G1 — GSTR-1 txval equals the taxable the invoice was computed from', () => {
  const cases: Array<[number, number, number]> = [
    // [quantity, unitPrice, gstRate] — fractional quantities are the risk case
    [0.5, 20, 5],
    [0.5, 19.99, 18],
    [2.75, 33.33, 12],
    [0.333, 299.99, 18],
    [1.5, 10.05, 28],
    [0.25, 1000.01, 5],
    [3.75, 7.77, 12],
    [0.125, 88.88, 18],
    [7.5, 13.37, 28],
    [1, 100, 18],      // whole-quantity control
    [10, 55.55, 5],    // whole-quantity control
  ]

  test.each(cases)(
    'qty=%p price=%p rate=%p%% — filed txval matches the taxed amount',
    (quantity, unitPrice, gstRate) => {
      const r = run(quantity, unitPrice, gstRate)
      const stored = r.txItems[0]

      const filed = gstr1ItemTaxable(stored)
      const used = taxableActuallyUsed(stored)

      expect(filed).toBe(used)
    },
  )

  test.each(cases)(
    'qty=%p price=%p rate=%p%% — stored tax equals round(txval x rate), the portal rule',
    (quantity, unitPrice, gstRate) => {
      const r = run(quantity, unitPrice, gstRate)
      const stored = r.txItems[0]

      const filed = gstr1ItemTaxable(stored)
      const storedTaxPaise = toPaise(stored.cgst) + toPaise(stored.sgst) + toPaise(stored.igst)
      const expectedTaxPaise = Math.round((toPaise(filed) * gstRate) / 100)

      // This is the invariant the GST portal enforces. If it ever fails, GSTR-1
      // is rejected — which is why C3's "derive tax by subtraction" proposal was
      // withdrawn (see docs/audit/05-c3-correction.md).
      expect(storedTaxPaise).toBe(expectedTaxPaise)
    },
  )

  test('holds with an order-level discount distributed across lines', () => {
    const r = computeLineItems({
      items: [
        { productId: null, productName: 'A', quantity: 0.5, unitPrice: 19.99, gstRate: 18, unit: 'kg' },
        { productId: null, productName: 'B', quantity: 2.75, unitPrice: 33.33, gstRate: 18, unit: 'kg' },
        { productId: null, productName: 'C', quantity: 0.333, unitPrice: 299.99, gstRate: 18, unit: 'kg' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 17.77,
      type: 'sale',
    })

    for (const stored of r.txItems) {
      expect(gstr1ItemTaxable(stored)).toBe(taxableActuallyUsed(stored))
    }
  })
})
