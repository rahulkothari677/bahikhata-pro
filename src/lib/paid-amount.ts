/**
 * 🔒 AUDIT V24 §1: Shared paidAmount resolution for transaction create/edit.
 *
 * THE BUG THIS FIXES: `paidAmount` on a credit/debit note means "cash refunded"
 * (see party-balance.ts: creditNoteOutstanding = totalAmount − paidAmount, and
 * only the OUTSTANDING part reduces the party's balance). The old code defaulted
 * a missing paidAmount to totalAmount for ALL types — which is correct for a
 * sale ("leave empty for full payment") but exactly backwards for a note: an
 * empty field on a credit note meant "fully cash-refunded", so the return
 * reduced the customer's khata by ₹0. Every screen that uses computePartyBalance
 * (dashboard receivable, parties list, WhatsApp reminders, debt aging) then
 * overstated what the customer owed after every return.
 *
 * NEW RULE:
 *   - sale / purchase / income / expense: missing paid → totalAmount (unchanged)
 *   - credit-note / debit-note:           missing paid → 0 (khata adjustment,
 *     the overwhelmingly common case; a cash refund must be explicit)
 *
 * Also centralizes the FIX M3 "snap to total" clamp (an explicit paid within
 * ₹1 of the total snaps to the total, absorbing pre-round-off client values)
 * so POST and PUT can never drift apart again.
 */

import { roundMoney, toMoney } from './money'

export const NOTE_TYPES = ['credit-note', 'debit-note'] as const

export function isNoteType(type: string): boolean {
  return type === 'credit-note' || type === 'debit-note'
}

/**
 * Resolve the final stored paidAmount for a transaction.
 *
 * @param type        transaction type ('sale' | 'purchase' | 'credit-note' | ...)
 * @param paidRaw     the client-sent paidAmount (may be undefined/null/'' /number)
 * @param totalAmount the computed post-round-off invoice total
 * @param paymentMode 'cash' | 'upi' | 'card' | 'bank' | 'credit'. Optional so
 *                    existing callers keep their behaviour; 'credit' changes
 *                    what an EMPTY paid field means. See the note below.
 */
export function resolveFinalPaid(
  type: string,
  paidRaw: unknown,
  totalAmount: number,
  paymentMode?: string,
): number {
  const paid = typeof paidRaw === 'number' ? paidRaw : parseFloat(String(paidRaw))

  if (isNaN(paid)) {
    // Missing/empty paid amount — type-dependent default (the V24 §1 fix).
    if (isNoteType(type)) return 0

    /*
     * 🔒 2026-08-05 (Phase 10). An empty paid field on a CREDIT (udhaar) sale
     * means the customer paid NOTHING. It used to mean "paid in full".
     *
     * Reproduced through the app, not the API: New Sale → pick a customer →
     * add an item → Payment Mode "Credit (Udhaar)" → leave Paid Amount empty,
     * which is exactly what the field's own helper text says to do ("Leave
     * empty for full payment"). Saved a ₹129.80 udhaar sale. The result:
     *
     *     totalAmount 129.80   paidAmount 129.80   outstanding 0
     *
     * and the customer's balance stayed ₹0 across ₹1,129.80 of udhaar sales.
     *
     * paymentMode and paidAmount were entirely independent — choosing "Credit
     * (Udhaar)" changed nothing about the paid field, and the server then
     * applied the sale default of "empty means full". So the one thing a khata
     * app exists to record could be entered exactly as designed and vanish.
     *
     * This is the same shape as the V24 §1 note bug directly above: a default
     * that is right for one case applied to a case where it means the opposite.
     * Fixed here, on the server, so the rule holds no matter which client
     * writes the row — and the UI copy is fixed alongside it so the field stops
     * telling people the wrong thing.
     *
     * An EXPLICIT paidAmount still wins: a part-payment on an udhaar sale
     * (mode credit, paid 500 of 1000) is a real and common case, and it is
     * untouched by this branch.
     */
    if (paymentMode === 'credit') return 0

    return roundMoney(totalAmount)
  }

  let finalPaid = toMoney(paid)
  if (finalPaid < 0) finalPaid = 0  // zod already enforces min(0); belt-and-braces

  // 🔒 V26 N7: Narrowed snap-zone. Was: any value within ₹1 of total snapped
  // to total (Math.abs(totalAmount - finalPaid) < 1) — which silently upgraded
  // a genuine ₹999.50 partial on a ₹1,000 invoice to "fully paid" (vanishing
  // ₹0.50 of receivable), and a ₹4.50 refund on a ₹5 credit note to "full
  // refund" (writing off ₹0.50 of khata).
  //
  // The original FIX M3 intent was to absorb pre-round-off client values —
  // but those are always paid ≥ total by a rounding sliver (e.g. ₹1000.50 on
  // a ₹1000 invoice), never paid < total. So narrowing to "paid ≥ total −
  // 0.005 AND paid ≤ total + 1" preserves the round-off absorption while
  // stopping the silent partial-to-full upgrade.
  //
  // Notes (credit/debit) get an even stricter rule: no upward snap at all.
  // A note refund is entered deliberately; precision matters more than
  // convenience. A ₹4.50 refund on a ₹5 note stays ₹4.50.
  const isNote = isNoteType(type)
  const withinUpperSnapBand = finalPaid >= totalAmount - 0.005 && finalPaid <= totalAmount + 1
  if (!isNote && withinUpperSnapBand) {
    finalPaid = roundMoney(totalAmount)
  }

  // 🔒 AUDIT V24 §6.4: Clamp paid ≤ total. An overpaid invoice made
  // salesOutstanding NEGATIVE, silently turning the excess into an untracked
  // "advance" with no record it was one. Genuine advances belong in the
  // Payment flow (which warns on over-outstanding); an invoice can't collect
  // more than its own value. Same rule caps a note's refund at the note value.
  if (finalPaid > totalAmount) {
    finalPaid = roundMoney(totalAmount)
  }

  return roundMoney(finalPaid)
}
