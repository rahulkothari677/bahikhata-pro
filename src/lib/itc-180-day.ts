/**
 * The 180-day rule — input credit you must give back if you have not paid your
 * supplier.
 *
 * ── THE RULE, IN THE SHOPKEEPER'S TERMS ─────────────────────────────────
 *
 * You buy stock on credit. You claim the GST on that bill as input credit
 * straight away, which reduces the tax you pay that month. If you then do not
 * pay the supplier within 180 days of the INVOICE date, that credit was never
 * really yours: you must reverse it, WITH INTEREST. Pay the supplier later and
 * you can claim it again.
 *
 * Second proviso to Section 16(2), and Rule 37 as substituted by Notification
 * 19/2022-Central Tax (effective 1 Oct 2022), which moved the reversal into
 * GSTR-3B Table 4(B)(2) instead of adding it to output tax. Interest under
 * Section 50.
 *
 * ── WHY IT IS WORTH BUILDING ────────────────────────────────────────────
 *
 * It is real money and it is completely invisible. Nothing in this app, or in
 * a paper ledger, counts the days since an unpaid purchase. The first a shop
 * hears of it is a demand with interest attached — long after the cheap moment
 * to act (paying the supplier) has passed.
 *
 * So the point of this file is the WARNING, not the report. Telling someone
 * they should have reversed credit four months ago is bookkeeping. Telling
 * them "pay this supplier within 12 days or hand back ₹1,800" is the moat:
 * §2 — we say whether the return will survive, before it is filed.
 *
 * ── PARTIAL PAYMENT IS THE NORMAL CASE ──────────────────────────────────
 *
 * The reversal is PROPORTIONATE to what is still unpaid. A ₹1,00,000 bill with
 * ₹40,000 outstanding reverses 40% of its credit, not all of it and not none.
 * Treating this as paid/unpaid would be wrong on most real purchases, because
 * part-payment to a supplier is ordinary trade rather than an edge case.
 *
 * ── WHAT COUNTS AS PAID, AND WHEN ───────────────────────────────────────
 *
 * Money reaches a bill by two routes: recorded on the bill at billing time, or
 * allocated to it afterwards from a payment. `computeInvoiceDue` is this
 * project's ONE definition of what remains, and it is used here rather than a
 * second subtraction written locally — reading `paidAmount` alone is a bug I
 * have already made once in this codebase.
 *
 * But this rule needs something `computeInvoiceDue` does not carry: WHEN. A
 * supplier paid on day 200 was late — the credit was reversible on day 181 and
 * re-claimable on day 200 — so allocations are passed with their payment dates
 * and only those landing inside the window count towards the deadline.
 */
import { roundMoney } from './money'
import { computeInvoiceDue } from './invoice-due'

/** Second proviso to Section 16(2). Days from the invoice date, not from month-end. */
export const RULE_37_DAYS = 180

/**
 * How long before the deadline we start warning.
 *
 * Chosen to be actionable rather than tidy: 30 days is roughly a payment cycle,
 * so a shopkeeper who sees it still has time to pay the supplier out of the
 * month's takings. A warning that arrives with three days left is an alarm, not
 * a chance to act.
 */
export const WARN_WITHIN_DAYS = 30

export interface Allocation {
  amount: number
  /** The PAYMENT's date, not the allocation's createdAt. */
  date: Date | string
}

export interface PurchaseForItc {
  invoiceDate: Date | string
  totalAmount: number
  /** Recorded on the bill at billing time. */
  paidAmount?: number | null
  /** Payments allocated to this bill, each with the date the money moved. */
  allocations?: Allocation[]
  /** Total GST on the bill — the credit that was claimed. */
  taxAmount: number
  /** Reverse-charge purchases are outside this rule. See below. */
  isReverseCharge?: boolean | null
  /** Section 17(5): credit was never claimed, so there is nothing to reverse. */
  itcBlockedReason?: string | null
}

export type ItcReversalStatus =
  /** Fully paid — nothing at risk. */
  | 'paid'
  /** Unpaid, but the deadline is more than WARN_WITHIN_DAYS away. */
  | 'safe'
  /** Unpaid and the deadline is close. The only status that can still be acted on cheaply. */
  | 'due-soon'
  /** Past 180 days with money still outstanding. Credit should already be reversed. */
  | 'overdue'
  /**
   * Settled — but only AFTER day 180 had passed.
   *
   * Easy to miss and easy to get wrong. The bill reads as paid today, so
   * nothing on any screen suggests a problem; but on day 181 there was money
   * outstanding, the reversal fell due then, and interest ran until the
   * supplier was actually paid. The credit is re-claimable now, which is the
   * good news, but only if somebody knows to claim it.
   */
  | 'paid-late'
  /** The rule does not apply to this purchase at all. */
  | 'not-applicable'

export interface ItcReversalAssessment {
  status: ItcReversalStatus
  /** Day 180 counted from the invoice date. Null when not applicable. */
  deadline: Date | null
  /** Negative once past. Null when not applicable. */
  daysLeft: number | null
  /** Still owed to the supplier. */
  unpaidAmount: number
  /** The share of claimed credit that must be handed back if this stays unpaid. */
  itcAtRisk: number
  /** Plain sentence for the screen. */
  reason: string
}

const NOT_APPLICABLE = (reason: string): ItcReversalAssessment => ({
  status: 'not-applicable',
  deadline: null,
  daysLeft: null,
  unpaidAmount: 0,
  itcAtRisk: 0,
  reason,
})

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}

/** Whole days between two dates, counted on calendar days rather than hours. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

/**
 * Judge one purchase.
 *
 * Pure, and takes plain values, so it can be exercised against a known-good and
 * a known-bad input without a database — the rule this codebase earned after
 * five guards that could not fail.
 */
export function assessItcReversal(
  p: PurchaseForItc,
  asOn: Date = new Date(),
): ItcReversalAssessment {
  /*
   * REVERSE CHARGE IS OUTSIDE THE RULE, and this is checked first.
   *
   * On an RCM purchase the BUYER pays the tax straight to the government, not
   * to the supplier. There is no "supplier has been paid the tax" condition to
   * fail, so no reversal can arise. Flagging these would put a shopkeeper's
   * most common freight and legal bills on a list of things to worry about,
   * every month, wrongly — and a list that is wrong is a list people stop
   * opening.
   */
  if (p.isReverseCharge) {
    return NOT_APPLICABLE('Tax on this purchase is paid by you directly under reverse charge, so the 180-day rule does not apply.')
  }

  /*
   * Credit that was never claimed cannot be reversed. Section 17(5) purchases
   * carry a blocked reason precisely because no ITC was taken on them.
   */
  if (p.itcBlockedReason) {
    return NOT_APPLICABLE('No input credit was claimed on this purchase, so there is nothing to reverse.')
  }

  const taxAmount = roundMoney(p.taxAmount || 0)
  if (taxAmount <= 0) {
    return NOT_APPLICABLE('This purchase carries no GST, so there is no input credit to reverse.')
  }

  const totalAmount = roundMoney(p.totalAmount || 0)
  const allocations = p.allocations ?? []
  const allocatedTotal = roundMoney(allocations.reduce((s, a) => s + roundMoney(a.amount || 0), 0))

  /*
   * ONE definition of what is still owed — see lib/invoice-due.ts. Written
   * locally it would be a second subtraction that can drift from the party
   * balance, the bill screen and the statement, which is the exact class of
   * bug that file exists to prevent.
   */
  const unpaidAmount = computeInvoiceDue({
    totalAmount,
    paidAmount: p.paidAmount,
    allocatedAmount: allocatedTotal,
  })

  const invoiceDate = asDate(p.invoiceDate)
  const deadline = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth(), invoiceDate.getDate() + RULE_37_DAYS)
  const daysLeft = daysBetween(asOn, deadline)

  if (unpaidAmount <= 0) {
    /*
     * PAID — but was it paid IN TIME?
     *
     * This is where the payment dates earn their place. A bill settled on day
     * 200 reads as paid today and looks entirely fine on every screen, yet on
     * day 181 there was money outstanding: the reversal fell due then and
     * interest ran until the supplier was actually paid.
     *
     * `paidAmount` needs no date — it is recorded ON the bill at billing time,
     * so it is paid on the invoice date by construction and always inside the
     * window. Only allocations can arrive late.
     */
    const paidByDeadline = roundMoney(
      roundMoney(p.paidAmount || 0) +
      allocations
        .filter(a => asDate(a.date) <= deadline)
        .reduce((s, a) => s + roundMoney(a.amount || 0), 0),
    )
    const shortAtDeadline = roundMoney(totalAmount - paidByDeadline)

    /*
     * Only meaningful once the deadline has actually passed. A bill fully paid
     * on day 20 has a "shortfall at day 180" of zero anyway, but a bill still
     * within its window and already paid must not be judged against a deadline
     * that has not arrived.
     */
    if (daysLeft < 0 && shortAtDeadline > 0) {
      const missedItc = totalAmount > 0 ? roundMoney((taxAmount * shortAtDeadline) / totalAmount) : 0
      return {
        status: 'paid-late',
        deadline,
        daysLeft,
        unpaidAmount: 0,
        itcAtRisk: missedItc,
        reason: `This supplier was paid, but only after the 180-day limit passed on ${deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. ₹${shortAtDeadline.toLocaleString('en-IN')} was still owed on that date, so the credit on it should have been reversed then and claimed again once you paid. Check this one with your CA — interest may apply.`,
      }
    }

    return {
      status: 'paid',
      deadline,
      daysLeft,
      unpaidAmount: 0,
      itcAtRisk: 0,
      reason: 'This bill is fully paid, so the credit on it is safe.',
    }
  }

  /*
   * PROPORTIONATE, not all-or-nothing. Rule 37 reverses the credit that
   * corresponds to the unpaid part of the invoice, so a bill 40% outstanding
   * reverses 40% of its tax. Part-payment to a supplier is ordinary trade,
   * which makes this the normal case rather than the exception.
   */
  const itcAtRisk = totalAmount > 0
    ? roundMoney((taxAmount * unpaidAmount) / totalAmount)
    : 0

  if (daysLeft < 0) {
    return {
      status: 'overdue',
      deadline,
      daysLeft,
      unpaidAmount,
      itcAtRisk,
      reason: `180 days passed on ${deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} and ₹${unpaidAmount.toLocaleString('en-IN')} is still unpaid. This credit should be reversed in GSTR-3B, with interest. Paying the supplier lets you claim it again.`,
    }
  }

  if (daysLeft <= WARN_WITHIN_DAYS) {
    return {
      status: 'due-soon',
      deadline,
      daysLeft,
      unpaidAmount,
      itcAtRisk,
      reason: `Pay this supplier within ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} or you must hand back the input credit on the unpaid part, with interest.`,
    }
  }

  return {
    status: 'safe',
    deadline,
    daysLeft,
    unpaidAmount,
    itcAtRisk,
    reason: `Unpaid, but you have ${daysLeft} days before the 180-day limit.`,
  }
}

/**
 * Does this purchase belong on a screen at all?
 *
 * 'safe' and 'paid' deliberately do not. A list showing every unpaid purchase
 * is the purchases ledger, which already exists; this is a warning, and a
 * warning that includes things nobody needs to act on stops being read.
 */
export function needsAttention(a: ItcReversalAssessment): boolean {
  return a.status === 'due-soon' || a.status === 'overdue' || a.status === 'paid-late'
}
