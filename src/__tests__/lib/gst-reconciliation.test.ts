/**
 * The reconciliation must not cry wolf.
 *
 * A GSTR-1 vs GSTR-3B mismatch is the most common notice trigger, so showing it
 * is worth doing — but the two returns are NOT supposed to be identical, and a
 * check that demanded equality would flag correct books every single month.
 * A warning that is usually wrong gets ignored, and then it cannot help when it
 * is right.
 *
 * These pin both directions: legitimate differences must reconcile to zero, and
 * a genuine error must still be caught.
 */
import { reconcileReturns } from '@/lib/gst-reconciliation'

const clean = {
  gstr1InvoiceTax: 54675.01,
  gstr1InvoiceTaxable: 311698.9,
  gstr3bOutputTax: 54675.01,
  gstr3bTaxable: 311698.9,
  advanceTaxReceived: 0,
  advanceTaxableReceived: 0,
  advanceTaxReleased: 0,
  advanceTaxableReleased: 0,
  nilExemptNonGst: 0,
}

describe('books that agree', () => {
  it('matches when the two returns are identical', () => {
    const r = reconcileReturns(clean)
    expect(r.matched).toBe(true)
    expect(r.unexplained).toBe(0)
  })

  it('treats sub-rupee drift as rounding, not a mismatch', () => {
    // Both returns are filed in whole rupees; a 40-paise difference cannot even
    // be expressed on the portal.
    const r = reconcileReturns({ ...clean, gstr3bOutputTax: 54675.41 })
    expect(r.matched).toBe(true)
  })
})

describe('differences that are supposed to be there', () => {
  it('explains the gap an advance creates', () => {
    /*
     * The real case from production: a ₹1,180 service advance at 18% puts ₹180
     * into 3B's 3.1(a) that is not in any GSTR-1 invoice. Equality would call
     * this a mismatch. It is correct.
     */
    const r = reconcileReturns({
      ...clean,
      gstr3bOutputTax: 54855.01,
      gstr3bTaxable: 312698.9,
      advanceTaxReceived: 180,
      advanceTaxableReceived: 1000,
    })
    expect(r.matched).toBe(true)
    expect(r.unexplained).toBe(0)
    expect(r.reconcilingItems[0].label).toMatch(/advances received/i)
    expect(r.reconcilingItems[0].amount).toBe(180)
  })

  it('explains an advance being released against a bill', () => {
    const r = reconcileReturns({
      ...clean,
      gstr3bOutputTax: 54495.01,
      gstr3bTaxable: 310698.9,
      advanceTaxReleased: 180,
      advanceTaxableReleased: 1000,
    })
    expect(r.matched).toBe(true)
    expect(r.reconcilingItems[0].amount).toBe(-180)
  })

  it('handles an advance taken and released in the same month', () => {
    const r = reconcileReturns({
      ...clean,
      advanceTaxReceived: 180, advanceTaxableReceived: 1000,
      advanceTaxReleased: 180, advanceTaxableReleased: 1000,
    })
    expect(r.matched).toBe(true)
    expect(r.reconcilingItems).toHaveLength(2)
  })

  it('names nil and exempt supplies without treating them as a gap', () => {
    const r = reconcileReturns({ ...clean, nilExemptNonGst: 2959 })
    expect(r.matched).toBe(true)
    expect(r.reconcilingItems[0].amount).toBe(0)
    expect(r.reconcilingItems[0].why).toContain('2959')
  })
})

describe('a real mismatch is still caught', () => {
  it('reports tax that nothing explains', () => {
    const r = reconcileReturns({ ...clean, gstr3bOutputTax: 54675.01 + 500 })
    expect(r.matched).toBe(false)
    expect(r.unexplained).toBe(500)
  })

  it('reports taxable value that nothing explains, even when the tax agrees', () => {
    // The dangerous shape: tax matches so a tax-only check passes, while the
    // declared turnover differs. This is exactly the ₹25 class of bug.
    const r = reconcileReturns({ ...clean, gstr3bTaxable: 311698.9 - 25 })
    expect(r.matched).toBe(false)
    expect(r.unexplainedTaxable).toBe(-25)
  })

  it('does not let an advance hide a real error', () => {
    const r = reconcileReturns({
      ...clean,
      gstr3bOutputTax: 54855.01 + 300,
      gstr3bTaxable: 312698.9,
      advanceTaxReceived: 180,
      advanceTaxableReceived: 1000,
    })
    expect(r.matched).toBe(false)
    expect(r.unexplained).toBe(300)
  })
})
