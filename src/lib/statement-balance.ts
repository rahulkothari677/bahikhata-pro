/**
 * 🔒 V17 §2.1: Statement running-balance computation — extracted to a pure
 * function so it can be tested behaviorally without mounting the React
 * component.
 *
 * Was (V15 M-2 + V17 §2.2/§2.3): the logic lived inline in PartyProfile.tsx's
 * useMemo. The V16 auditor pointed out that the reconciliation test grepped
 * source text instead of running the math — this extraction makes a real
 * behavioral test possible. The test calls this function with a fixture and
 * asserts the result agrees with computePartyBalance() and getReceivablePayable().
 *
 * Algorithm (V17 backward walk):
 *   1. Map transactions + payments to entries with `delta` (same signs as
 *      computePartyBalance: sale +, purchase -, received -, paid +).
 *   2. Sort NEWEST → OLDEST.
 *   3. First entry (newest) gets runningBalance = statsBalance (the true
 *      current balance from the server). This means the top row ALWAYS ties
 *      to the headline, even when the statement is truncated (>500 entries).
 *   4. Each older entry gets:
 *        runningBalance = roundMoney(prev.runningBalance - prev.delta)
 *      (Solving the forward equation newerBalance = olderBalance + newerDelta
 *      backward: olderBalance = newerBalance - newerDelta.)
 *   5. If NOT truncated, the oldest entry's balance minus its delta should
 *      equal the party's openingBalance. The behavioral test asserts this.
 *
 * Uses roundMoney (not inline Math.round) to match the server's rounding
 * exactly — eliminates per-row vs aggregate paisa drift (V17 §2.3).
 */

import { roundMoney } from '@/lib/money'

export interface StatementTransaction {
  id: string
  date: string | Date
  type: 'sale' | 'purchase' | 'income' | 'expense' | 'credit-note' | 'debit-note'
  totalAmount: number
  paidAmount: number
  invoiceNo?: string | null
  _count?: { items: number }
}

export interface StatementPayment {
  id: string
  date: string | Date
  type: 'received' | 'paid'
  amount: number
  mode?: string
  notes?: string | null
}

export interface StatementEntry {
  id: string
  date: string | Date
  type: string
  amount: number
  delta: number
  due: number
  invoiceNo: string | null
  itemCount: number
  isPayment: boolean
  paymentMode?: string
  notes?: string | null
  runningBalance: number
}

/**
 * Compute the unified account statement with a running balance.
 *
 * @param transactions  - Non-deleted transactions for the party (any order).
 * @param payments      - Non-soft-deleted payments for the party (any order).
 * @param statsBalance  - The party's current balance from computePartyBalance()
 *                        (already rounded via roundMoney on the server).
 * @returns Entries sorted newest-first, each with a `runningBalance` field.
 *          The first entry's runningBalance === statsBalance (always ties to
 *          the headline). Returns [] if both inputs are empty.
 */
export function computeStatementRunningBalance(
  transactions: StatementTransaction[],
  payments: StatementPayment[],
  statsBalance: number,
): StatementEntry[] {
  // Intermediate type: same as StatementEntry but without runningBalance
  // (which is added in the backward-walk loop below).
  type IntermediateEntry = Omit<StatementEntry, 'runningBalance'>

  const txEntries: IntermediateEntry[] = transactions.map((t) => ({
    id: t.id,
    date: t.date,
    type: t.type,
    amount: t.totalAmount,
    // sale → +(total - paid)   [adds to what they owe]
    // purchase → -(total - paid) [subtracts from what they owe]
    // credit-note → -(total - paid) [reduces what they owe — same as received payment]
    // debit-note → +(total - paid)  [reduces what we owe — same direction as sale]
    // V17-Ext Tier 3: debit-note has the SAME delta direction as sale
    delta: t.type === 'sale' || t.type === 'debit-note'
      ? (t.totalAmount - (t.paidAmount || 0))
      : -(t.totalAmount - (t.paidAmount || 0)),
    due: t.totalAmount - t.paidAmount,
    invoiceNo: t.invoiceNo ?? null,
    itemCount: t._count?.items ?? 0,
    isPayment: false,
  }))

  const payEntries: IntermediateEntry[] = payments.map((p) => ({
    id: p.id,
    date: p.date,
    type: p.type === 'received' ? 'payment-received' : 'payment-paid',
    amount: p.amount,
    // received → -amount [customer paid us → reduces what they owe]
    // paid → +amount     [we paid supplier → reduces what we owe them]
    delta: p.type === 'received' ? -p.amount : p.amount,
    due: 0,
    invoiceNo: null,
    itemCount: 0,
    isPayment: true,
    paymentMode: p.mode,
    notes: p.notes,
  }))

  // Sort NEWEST → OLDEST. Stable sort by date desc.
  const newestFirst = [...txEntries, ...payEntries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  if (newestFirst.length === 0) return []

  // Backward walk: anchor on statsBalance (the true current balance from the
  // server, already rounded via roundMoney in computePartyBalance).
  // First entry (newest) = statsBalance. Each older entry = prev.balance
  // - prev.delta (solving the forward equation backward).
  const CURRENT = roundMoney(statsBalance)

  const withBalance: StatementEntry[] = []
  withBalance.push({ ...newestFirst[0], runningBalance: CURRENT })
  for (let i = 1; i < newestFirst.length; i++) {
    const prev = withBalance[i - 1]
    // olderBalance = newerBalance - newerDelta
    const older = roundMoney(prev.runningBalance - prev.delta)
    withBalance.push({ ...newestFirst[i], runningBalance: older })
  }

  return withBalance
}
