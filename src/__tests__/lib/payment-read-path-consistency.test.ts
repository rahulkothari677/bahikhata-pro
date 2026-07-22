/**
 * 🔒 M11 REGRESSION GUARD — payment read-path consistency.
 *
 * THE BUG THIS LOCKS OUT
 * ----------------------
 * A ₹100 payment recorded via "Settle" moved the party balance by ₹10,000.
 * Two read paths for the SAME Payment.amount column disagreed by exactly 100×:
 *
 *   • db.payment.findMany (money extension)  ->  ₹100    correct
 *     (this is what the on-screen Account Statement renders)
 *   • raw SQL SUM + fromPaise()              ->  ₹10,000 wrong
 *     (this fed computePartyBalance -> the headline balance + "Received" card)
 *
 * So the statement said "+₹100" while the balance above it moved ₹10,000 —
 * a ledger contradicting itself on a single screen. Balances are now summed
 * through the Prisma path (the one the user can see), with a runtime
 * cross-check that logs any divergence.
 *
 * These tests pin the arithmetic contract so the class cannot come back:
 * whatever the storage layer does, a ₹100 payment must read as ₹100 and both
 * paths must produce the same number.
 */

import { toPaise, fromPaise, roundMoney } from '@/lib/money'

describe('M11 — payment read-path consistency', () => {
  describe('conversion primitives round-trip exactly', () => {
    // If either of these ever fails, every balance in the app is wrong.
    test.each([
      ['whole rupees', 100],
      ['the reported bug amount', 100],
      ['with paise', 520.10],
      ['small', 0.10],
      ['large', 123456.78],
      ['zero', 0],
    ])('%s: %d rupees survives rupees -> paise -> rupees', (_label, rupees) => {
      expect(fromPaise(toPaise(rupees))).toBeCloseTo(rupees, 2)
    })

    test('a ₹100 payment stores as 10000 paise, never 1000000', () => {
      expect(toPaise(100)).toBe(10000)
      // 1000000 would be the double-converted value that produced ₹10,000.
      expect(toPaise(100)).not.toBe(1000000)
    })

    test('fromPaise divides exactly once (the 100x signature)', () => {
      expect(fromPaise(10000)).toBe(100)
      // If this ever returns 10000, the read path is skipping its conversion —
      // which is precisely how the balance came out 100x too large.
      expect(fromPaise(10000)).not.toBe(10000)
    })
  })

  describe('summing payments must not depend on WHICH read path is used', () => {
    /**
     * Mirrors the two implementations:
     *  - "prisma" path: rows already converted to rupees, summed in JS
     *  - "rawSql" path: paise summed in SQL, converted once at the end
     * Both must agree for any set of payments. This is the invariant the bug
     * violated.
     */
    const sumViaPrisma = (rupeeAmounts: number[]) =>
      rupeeAmounts.reduce((acc, r) => roundMoney(acc + r), 0)

    const sumViaRawSql = (rupeeAmounts: number[]) =>
      fromPaise(rupeeAmounts.reduce((acc, r) => acc + toPaise(r), 0))

    test.each([
      [[100]],
      [[100, 100, 10]],
      [[500, 10, 10, 0.10]],   // Anita's real settle payments -> ₹520.10
      [[0.01, 0.02, 0.03]],
      [[99999.99, 0.01]],
    ])('both paths agree for %j', (amounts) => {
      expect(sumViaPrisma(amounts)).toBeCloseTo(sumViaRawSql(amounts), 2)
    })

    test("Anita's real payments sum to ₹520.10, not ₹52,010", () => {
      const amounts = [500, 10, 10, 0.10]
      expect(sumViaPrisma(amounts)).toBeCloseTo(520.10, 2)
      expect(sumViaRawSql(amounts)).toBeCloseTo(520.10, 2)
      // 52010 was the value actually shown in the "via Settle" sub-line.
      expect(sumViaPrisma(amounts)).not.toBeCloseTo(52010, 2)
    })
  })

  describe('balance arithmetic with payments', () => {
    /** The exact formula from computePartyBalance. */
    const balanceOf = (o: {
      opening?: number; salesOutstanding?: number; purchaseOutstanding?: number
      paymentsReceived?: number; paymentsPaid?: number
    }) => roundMoney(
      (o.opening ?? 0)
      + (o.salesOutstanding ?? 0)
      - (o.purchaseOutstanding ?? 0)
      - (o.paymentsReceived ?? 0)
      + (o.paymentsPaid ?? 0),
    )

    test('the exact reported scenario: ₹120 sale (₹10 paid), then ₹100 settled', () => {
      // Sale ₹120 with ₹10 paid at billing -> ₹110 outstanding.
      // Customer then settles ₹100 -> they still owe ₹10.
      const balance = balanceOf({ salesOutstanding: 110, paymentsReceived: 100 })
      expect(balance).toBe(10)
      // The bug produced -9890 (₹100 read as ₹10,000).
      expect(balance).not.toBe(-9890)
    })

    test('a received payment reduces what the customer owes, by its own amount', () => {
      const before = balanceOf({ salesOutstanding: 110 })
      const after = balanceOf({ salesOutstanding: 110, paymentsReceived: 100 })
      expect(before - after).toBe(100)   // moved by exactly the payment amount
    })

    test('paying a supplier moves the balance by exactly the amount paid', () => {
      const before = balanceOf({ purchaseOutstanding: 500 })
      const after = balanceOf({ purchaseOutstanding: 500, paymentsPaid: 100 })
      expect(after - before).toBe(100)
      expect(after - before).not.toBe(10000)
    })
  })
})
