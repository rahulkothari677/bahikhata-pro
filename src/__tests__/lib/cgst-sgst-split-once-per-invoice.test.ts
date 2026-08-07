/**
 * CGST and SGST are equal halves of the invoice's tax — not of each line's.
 *
 * WHY (2026-08-07, money sweep). splitGstPaise hands the odd paisa to CGST. That
 * is deliberate and documented, and right when it happens once. It was happening
 * on every line, so every line with an odd-paise tax gave CGST another paisa.
 *
 * Verified on the live invoice screen before the fix — INV-0060, three lines of
 * ₹10.10 at 5%:
 *
 *   Subtotal ₹30.30    CGST ₹0.78    SGST ₹0.75    Total ₹31.83
 *
 * Three paise apart, printed on a GST invoice where the two are by definition
 * half each. Forty lines could be forty paise apart, on every sale. The money is
 * trivial; being visibly wrong on a tax document in a way an officer recognises
 * is not.
 *
 * These tests pin the three properties the fix has to hold at once. Any one of
 * them alone is easy; it is the combination that constrains the implementation.
 */
import { computeLineItems } from '@/lib/line-items'
import { toPaise } from '@/lib/money'

/** Build N identical lines at a given price and rate, with no products. */
function lines(count: number, unitPrice: number, gstRate: number) {
  return Array.from({ length: count }, (_, i) => ({
    productName: `ITEM ${i + 1}`,
    quantity: 1,
    unitPrice,
    gstRate,
    unit: 'pcs',
    priceIncludesGst: false,
  }))
}

function compute(items: any[]) {
  return computeLineItems({ items, products: [], isInterState: false } as any)
}

describe('the reported invoice', () => {
  it('splits three lines of ₹10.10 at 5% within one paise, not three', () => {
    const r = compute(lines(3, 10.10, 5))

    // What the screen showed before the fix: 0.78 / 0.75.
    expect(r.cgst).toBeCloseTo(0.77, 2)
    expect(r.sgst).toBeCloseTo(0.76, 2)

    // The invoice must still add up to the same money as before — this fix
    // moves a paisa between two tax heads, it does not change what is charged.
    expect(r.subtotal).toBeCloseTo(30.30, 2)
    expect(r.cgst + r.sgst).toBeCloseTo(1.53, 2)
  })
})

describe('properties that must hold for any invoice', () => {
  const shapes: Array<[string, any[]]> = [
    ['3 x ₹10.10 @ 5%', lines(3, 10.10, 5)],
    ['40 x ₹0.10 @ 12% (tiny odd taxes)', lines(40, 0.10, 12)],
    ['7 x ₹33.33 @ 18%', lines(7, 33.33, 18)],
    ['1 x ₹99.99 @ 5%', lines(1, 99.99, 5)],
    ['12 x ₹1.01 @ 28%', lines(12, 1.01, 28)],
    ['5 x ₹100 @ 0% (no tax at all)', lines(5, 100, 0)],
  ]

  it.each(shapes)('%s — CGST and SGST differ by at most one paisa', (_name, items) => {
    const r = compute(items)
    const gap = Math.abs(toPaise(r.cgst) - toPaise(r.sgst))
    // One paisa is unavoidable when the total tax is an odd number of paise.
    // More than one means the rule is being applied more than once.
    expect(gap).toBeLessThanOrEqual(1)
  })

  it.each(shapes)('%s — the line values still sum to the invoice values', (_name, items) => {
    const r = compute(items)
    // The header is derived from the items, and the HSN summary reads the
    // items. If these drift apart, the invoice contradicts its own breakdown.
    const sumCgst = r.txItems.reduce((a: number, i: any) => a + toPaise(i.cgst), 0)
    const sumSgst = r.txItems.reduce((a: number, i: any) => a + toPaise(i.sgst), 0)
    expect(sumCgst).toBe(toPaise(r.cgst))
    expect(sumSgst).toBe(toPaise(r.sgst))
  })

  it.each(shapes)('%s — no line has negative tax', (_name, items) => {
    const r = compute(items)
    /*
     * This is the one that rules out the obvious wrong fix. Correcting the
     * invoice by dumping the whole adjustment on the last line looks fine on a
     * three-line bill and fails on forty lines of one paisa: the correction is
     * larger than the tax on the line being corrected, and SGST goes negative —
     * a refund appearing inside a sale.
     */
    for (const i of r.txItems as any[]) {
      expect(toPaise(i.cgst)).toBeGreaterThanOrEqual(0)
      expect(toPaise(i.sgst)).toBeGreaterThanOrEqual(0)
      // And each line's two halves still make up that line's own tax.
      expect(toPaise(i.cgst) + toPaise(i.sgst)).toBe(toPaise(i.gstAmount ?? (i.cgst + i.sgst)))
    }
  })
})
