/**
 * The 180-day rule (#88) — input credit you must give back if the supplier
 * has not been paid.
 *
 * Second proviso to Section 16(2), Rule 37 as substituted by Notification
 * 19/2022-CT. Real money, and completely invisible: nothing in this app or in
 * a paper ledger counts the days since an unpaid purchase, so the first a shop
 * hears of it is a demand with interest.
 *
 * `assessItcReversal` is pure and takes plain values, so every case below runs
 * without a database.
 */

import {
  assessItcReversal,
  needsAttention,
  RULE_37_DAYS,
  WARN_WITHIN_DAYS,
} from '@/lib/itc-180-day'
import { readCode } from '@/test-support/read-source'

/** A ₹1,00,000 + 18% purchase, so proportions are easy to check by hand. */
const BILL = { totalAmount: 118000, taxAmount: 18000 }
const ASOF = new Date(2026, 7, 29)               // 29 Aug 2026
const daysBefore = (n: number) => {
  const d = new Date(ASOF); d.setDate(d.getDate() - n); return d
}

describe('the deadline itself', () => {
  test('day 180 is counted from the INVOICE date, not from month-end', () => {
    const a = assessItcReversal({ ...BILL, invoiceDate: new Date(2026, 0, 15), paidAmount: 0 }, ASOF)
    expect(a.deadline).toEqual(new Date(2026, 0, 15 + RULE_37_DAYS))
  })

  test('a bill still well inside its window is not raised at all', () => {
    const a = assessItcReversal({ ...BILL, invoiceDate: daysBefore(10), paidAmount: 0 }, ASOF)
    expect(a.status).toBe('safe')
    expect(needsAttention(a)).toBe(false)
  })

  test('the warning starts 30 days out — a payment cycle, not an alarm', () => {
    /*
     * The value is the point. A warning that arrives with three days left is
     * an alarm; 30 days is roughly a payment cycle, so the shopkeeper can pay
     * the supplier out of this month's takings and keep the credit.
     */
    const justInside = assessItcReversal(
      { ...BILL, invoiceDate: daysBefore(RULE_37_DAYS - WARN_WITHIN_DAYS), paidAmount: 0 }, ASOF)
    expect(justInside.status).toBe('due-soon')
    expect(justInside.daysLeft).toBe(WARN_WITHIN_DAYS)

    const justOutside = assessItcReversal(
      { ...BILL, invoiceDate: daysBefore(RULE_37_DAYS - WARN_WITHIN_DAYS - 1), paidAmount: 0 }, ASOF)
    expect(justOutside.status).toBe('safe')
  })

  test('day 180 exactly is still in time; day 181 is not', () => {
    // The boundary decides whether money changes hands, so it is pinned rather
    // than assumed from the comparison operator.
    expect(assessItcReversal({ ...BILL, invoiceDate: daysBefore(RULE_37_DAYS), paidAmount: 0 }, ASOF).status).toBe('due-soon')
    expect(assessItcReversal({ ...BILL, invoiceDate: daysBefore(RULE_37_DAYS + 1), paidAmount: 0 }, ASOF).status).toBe('overdue')
  })
})

describe('partial payment is the normal case, not an edge case', () => {
  test('the reversal is PROPORTIONATE to what is unpaid', () => {
    /*
     * ₹118,000 bill, ₹18,000 tax, ₹47,200 paid → ₹70,800 outstanding, which is
     * 60% of the bill. So 60% of ₹18,000 = ₹10,800 of credit is at risk.
     *
     * Treating this as paid/unpaid would be wrong on most real purchases:
     * part-payment to a supplier is ordinary trade.
     */
    const a = assessItcReversal(
      { ...BILL, invoiceDate: daysBefore(RULE_37_DAYS + 5), paidAmount: 47200 }, ASOF)
    expect(a.status).toBe('overdue')
    expect(a.unpaidAmount).toBe(70800)
    expect(a.itcAtRisk).toBe(10800)
  })

  test('money allocated from a later payment counts as paid', () => {
    /*
     * Reading `paidAmount` alone and ignoring allocations is a bug I have
     * already made once in this codebase. `computeInvoiceDue` is the one
     * definition of what remains, and this uses it rather than subtracting
     * again locally.
     */
    const a = assessItcReversal({
      ...BILL,
      invoiceDate: daysBefore(RULE_37_DAYS + 5),
      paidAmount: 18000,
      allocations: [{ amount: 100000, date: daysBefore(60) }],
    }, ASOF)
    expect(a.status).toBe('paid')
    expect(a.itcAtRisk).toBe(0)
  })
})

describe('paid — but paid LATE', () => {
  /*
   * The case that is easy to miss and easy to get wrong. The bill reads as
   * paid today and looks fine on every screen; but on day 181 money was still
   * outstanding, the reversal fell due then, and interest ran until the
   * supplier was actually paid. The credit is re-claimable now — if anyone
   * knows to claim it.
   */
  test('a supplier settled after day 180 is flagged, though nothing is owed now', () => {
    const a = assessItcReversal({
      ...BILL,
      invoiceDate: daysBefore(220),
      paidAmount: 0,
      allocations: [{ amount: 118000, date: daysBefore(10) }],   // paid on day 210
    }, ASOF)
    expect(a.status).toBe('paid-late')
    expect(a.unpaidAmount).toBe(0)
    expect(a.itcAtRisk).toBe(18000)
    expect(needsAttention(a)).toBe(true)
  })

  test('paid in time is NOT flagged, however long ago the bill was', () => {
    const a = assessItcReversal({
      ...BILL,
      invoiceDate: daysBefore(400),
      paidAmount: 0,
      allocations: [{ amount: 118000, date: daysBefore(300) }],  // day 100 — in time
    }, ASOF)
    expect(a.status).toBe('paid')
    expect(needsAttention(a)).toBe(false)
  })

  test('only the SHORTFALL at day 180 is counted, not the whole bill', () => {
    /*
     * Half was paid inside the window and half after. Only the half that was
     * outstanding on day 180 ever fell due for reversal.
     */
    const a = assessItcReversal({
      ...BILL,
      invoiceDate: daysBefore(220),
      paidAmount: 0,
      allocations: [
        { amount: 59000, date: daysBefore(100) },   // day 120 — in time
        { amount: 59000, date: daysBefore(5) },     // day 215 — late
      ],
    }, ASOF)
    expect(a.status).toBe('paid-late')
    expect(a.itcAtRisk).toBe(9000)                  // half the tax
  })

  test('billing-time payment needs no date and is never late', () => {
    // `paidAmount` is recorded ON the bill, so it is paid on the invoice date
    // by construction and always inside the window.
    const a = assessItcReversal({ ...BILL, invoiceDate: daysBefore(400), paidAmount: 118000 }, ASOF)
    expect(a.status).toBe('paid')
  })
})

describe('what the rule does not touch', () => {
  test('reverse-charge purchases are outside it entirely', () => {
    /*
     * On an RCM bill the BUYER pays the tax straight to the government, so
     * there is no "supplier has been paid the tax" condition to fail. Flagging
     * these would put a shop's ordinary freight and legal bills on a worry
     * list every month, wrongly — and a list that is wrong stops being opened.
     */
    const a = assessItcReversal(
      { ...BILL, invoiceDate: daysBefore(400), paidAmount: 0, isReverseCharge: true }, ASOF)
    expect(a.status).toBe('not-applicable')
    expect(needsAttention(a)).toBe(false)
  })

  test('credit that was never claimed cannot be reversed', () => {
    // Section 17(5) purchases carry a blocked reason precisely because no ITC
    // was taken on them.
    const a = assessItcReversal(
      { ...BILL, invoiceDate: daysBefore(400), paidAmount: 0, itcBlockedReason: 'personal' }, ASOF)
    expect(a.status).toBe('not-applicable')
  })

  test('a purchase with no GST has no credit to lose', () => {
    const a = assessItcReversal(
      { totalAmount: 5000, taxAmount: 0, invoiceDate: daysBefore(400), paidAmount: 0 }, ASOF)
    expect(a.status).toBe('not-applicable')
  })
})

describe('the message is something a shopkeeper can act on', () => {
  test('due-soon says how long is left and what it costs', () => {
    // §2 — the moat is saying whether the return will survive, in time to do
    // something about it. "Rule 37 applies" is a fact; "pay within 12 days or
    // hand back the credit" is a reason to act.
    const a = assessItcReversal({ ...BILL, invoiceDate: daysBefore(170), paidAmount: 0 }, ASOF)
    expect(a.reason).toMatch(/within 10 days/)
    expect(a.reason).toMatch(/input credit/)
  })

  test('overdue says the credit can be claimed again once paid', () => {
    // Otherwise the warning reads as pure loss and the shopkeeper has no
    // reason to act at all.
    const a = assessItcReversal({ ...BILL, invoiceDate: daysBefore(200), paidAmount: 0 }, ASOF)
    expect(a.reason).toMatch(/claim it again/)
  })

  test('paid-late sends them to their CA rather than asserting the interest', () => {
    // We can see that the reversal fell due. We cannot compute the interest —
    // that depends on the reversal and re-claim dates and the Section 50 rate,
    // and a confident wrong number here would be worse than none.
    const a = assessItcReversal({
      ...BILL, invoiceDate: daysBefore(220), paidAmount: 0,
      allocations: [{ amount: 118000, date: daysBefore(10) }],
    }, ASOF)
    expect(a.reason).toMatch(/CA/)
    expect(a.reason).toMatch(/interest may apply/)
  })
})

describe('the query is bounded by the database, not by the app', () => {
  const api = readCode('src/app/api/itc-reversal/route.ts')

  test('reverse-charge purchases never leave the database', () => {
    // They can never produce a finding, so reading them is pure waste on every
    // shop with freight bills — which is most of them.
    expect(api).toContain('isReverseCharge: false')
  })

  test('only the date band that can possibly warn is read', () => {
    /*
     * A bill newer than (180 − 30) days cannot yet be due-soon or overdue.
     * Without this the query reads every purchase a shop has ever made in
     * order to discard almost all of them.
     */
    expect(api).toContain('date: { gte: floor, lte: horizon }')
    expect(api).toContain('RULE_37_DAYS - WARN_WITHIN_DAYS')
  })

  test('a deleted payment does not count as money reaching the supplier', () => {
    // A deleted payment never happened. Counting its allocation would show a
    // bill as paid and quietly drop a real reversal.
    expect(api).toContain('.filter(a => !a.payment.deletedAt)')
  })

  test('the scan cap is reported when it bites', () => {
    /*
     * A silent limit here is worse than most: clear nine warnings, see an
     * empty list, conclude the credit is safe.
     */
    expect(api).toContain('SCAN_CAP')
    expect(api).toContain('truncationNote')
  })

  test('totals are computed from the same arrays the screen lists', () => {
    // A count that disagrees with its own list is how a compliance figure
    // stops being believed.
    expect(api).toContain('overdue.reduce((s, f) => s + f.itcAtRisk, 0)')
  })
})

describe('the warning is mounted and ordered to be useful', () => {
  const ui = readCode('src/components/reports/ItcReversalWarning.tsx')
  const report = readCode('src/components/reports/Gstr3bReport.tsx')

  test('it is actually rendered on GSTR-3B', () => {
    /*
     * A correct engine with no surface is not a feature — this codebase has
     * shipped that four times, most recently the composition returns. Mounted
     * on GSTR-3B because that is where the reversal is declared and where a
     * shopkeeper is already thinking about the month's credit.
     */
    expect(report).toContain('<ItcReversalWarning />')
    expect(report).toContain("from '@/components/reports/ItcReversalWarning'")
  })

  test('DUE SOON renders above OVERDUE, though overdue is more serious', () => {
    /*
     * Overdue credit is already lost until the supplier is paid. Due-soon
     * credit can still be KEPT, and keeping it costs one payment. Ordering by
     * severity would bury the only rows this screen can actually help with.
     */
    expect(ui.indexOf('dueSoon.length > 0')).toBeLessThan(ui.indexOf('overdue.length > 0'))
  })

  test('the overdue message says the credit comes back', () => {
    // A warning that reads as pure loss gives nobody a reason to act.
    expect(ui).toContain('claim it back')
  })

  test('it does not claim to compute the interest or fill GSTR-3B', () => {
    /*
     * Interest depends on the reversal and re-claim dates and the Section 50
     * rate. A confident wrong number on money owed to the department would be
     * worse than no number at all.
     */
    expect(ui).toContain('we do not calculate the interest')
    expect(ui).toContain('We do not fill the reversal into your')
  })

  test('a shop with nothing due sees nothing', () => {
    expect(ui).toContain('data.findingCount === 0) return null')
  })
})
