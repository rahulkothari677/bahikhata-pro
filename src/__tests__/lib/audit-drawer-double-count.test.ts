/**
 * 🔒 THE CASH DRAWER MUST NOT COUNT THE SAME RUPEE TWICE.
 *
 * Reported by Rahul, 2026-08-03, from the live app:
 *
 *   "in close counter in dashboard my amount in expected amount in drawer is
 *    showing 1000. while it should be just 600. because today i made a sale of
 *    600 but the constumer just paid 200 and then reamaining 400 i collected
 *    from udhaar."
 *
 * INV-0043: ₹600 cash sale, ₹200 paid at billing, ₹400 settled later.
 *
 * The drawer summed `totalAmount` for sales — the INVOICE value — which treats
 * every sale as if it were paid in full on the spot. The ₹400 collected later
 * was then added again as a Settle payment. ₹600 + ₹400 = ₹1,000, against ₹600
 * of actual cash.
 *
 * This is the same defect class as the July double-count: one sum of money
 * reaching a total by two different routes. It matters more here than on a
 * screen, because the shopkeeper counts the physical drawer against this
 * number — a ₹400 phantom surplus reads as ₹400 MISSING from the till, and
 * that is how someone gets wrongly accused of theft.
 *
 * These tests exercise the arithmetic directly. The route itself is exercised
 * against the schema by the guard at the bottom.
 */

import fs from 'fs'
import path from 'path'
import { roundMoney } from '@/lib/money'

/** The corrected drawer formula, mirroring src/app/api/day-summary/route.ts. */
function expectedDrawer(input: {
  cashInFromSales?: number
  cashIncome?: number
  udhaarCollectedCash?: number
  cashRefundsIn?: number
  cashOutForPurchases?: number
  cashExpenses?: number
  udhaarPaidCash?: number
  cashRefundsOut?: number
}): number {
  const v = (n?: number) => roundMoney(n || 0)
  return roundMoney(
    v(input.cashInFromSales) + v(input.cashIncome) + v(input.udhaarCollectedCash) + v(input.cashRefundsIn)
    - v(input.cashOutForPurchases) - v(input.cashExpenses) - v(input.udhaarPaidCash) - v(input.cashRefundsOut),
  )
}

describe('Cash drawer — Rahul\'s reported case', () => {
  test('₹600 sale, ₹200 at billing, ₹400 settled later = ₹600 in the drawer', () => {
    expect(expectedDrawer({ cashInFromSales: 200, udhaarCollectedCash: 400 })).toBe(600)
  })

  test('the old formula would have said ₹1,000 — proving the test can fail', () => {
    // Invoice total instead of amount received: the exact bug.
    const buggy = roundMoney(600 /* totalAmount */ + 400 /* udhaar */)
    expect(buggy).toBe(1000)
    expect(buggy).not.toBe(expectedDrawer({ cashInFromSales: 200, udhaarCollectedCash: 400 }))
  })

  test('a fully-paid cash sale still counts once', () => {
    expect(expectedDrawer({ cashInFromSales: 600, udhaarCollectedCash: 0 })).toBe(600)
  })

  test('a pure credit sale puts nothing in the drawer until it is collected', () => {
    expect(expectedDrawer({ cashInFromSales: 0 })).toBe(0)
    expect(expectedDrawer({ cashInFromSales: 0, udhaarCollectedCash: 600 })).toBe(600)
  })
})

describe('Cash drawer — only CASH belongs in it', () => {
  test('a settlement taken by UPI is collected, but not in the drawer', () => {
    // ₹400 settled by UPI: udhaarCollected is 400, udhaarCollectedCash is 0.
    expect(expectedDrawer({ cashInFromSales: 200, udhaarCollectedCash: 0 })).toBe(200)
  })

  test('cash out reduces the drawer', () => {
    expect(expectedDrawer({
      cashInFromSales: 1000, cashOutForPurchases: 300, cashExpenses: 150, udhaarPaidCash: 50,
    })).toBe(500)
  })

  test('refunds move cash in the direction the money goes', () => {
    // Credit note = we hand money back → out. Debit note = supplier repays us → in.
    expect(expectedDrawer({ cashInFromSales: 1000, cashRefundsOut: 250 })).toBe(750)
    expect(expectedDrawer({ cashInFromSales: 1000, cashRefundsIn: 250 })).toBe(1250)
  })

  test('an unrefunded credit note moves no cash', () => {
    // resolveFinalPaid() defaults a note's paidAmount to 0, so nothing leaves
    // the drawer until the refund is actually handed over.
    expect(expectedDrawer({ cashInFromSales: 1000, cashRefundsOut: 0 })).toBe(1000)
  })
})

describe('the route computes the drawer from paidAmount, not totalAmount', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/day-summary/route.ts'), 'utf8',
  )

  test('the scan reaches the route', () => {
    expect(src).toMatch(/expectedCash/)
    expect(src.length).toBeGreaterThan(1000)
  })

  test('paidAmount is selected alongside totalAmount', () => {
    expect(src).toMatch(/_sum:\s*\{\s*totalAmount:\s*true,\s*paidAmount:\s*true\s*\}/)
  })

  test('payments are grouped by mode, so non-cash stays out of the drawer', () => {
    expect(src).toMatch(/by:\s*\['type',\s*'mode'\]/)
    expect(src).toMatch(/udhaarCollectedCash/)
    expect(src).toMatch(/udhaarPaidCash/)
  })

  test('expectedCash uses the cash terms, never the revenue ones', () => {
    // lastIndexOf: an earlier `return NextResponse.json` (the 403 guard) sits
    // ABOVE the formula, and slicing to it produced an empty string that
    // matched nothing and passed vacuously.
    const start = src.indexOf('const expectedCash =')
    const formula = src.slice(start, src.lastIndexOf('return NextResponse.json'))
    expect(start).toBeGreaterThan(-1)
    expect(formula.length).toBeGreaterThan(50)
    expect(formula).toMatch(/cashInFromSales/)
    expect(formula).toMatch(/udhaarCollectedCash/)
    // The revenue accumulators must not appear in the cash formula. `cashSales`
    // is a totalAmount figure and putting it back here reintroduces the bug.
    expect(formula).not.toMatch(/\bcashSales\b/)
    expect(formula).not.toMatch(/\budhaarCollected\b(?!Cash)/)
  })
})
