/**
 * 🔒 AUDIT PASS-1 — regression cover for H4 and M4 in src/lib/money.ts.
 *
 * Both bugs shared a shape: the function's docblock stated an invariant, the
 * code broke it only in a corner, and no test pinned the invariant itself.
 * These tests assert the INVARIANTS, not worked examples, so they keep holding
 * if the implementation is rewritten.
 */

import { splitGstPaise, splitGst, distributeDiscountProportionally, roundMoney } from '@/lib/money'

describe('H4 — splitGstPaise is sign-symmetric', () => {
  test('positive odd paisa goes to CGST (documented rule)', () => {
    expect(splitGstPaise(18001)).toEqual({ cgst: 9001, sgst: 9000 })
  })

  test('negative odd paisa ALSO goes to CGST in magnitude (was the bug)', () => {
    // Before the fix: Math.ceil(-9000.5) = -9000, so SGST received the extra
    // paisa and the split silently flipped which tax carried the remainder.
    expect(splitGstPaise(-18001)).toEqual({ cgst: -9001, sgst: -9000 })
  })

  test('cgst + sgst === total exactly, both signs, odd and even', () => {
    for (const gst of [0, 1, -1, 2, -2, 18000, -18000, 18001, -18001, 99999, -99999]) {
      const { cgst, sgst } = splitGstPaise(gst)
      expect(cgst + sgst).toBe(gst)
    }
  })

  test('the paise split mirrors the rupee split it is meant to replace', () => {
    // splitGst rounds half AWAY FROM ZERO, so the two must agree on which side
    // the remainder lands. This is the property that actually keeps a future
    // paise migration from shifting a filed GSTR-1.
    for (const rupees of [180.01, -180.01, 0.01, -0.01, 7.5, -7.5]) {
      const viaRupees = splitGst(rupees)
      const viaPaise = splitGstPaise(Math.round(rupees * 100))
      expect(Math.round(viaRupees.cgst * 100)).toBe(viaPaise.cgst)
      expect(Math.round(viaRupees.sgst * 100)).toBe(viaPaise.sgst)
    }
  })
})

describe('M4 — distributeDiscountProportionally always sums to the discount', () => {
  const sum = (xs: number[]) => roundMoney(xs.reduce((a, b) => a + b, 0))

  test('sums exactly on an evenly-divisible split', () => {
    const shares = distributeDiscountProportionally([100, 100, 100], 30)
    expect(sum(shares)).toBe(30)
  })

  test('sums exactly when the proportional split does not round cleanly', () => {
    // 3 items, discount 10 → 3.33 each, residual 0.01 must land somewhere.
    const shares = distributeDiscountProportionally([100, 100, 100], 10)
    expect(sum(shares)).toBe(10)
  })

  test('sums exactly when the last item cannot absorb the residual (THE M4 BUG)', () => {
    // This is the exact input that reproduces the old behaviour. Verified
    // against the pre-fix implementation, which returned 3.01 for a 3.00
    // discount — it over-distributed by a paisa and the invoice header then
    // failed to tie to its own line items.
    //
    // Why this shape and not something rounder: the residual has to be NEGATIVE
    // (seven lines each rounding 0.428571 up to 0.43 = 3.01), and the last
    // non-zero-gross line has to have a share of 0.00 so it has no headroom to
    // give any back. The old code picked that line anyway, clamped -0.01 to 0,
    // and dropped the correction on the floor.
    //
    // Note how narrow this is: [1000, 1000, 0.01] with a 500 discount looks
    // like it should trigger it and does NOT (the proportional split happens to
    // come out exact). A test that only used the obvious-looking case would
    // have passed against the broken code.
    const gross = [1, 1, 1, 1, 1, 1, 1, 0.001]
    const shares = distributeDiscountProportionally(gross, 3)
    expect(sum(shares)).toBe(3)
    shares.forEach((s, i) => {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(gross[i])
    })
  })

  test('no share ever exceeds its own line, and none goes negative', () => {
    const cases: Array<[number[], number]> = [
      [[10, 20, 30], 15],
      [[0.05, 0.05, 999], 100],
      [[500, 0, 500], 250],
      [[1, 1, 1, 1, 1, 1, 1], 3],
      [[33.33, 66.67], 50],
    ]
    for (const [gross, discount] of cases) {
      const shares = distributeDiscountProportionally(gross, discount)
      expect(sum(shares)).toBe(roundMoney(discount))
      shares.forEach((s, i) => {
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(gross[i])
      })
    }
  })

  test('degenerate inputs stay safe', () => {
    expect(distributeDiscountProportionally([100, 100], 0)).toEqual([0, 0])
    expect(distributeDiscountProportionally([0, 0], 50)).toEqual([0, 0])
    // Discount larger than the whole bill: every line is fully discounted and
    // nothing is pushed past its own gross. The routes reject this case before
    // it reaches here, but the helper must not produce nonsense if it does.
    const over = distributeDiscountProportionally([10, 10], 999)
    over.forEach(s => expect(s).toBeLessThanOrEqual(10))
    over.forEach(s => expect(s).toBeGreaterThanOrEqual(0))
  })
})
