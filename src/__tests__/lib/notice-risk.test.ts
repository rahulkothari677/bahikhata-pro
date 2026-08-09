/**
 * Rule 88C / 88D — the thresholds, and the trap in them.
 *
 * THE TRAP: both rules fire only when the excess is over 20% **AND** over
 * ₹25 lakh. Nearly every summary of Rule 88C online states it as "20% or
 * ₹25 lakh", and getting it wrong is expensive in both directions:
 *
 *   read as OR  -> we warn a ₹6 lakh shop about a notice that cannot happen,
 *                  they learn the panel lies, and they ignore the real one
 *   miss the AND -> we reassure a shop that is about to have its next GSTR-1
 *                  blocked
 *
 * So the boundary cases below are the point of this file, not padding.
 */

import {
  assessRule88C,
  assessRule88D,
  assessNoticeRisk,
  RULE_88C,
  RESPONSE_DAYS,
} from '@/lib/notice-risk'

describe('Rule 88C — GSTR-1 declares more tax than GSTR-3B pays', () => {
  test('returns that agree carry no risk', () => {
    const r = assessRule88C(100_000, 100_000)
    expect(r.level).toBe('clear')
    expect(r.excess).toBe(0)
    expect(r.consequence).toBeNull()
    expect(r.action).toBeNull()
  })

  test('paying MORE than declared is not a risk', () => {
    // Overpaying is a problem for the shopkeeper's cash, but it is not what
    // Rule 88C polices and must never be dressed up as a notice.
    const r = assessRule88C(80_000, 100_000)
    expect(r.level).toBe('clear')
    expect(r.excess).toBe(-20_000)
  })

  test('over BOTH limits is an automatic notice', () => {
    // 3B paid ₹1cr, GSTR-1 declares ₹1.31cr -> excess ₹31L = 31% and > ₹25L.
    const r = assessRule88C(13_100_000, 10_000_000)
    expect(r.level).toBe('notice')
    expect(r.excess).toBe(3_100_000)
    expect(r.crossedPercent).toBe(true)
    expect(r.crossedAbsolute).toBe(true)
    expect(r.consequence).toMatch(/DRC-01B/)
    expect(r.consequence).toMatch(new RegExp(`${RESPONSE_DAYS} days`))
    // The consequence that actually changes behaviour is the block, so it has
    // to be stated, not implied.
    expect(r.consequence).toMatch(/next GSTR-1/i)
  })

  test('over the PERCENTAGE but under ₹25 lakh is NOT a notice', () => {
    // A small shop: ₹1L paid, ₹2L declared. 100% over - but only ₹1L.
    // Read as OR, this would wrongly scream "notice".
    const r = assessRule88C(200_000, 100_000)
    expect(r.crossedPercent).toBe(true)
    expect(r.crossedAbsolute).toBe(false)
    expect(r.level).toBe('difference')
    expect(r.consequence).not.toMatch(/DRC-01B/)
  })

  test('over ₹25 lakh but under the percentage is NOT a notice', () => {
    // A large shop: ₹10cr paid, ₹10.3cr declared. ₹30L over - but only 3%.
    const r = assessRule88C(103_000_000, 100_000_000)
    expect(r.crossedAbsolute).toBe(true)
    expect(r.crossedPercent).toBe(false)
    expect(r.level).toBe('difference')
  })

  test('a real shortfall is still reported when it is under the limits', () => {
    // The panel must never say "you are fine" about unpaid tax. It is simply
    // not ESCALATED - a different statement from being correct.
    const r = assessRule88C(200_000, 100_000)
    expect(r.level).toBe('difference')
    expect(r.excess).toBe(100_000)
    expect(r.consequence).toMatch(/short/i)
    expect(r.action).toBeTruthy()
  })

  test('the thresholds are strictly greater-than, not equal', () => {
    // Exactly on both limits does not fire. ₹25,00,000 excess on a ₹1cr base
    // is exactly 25% (over 20%) but exactly ₹25L, not MORE than it.
    const exactlyAbsolute = assessRule88C(10_000_000 + RULE_88C.ABSOLUTE, 10_000_000)
    expect(exactlyAbsolute.crossedAbsolute).toBe(false)
    expect(exactlyAbsolute.level).toBe('difference')

    // One rupee more, and it does.
    const onePastIt = assessRule88C(10_000_000 + RULE_88C.ABSOLUTE + 1, 10_000_000)
    expect(onePastIt.crossedAbsolute).toBe(true)
    expect(onePastIt.level).toBe('notice')
  })

  test('exactly 20% does not cross the percentage limit', () => {
    // ₹20L excess on a ₹1cr base is exactly 20%. The rule says MORE than 20%.
    const r = assessRule88C(12_000_000, 10_000_000)
    expect(r.excess).toBe(2_000_000)
    expect(r.excessPercent).toBe(20)
    expect(r.crossedPercent).toBe(false)
    // and one rupee past it does cross
    expect(assessRule88C(12_000_001, 10_000_000).crossedPercent).toBe(true)
  })

  test('a nil GSTR-3B does not divide by zero', () => {
    // A shop that filed a nil 3B but declared sales in GSTR-1. The percentage
    // is meaningless here, so the rupee limit is the only real test.
    const small = assessRule88C(50_000, 0)
    expect(Number.isFinite(small.excessPercent)).toBe(false)
    expect(small.level).toBe('difference')   // ₹50k is under ₹25L

    const large = assessRule88C(5_000_000, 0)
    expect(large.level).toBe('notice')       // ₹50L clears both
  })
})

describe('Rule 88D — claiming more credit than GSTR-2B allows', () => {
  test('a claim within 2B is clear', () => {
    const r = assessRule88D(90_000, 100_000)
    expect(r.level).toBe('clear')
  })

  test('over both limits triggers DRC-01C', () => {
    const r = assessRule88D(13_100_000, 10_000_000)
    expect(r.level).toBe('notice')
    expect(r.consequence).toMatch(/DRC-01C/)
    expect(r.consequence).toMatch(/next GSTR-1/i)
  })

  test('a modest over-claim cites Rule 36(4) rather than a notice', () => {
    // The everyday case: a supplier has not filed. No notice, but the credit
    // still cannot be taken, and THAT is the useful thing to say.
    const r = assessRule88D(150_000, 100_000)
    expect(r.level).toBe('difference')
    expect(r.consequence).toMatch(/36\(4\)/)
    expect(r.action).toMatch(/supplier/i)
  })
})

describe('the combined assessment', () => {
  test('with no GSTR-2B imported, Rule 88D is not assessed at all', () => {
    /*
     * THE BUG THIS PREVENTS: a missing 2B reads as "zero credit available",
     * so an ordinary ₹4L claim would be reported as a ₹4L excess - accusing a
     * shop of over-claiming purely because they have not uploaded a file.
     * Silence is correct; the screen asks for the import separately.
     */
    const r = assessNoticeRisk({
      gstr1Tax: 100_000, gstr3bTax: 100_000,
      gstr3bItc: 400_000, gstr2bItc: 0,
      hasGstr2b: false,
    })
    expect(r.rules.map(x => x.rule)).toEqual(['88C'])
    expect(r.overall).toBe('clear')
    expect(r.anyNotice).toBe(false)
  })

  test('with a 2B imported, the same numbers DO raise 88D', () => {
    const r = assessNoticeRisk({
      gstr1Tax: 100_000, gstr3bTax: 100_000,
      gstr3bItc: 400_000, gstr2bItc: 0,
      hasGstr2b: true,
    })
    expect(r.rules.map(x => x.rule)).toEqual(['88C', '88D'])
    expect(r.overall).toBe('difference')
  })

  test('overall takes the WORST rule, not the first', () => {
    // 88C clean, 88D a notice. A summary card driven by the first rule would
    // show "all clear" above a blocking intimation.
    const r = assessNoticeRisk({
      gstr1Tax: 100_000, gstr3bTax: 100_000,
      gstr3bItc: 13_100_000, gstr2bItc: 10_000_000,
      hasGstr2b: true,
    })
    expect(r.rules[0].level).toBe('clear')
    expect(r.overall).toBe('notice')
    expect(r.anyNotice).toBe(true)
  })

  test('a clean month is clean', () => {
    const r = assessNoticeRisk({
      gstr1Tax: 162.5, gstr3bTax: 162.5,
      gstr3bItc: 0, gstr2bItc: 0,
      hasGstr2b: true,
    })
    expect(r.overall).toBe('clear')
    expect(r.anyNotice).toBe(false)
    expect(r.rules.every(x => x.consequence === null)).toBe(true)
  })
})
