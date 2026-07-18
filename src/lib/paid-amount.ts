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
 */
export function resolveFinalPaid(type: string, paidRaw: unknown, totalAmount: number): number {
  const paid = typeof paidRaw === 'number' ? paidRaw : parseFloat(String(paidRaw))

  if (isNaN(paid)) {
    // Missing/empty paid amount — type-dependent default (the V24 §1 fix).
    return isNoteType(type) ? 0 : roundMoney(totalAmount)
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
