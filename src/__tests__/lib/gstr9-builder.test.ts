/**
 * GSTR-9 — the annual return, built from what was FILED.
 *
 * The two things that would make this dangerous rather than merely wrong:
 *
 *  1. BUILDING FROM TODAY'S BOOKS instead of the filed returns. Every table in
 *     the real form says "as declared in returns filed during the financial
 *     year". Books change after filing; if GSTR-9 recomputed, it would
 *     disagree with the twelve returns it summarises, and that difference
 *     looks like fraud rather than like an edit.
 *
 *  2. QUIETLY SUMMING A PARTIAL YEAR. Nine months of twelve produces a total
 *     that looks completely normal. Nothing about it says "this is missing a
 *     quarter" unless we say it.
 *
 * Both are tested below by construction, not by inspection.
 */

import { buildGstr9, financialYearMonths, type FiledMonth3b, type FiledMonth1 } from '@/lib/gstr9-builder'

function month3b(monthYear: string, over: Partial<FiledMonth3b> = {}): FiledMonth3b {
  return {
    monthYear, filingStatus: 'filed',
    outwardTaxableValue: 0, outwardCgst: 0, outwardSgst: 0, outwardIgst: 0,
    nilRatedValue: 0, exemptValue: 0, nonGstValue: 0,
    rcmTaxableValue: 0, rcmCgst: 0, rcmSgst: 0, rcmIgst: 0,
    itcTaxableValue: 0, itcCgst: 0, itcSgst: 0, itcIgst: 0,
    creditNoteTaxableValue: 0, creditNoteCgst: 0, creditNoteSgst: 0, creditNoteIgst: 0,
    debitNoteTaxableValue: 0, debitNoteCgst: 0, debitNoteSgst: 0, debitNoteIgst: 0,
    ...over,
  }
}

/** A stored GSTR-1 with one B2B invoice and one B2CS row. */
function month1(monthYear: string, opts: { b2b?: number; b2c?: number; status?: string } = {}): FiledMonth1 {
  const { b2b = 0, b2c = 0, status = 'filed' } = opts
  return {
    monthYear, filingStatus: status,
    rawJson: {
      b2b: b2b ? [{ ctin: '27AAAAA0000A1Z5', inv: [{ inum: 'INV-1', itms: [{ itm_det: { txval: b2b, camt: b2b * 0.09, samt: b2b * 0.09, iamt: 0, csamt: 0 } }] }] }] : [],
      b2cs: b2c ? [{ txval: b2c, camt: b2c * 0.09, samt: b2c * 0.09, iamt: 0, csamt: 0 }] : [],
      b2cl: [],
    },
  }
}

describe('financialYearMonths', () => {
  test('an Indian FY runs April to March, not January to December', () => {
    const m = financialYearMonths('2026-27')
    expect(m).toHaveLength(12)
    expect(m[0]).toBe('042026')   // April 2026
    expect(m[8]).toBe('122026')   // December 2026 — still the first calendar year
    expect(m[9]).toBe('012027')   // January rolls the year over
    expect(m[11]).toBe('032027')  // March 2027 closes it
  })
})

describe('it summarises what was FILED', () => {
  test('a draft month is excluded — only filed returns count', () => {
    /*
     * The form's own words are "as declared in returns FILED". A draft is a
     * working copy that was never declared to anybody, so including it would
     * put figures in the annual return that no monthly return ever carried.
     */
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [
        month3b('042026', { outwardTaxableValue: 100000, outwardCgst: 9000, outwardSgst: 9000 }),
        month3b('052026', { outwardTaxableValue: 500000, outwardCgst: 45000, outwardSgst: 45000, filingStatus: 'draft' }),
      ],
      months1: [month1('042026', { b2b: 100000 })],
    })
    expect(r.table9.outputTax.taxableValue).toBe(100000)   // the draft's 5 lakh is absent
    expect(r.coverage.filed3b).toEqual(['042026'])
  })
})

describe('a partial year must announce itself', () => {
  test('missing months are named, and complete is false', () => {
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026'), month3b('052026')],
      months1: [month1('042026'), month1('052026')],
    })
    expect(r.coverage.complete).toBe(false)
    expect(r.coverage.missing).toHaveLength(10)
    expect(r.coverage.missing).toContain('032027')
    // and it is surfaced as a failing check, not buried in a field
    expect(r.checks.find(c => c.id === 'All twelve months filed')!.passes).toBe(false)
  })

  test('a month with a filed 3B but NO filed GSTR-1 still counts as missing', () => {
    // Half a month is not a filed month. This is the case most likely to slip
    // through, because the 3B totals look complete on their own.
    const r = buildGstr9({
      fy: '2026-27',
      months3b: financialYearMonths('2026-27').map(m => month3b(m)),
      months1: financialYearMonths('2026-27').slice(0, 11).map(m => month1(m)),
    })
    expect(r.coverage.missing).toEqual(['032027'])
    expect(r.coverage.complete).toBe(false)
  })

  test('a genuinely complete year says so', () => {
    const all = financialYearMonths('2026-27')
    const r = buildGstr9({
      fy: '2026-27',
      months3b: all.map(m => month3b(m)),
      months1: all.map(m => month1(m)),
    })
    expect(r.coverage.complete).toBe(true)
    expect(r.coverage.missing).toEqual([])
  })
})

describe('Table 4 — outward supplies on which tax is payable', () => {
  test('B2B and B2C are split from the stored GSTR-1, and summed across months', () => {
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026'), month3b('052026')],
      months1: [
        month1('042026', { b2b: 100000, b2c: 50000 }),
        month1('052026', { b2b: 200000, b2c: 25000 }),
      ],
    })
    expect(r.table4.b2b.taxableValue).toBe(300000)
    expect(r.table4.b2c.taxableValue).toBe(75000)
  })

  test('credit notes REDUCE and debit notes INCREASE the sub-total', () => {
    // Getting these two the wrong way round would understate or overstate the
    // year's liability, and the error scales with the size of the business.
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', {
        creditNoteTaxableValue: 10000, creditNoteCgst: 900, creditNoteSgst: 900,
        debitNoteTaxableValue: 4000, debitNoteCgst: 360, debitNoteSgst: 360,
      })],
      months1: [month1('042026', { b2b: 100000 })],
    })
    expect(r.table4.subTotalM.taxableValue).toBe(-6000)     // 4000 − 10000
    expect(r.table4.totalN.taxableValue).toBe(94000)        // 100000 − 6000
  })

  test('4N = 4H + 4M, which the form itself asserts', () => {
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', { creditNoteTaxableValue: 5000, rcmTaxableValue: 2000 })],
      months1: [month1('042026', { b2b: 80000, b2c: 20000 })],
    })
    expect(r.checks.find(c => c.id === '4N = 4H + 4M')!.passes).toBe(true)
  })
})

describe('Table 5 — turnover on which tax is NOT payable', () => {
  test('exempt, nil-rated and non-GST are kept apart, then sub-totalled', () => {
    // They are different things in law and the form gives each its own row.
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', { exemptValue: 3000, nilRatedValue: 2000, nonGstValue: 1000 })],
      months1: [month1('042026')],
    })
    expect(r.table5.exemptedD).toBe(3000)
    expect(r.table5.nilRatedE).toBe(2000)
    expect(r.table5.nonGstF).toBe(1000)
    expect(r.table5.subTotalG).toBe(6000)
  })

  test('total turnover takes RCM inward back OUT', () => {
    /*
     * The form's formula is 5N = 4N + 5M − 4G − 4G1. Reverse-charge INWARD
     * supplies sit in Table 4 because you owe tax on them — but they are
     * purchases, not your turnover, so they must come out again. Leaving them
     * in would inflate declared turnover and could push a shop over a
     * threshold it never actually crossed.
     */
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', { rcmTaxableValue: 20000, rcmCgst: 1800, rcmSgst: 1800 })],
      months1: [month1('042026', { b2b: 100000 })],
    })
    expect(r.table4.totalN.taxableValue).toBe(120000)        // includes RCM
    expect(r.table5.totalTurnoverN).toBe(100000)             // and takes it out
  })
})

describe('Table 6 — ITC, and the part we cannot fill', () => {
  test('the total is reported', () => {
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', { itcCgst: 900, itcSgst: 900, itcTaxableValue: 10000 })],
      months1: [month1('042026')],
    })
    expect(r.table6.totalItcPer3bA.cgst).toBe(900)
  })

  test('the three-way split is flagged as unavailable, never guessed', () => {
    /*
     * Rows 6B/C/D each split Inputs / Capital Goods / Input Services. We do
     * not record it on a purchase and it cannot be recovered afterwards.
     * Guessing would produce a return that is confidently wrong — worse than
     * one that is honestly incomplete, because nobody would check it.
     * Task #36, CA question Q4.1a.
     */
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', { itcCgst: 900 })],
      months1: [month1('042026')],
    })
    expect(r.table6.splitUnavailable).toBe(true)
  })
})

describe('the cross-check between the two returns', () => {
  test('a year where GSTR-1 and GSTR-3B disagree is caught', () => {
    // GSTR-1 says ₹100,000 of supplies; the 3B was filed declaring ₹50,000.
    // Across a year that is exactly what Rule 88C escalates.
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', { outwardTaxableValue: 50000, outwardCgst: 4500, outwardSgst: 4500 })],
      months1: [month1('042026', { b2b: 100000 })],
    })
    expect(r.checks.find(c => c.id.startsWith('Table 4 outward tax'))!.passes).toBe(false)
  })

  test('and a year where they agree passes', () => {
    const r = buildGstr9({
      fy: '2026-27',
      months3b: [month3b('042026', { outwardTaxableValue: 100000, outwardCgst: 9000, outwardSgst: 9000 })],
      months1: [month1('042026', { b2b: 100000 })],
    })
    expect(r.checks.find(c => c.id.startsWith('Table 4 outward tax'))!.passes).toBe(true)
  })
})
