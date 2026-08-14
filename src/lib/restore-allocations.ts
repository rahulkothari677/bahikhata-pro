/**
 * Deciding which bill a restored payment settled — and when to refuse.
 *
 * WHY (audit 2026-08-14). `due = totalAmount − paidAmount − Σ(allocations)`.
 * The restore recreated payments but not their allocations, so a restored shop
 * had correct party balances and every individual invoice still reading as
 * owing. That is the disagreement invoice-due.ts exists to prevent, and a stale
 * "Due" is what invites a shopkeeper to chase a customer who already paid.
 *
 * The decision lives here rather than inline in the route so it can be tested
 * by being CALLED. A regex over a 600-line route passes just as happily when
 * the branch above the code is `if (false)` — a mistake already made twice in
 * this audit.
 */
import { roundMoney } from './money'

export interface RestoredBill {
  totalAmount: number
  /** Paid at billing time. Allocations settle what is left AFTER this. */
  paidAmount: number
}

export type AllocationDecision =
  | { ok: true; transactionId: string; amount: number }
  | { ok: false; reason: 'no-bill-named' | 'ambiguous-bill' | 'bill-not-restored' | 'not-positive' | 'over-settles'; room?: number }

export interface AllocationContext {
  /** billKey -> the id the restore just gave that transaction. */
  txnIdByBillKey: Map<string, string>
  /** Keys held by more than one bill. Never guessed between. */
  ambiguousBillKeys: Set<string>
  /** transactionId -> its own totals, for the over-settlement check. */
  billTotals: Map<string, RestoredBill>
  /** transactionId -> how much this restore has already re-attached to it. */
  allocatedSoFar: Map<string, number>
}

/**
 * Should this allocation from the backup file be written?
 *
 * Refuses rather than guesses, on the same principle as an ambiguous party
 * name: a payment attached to the WRONG invoice is worse than one attached to
 * none. A visible gap can be corrected by the shopkeeper; a confident wrong
 * number cannot even be noticed.
 */
export function decideAllocation(
  fileAllocation: { billKey?: string | null; amount?: number | null } | null | undefined,
  ctx: AllocationContext,
): AllocationDecision {
  const key = fileAllocation?.billKey ?? null
  const amount = roundMoney(fileAllocation?.amount || 0)

  if (!key) return { ok: false, reason: 'no-bill-named' }
  if (ctx.ambiguousBillKeys.has(key)) return { ok: false, reason: 'ambiguous-bill' }

  const transactionId = ctx.txnIdByBillKey.get(key)
  if (!transactionId) return { ok: false, reason: 'bill-not-restored' }
  if (amount <= 0) return { ok: false, reason: 'not-positive' }

  /*
   * Never settle a bill past its own total. The write path enforces
   * `paidAmount + Σ(allocations) ≤ totalAmount`, so this can only trip on a
   * hand-edited or corrupted file — and a bill with a NEGATIVE due would poison
   * every total built on top of it.
   */
  const bill = ctx.billTotals.get(transactionId)
  const already = ctx.allocatedSoFar.get(transactionId) || 0
  const room = roundMoney((bill?.totalAmount || 0) - (bill?.paidAmount || 0) - already)
  if (amount > room) return { ok: false, reason: 'over-settles', room: Math.max(0, room) }

  return { ok: true, transactionId, amount }
}

/**
 * The sentence the shopkeeper reads about one refused allocation.
 *
 * Named, not just counted: money that does not survive a restore has to be
 * loud, and "3 skipped" tells nobody which customer to check.
 */
export function describeRefusedAllocation(
  decision: Extract<AllocationDecision, { ok: false }>,
  ctx: { billKey?: string | null; amount?: number | null; paymentAmount?: number | null; paymentType?: string | null },
): string {
  const bill = ctx.billKey ? ctx.billKey.split('|')[0] || '(no invoice no.)' : '(unknown bill)'
  const amount = roundMoney(ctx.amount || 0)

  switch (decision.reason) {
    case 'no-bill-named':
      return `₹${ctx.paymentAmount ?? amount} ${ctx.paymentType ?? 'payment'}: the backup does not say which bill this settled`
    case 'ambiguous-bill':
      return `₹${amount} against bill ${bill}: more than one bill matches, so it cannot be attributed safely`
    case 'bill-not-restored':
      return `₹${amount} against bill ${bill}: that bill is not in this restore`
    case 'not-positive':
      return `₹${amount} against bill ${bill}: the backup records a zero or negative amount for this link`
    case 'over-settles':
      return `₹${amount} against bill ${bill}: only ₹${decision.room ?? 0} of that bill is unsettled, so the file disagrees with itself`
  }
}
