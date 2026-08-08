/**
 * Is this shop required to generate e-invoices?
 *
 * WHY (2026-08-08). The invoice screen offers "Generate IRN Request JSON" on
 * every B2B invoice, for every shop. Most shops using this app are nowhere near
 * the threshold and are not required to e-invoice at all — so the app has been
 * presenting a regulatory obligation to people who do not have one, with no way
 * to tell whether it applies to them.
 *
 * THE RULE (Notification 10/2023-Central Tax, in force from 1 August 2023):
 * e-invoicing is mandatory where aggregate turnover exceeded ₹5 crore in ANY
 * financial year from 2017-18 onwards.
 *
 * Three things about that rule shape this code, and each one rules out the
 * obvious implementation:
 *
 *   1. ANY YEAR SINCE 2017-18 — not last year. So it cannot be computed from
 *      Setting.priorFyTurnover, which holds one year.
 *   2. ONCE CROSSED, IT STAYS. A shop that hit ₹5 crore in 2019-20 and has
 *      since shrunk is still required to e-invoice. So it cannot be re-derived
 *      from current figures either.
 *   3. PAN-WISE, aggregating every GSTIN of the legal entity. A shop keeping
 *      one GSTIN in this app cannot see the others.
 *
 * Each of those is information the app does not have and cannot obtain. So the
 * shopkeeper declares it, and the app only offers a suggestion where its own
 * data already proves the answer — turnover it has itself recorded above the
 * threshold settles the question without asking.
 *
 * The declaration is deliberately three-valued. "Not answered" is different
 * from "no": one means the app should ask, the other means it should stay quiet.
 * Collapsing them would either nag a shop that has already said no, or silently
 * treat an unanswered shop as exempt.
 */

/** ₹5 crore, in rupees. Notification 10/2023-Central Tax. */
export const EINVOICE_TURNOVER_THRESHOLD = 5_00_00_000

export type EInvoiceApplicability =
  | { status: 'required'; reason: string; declared: boolean }
  | { status: 'not-required'; reason: string; declared: boolean }
  | { status: 'unknown'; reason: string; declared: false }

/**
 * @param declared  what the shopkeeper has said, or null if never asked
 * @param knownTurnover  the highest annual turnover this app has recorded, in
 *                       rupees — used only to PROVE applicability, never to
 *                       disprove it (see below)
 */
export function eInvoiceApplicability(
  declared: boolean | null | undefined,
  knownTurnover: number | null | undefined,
): EInvoiceApplicability {
  const turnover = Number(knownTurnover) || 0

  /*
   * The app's own data can only ever prove YES, never NO.
   *
   * Turnover it has recorded above the threshold is conclusive — that money
   * demonstrably passed through. Turnover below it proves nothing, because the
   * qualifying year may predate the app, sit under another GSTIN of the same
   * PAN, or simply not be recorded here. Treating "below" as "not required"
   * would tell a liable shop it is exempt, which is the one answer this must
   * never give wrongly.
   */
  if (turnover > EINVOICE_TURNOVER_THRESHOLD) {
    return {
      status: 'required',
      reason: `Turnover recorded in this app has crossed ₹5 crore, so e-invoicing applies.`,
      declared: false,
    }
  }

  if (declared === true) {
    return {
      status: 'required',
      reason: 'You have said your turnover crossed ₹5 crore in a year since 2017-18.',
      declared: true,
    }
  }

  if (declared === false) {
    return {
      status: 'not-required',
      reason: 'You have said your turnover has never crossed ₹5 crore since 2017-18.',
      declared: true,
    }
  }

  return {
    status: 'unknown',
    reason:
      'e-invoicing is required if your turnover crossed ₹5 crore in any year since 2017-18 — ' +
      'including years before you started using this app, and counting every GSTIN under your PAN.',
    declared: false,
  }
}
