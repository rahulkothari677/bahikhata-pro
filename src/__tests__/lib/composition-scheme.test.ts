/**
 * The composition scheme is a different tax world, not a discount.
 *
 * WHY (2026-08-09). The app assumes the regular scheme everywhere — charges GST
 * on invoices, claims input credit, files monthly. A composition dealer does
 * none of that, so the app cannot serve them at all today.
 *
 * The rule that outranks everything else here: a composition dealer CANNOT
 * COLLECT GST. They pay a flat percentage of turnover from their own margin and
 * issue a Bill of Supply, not a tax invoice. An app that printed CGST and SGST
 * on their bill would help them break the law and overcharge the customer in
 * the same stroke.
 */
import {
  COMPOSITION_RATES, COMPOSITION_LIMITS, compositionLimitFor, compositionTaxFor,
  canCollectTax, cmp08DueDate, BILL_OF_SUPPLY_DECLARATION, saleDocumentKind,
} from '@/lib/composition-scheme'

describe('a composition dealer cannot collect tax', () => {
  it('says so plainly', () => {
    expect(canCollectTax(true)).toBe(false)
    expect(canCollectTax(false)).toBe(true)
  })

  it('carries the prescribed declaration word for word', () => {
    /*
     * Prescribed wording, not a paraphrase — it is what tells the customer they
     * cannot claim credit from this bill.
     */
    expect(BILL_OF_SUPPLY_DECLARATION)
      .toBe('Composition taxable person, not eligible to collect tax on supplies')
  })
})

describe('the rates', () => {
  it('charges 1% to traders and manufacturers', () => {
    expect(COMPOSITION_RATES.trader.total).toBe(1)
    expect(COMPOSITION_RATES.manufacturer.total).toBe(1)
  })

  it('charges 5% to restaurants and 6% to service providers', () => {
    expect(COMPOSITION_RATES.restaurant.total).toBe(5)
    expect(COMPOSITION_RATES.service.total).toBe(6)
  })

  it('splits every rate evenly between CGST and SGST', () => {
    for (const r of Object.values(COMPOSITION_RATES)) {
      expect(r.cgst + r.sgst).toBeCloseTo(r.total)
      expect(r.cgst).toBeCloseTo(r.sgst)
    }
  })
})

describe('tax on a quarter', () => {
  it('is a flat percentage of turnover, with no credit netted off', () => {
    const r = compositionTaxFor(1000000, 'trader')
    expect(r.total).toBe(10000)      // 1% of 10 lakh
    expect(r.cgst).toBe(5000)
    expect(r.sgst).toBe(5000)
  })

  it('charges a restaurant 5%', () => {
    expect(compositionTaxFor(400000, 'restaurant').total).toBe(20000)
  })

  it('is zero on no turnover, not negative', () => {
    expect(compositionTaxFor(0, 'trader').total).toBe(0)
    expect(compositionTaxFor(-500, 'trader').total).toBe(0)
  })
})

describe('turnover ceilings', () => {
  it('allows ₹1.5 crore for goods in most states', () => {
    expect(compositionLimitFor('trader', '27')).toBe(COMPOSITION_LIMITS.goods)
  })

  it('drops to ₹75 lakh in a special category state', () => {
    // Checked by STATE CODE, not name — "Uttarakhand" and "Uttaranchal" are the
    // same place to a shopkeeper and not to a string comparison.
    expect(compositionLimitFor('trader', '05')).toBe(COMPOSITION_LIMITS.goodsSpecialCategory)
    expect(compositionLimitFor('trader', '18')).toBe(COMPOSITION_LIMITS.goodsSpecialCategory)
  })

  it('holds services to ₹50 lakh everywhere', () => {
    expect(compositionLimitFor('service', '27')).toBe(COMPOSITION_LIMITS.service)
    expect(compositionLimitFor('service', '05')).toBe(COMPOSITION_LIMITS.service)
  })
})

describe('CMP-08 is quarterly, not monthly', () => {
  it('falls due on the 18th of the month after the quarter', () => {
    expect(cmp08DueDate(2026, 6).getMonth()).toBe(6)   // Jul
    expect(cmp08DueDate(2026, 6).getDate()).toBe(18)
    expect(cmp08DueDate(2026, 9).getMonth()).toBe(9)   // Oct
  })

  it('rolls the December quarter into the next January', () => {
    const d = cmp08DueDate(2026, 12)
    expect(d.getFullYear()).toBe(2027)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(18)
  })
})

describe('the two heads always add up to the total', () => {
  /*
   * Rounding each half independently let them miss by a paisa: 1% of
   * ₹5,56,230.53 is ₹5,562.31, but half rounds to ₹2,781.15 twice and sums to
   * ₹5,562.30. CMP-08 declares the total so no filing broke — but a CA
   * reconciling the heads against the total finds a difference with no
   * explanation, and that is how trust in a figure goes.
   */
  it('reconciles on the real figure that exposed it', () => {
    const r = compositionTaxFor(556230.53, 'trader')
    expect(r.total).toBe(5562.31)
    expect(Math.round((r.cgst + r.sgst) * 100) / 100).toBe(r.total)
  })

  it('never splits unevenly by more than a paisa', () => {
    for (const t of [1, 33.33, 100.01, 999.99, 12345.67, 556230.53, 7777777.77]) {
      for (const c of ['trader', 'restaurant', 'service'] as const) {
        const r = compositionTaxFor(t, c)
        // Compared in PAISE. `0.01` in floats is 0.010000000000000009, so a
        // rupee comparison fails on a difference that is exactly one paisa.
        expect(Math.round(r.cgst * 100) + Math.round(r.sgst * 100))
          .toBe(Math.round(r.total * 100))
        expect(Math.abs(Math.round(r.cgst * 100) - Math.round(r.sgst * 100)))
          .toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('the document a composition dealer issues', () => {
  it('is a Bill of Supply, never a tax invoice', () => {
    const d = saleDocumentKind('trader')
    expect(d.title).toBe('Bill of Supply')
    expect(d.showsTax).toBe(false)
  })

  it('carries the declaration that stops the customer claiming credit', () => {
    expect(saleDocumentKind('restaurant').declaration).toBe(BILL_OF_SUPPLY_DECLARATION)
  })

  it('is a normal tax invoice for a regular shop', () => {
    const d = saleDocumentKind(null)
    expect(d.title).toBe('Tax Invoice')
    expect(d.showsTax).toBe(true)
    expect(d.declaration).toBeNull()
  })

  it('ties the title and the tax rule together, so neither can be used alone', () => {
    /*
     * Printing "Bill of Supply" above a CGST column would be worse than
     * printing neither — it asserts no tax was charged while showing tax. They
     * are returned as one object for that reason.
     */
    for (const c of [null, 'trader', 'manufacturer', 'restaurant', 'service']) {
      const d = saleDocumentKind(c)
      expect(d.showsTax).toBe(d.title === 'Tax Invoice')
      expect(d.declaration === null).toBe(d.showsTax)
    }
  })
})
