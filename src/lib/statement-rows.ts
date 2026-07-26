/**
 * 🔒 Phase 7 — Extracted pure functions from PartyProfile.tsx for testing.
 *
 * buildStatementRows, statementClosing, statementOpeningBalance, and
 * ageing buckets computation were closures inside the component with
 * zero tests. They directly compute the statement rows, closing balance
 * label, and ageing breakdown that appear on the PDF the customer receives.
 */

export interface StatementEntry {
  date: string | Date
  isPayment?: boolean
  type?: string
  invoiceNo?: string | null
  delta: number
  runningBalance: number
}

export interface StatementRow {
  index: number
  date: string
  particulars: string
  debit: number
  credit: number
  balance: number
}

export interface StatementClosing {
  closing: number
  label: string
  trueCount: number
  truncated: boolean
}

export interface AgeingBuckets {
  current: number
  overdue: number
  serious: number
  critical: number
}

/**
 * Build display rows from the statement array (khata convention).
 *
 * 🔒 INPUT IS NEWEST-FIRST. `statement` comes from
 * computeStatementRunningBalance(), which returns newest-first because the
 * on-screen feed shows the latest activity at the top. A printed khata is read
 * the other way: a shopkeeper (or a CA) starts at the top and follows the
 * running balance DOWN to the closing figure.
 *
 * 🔒 2026-07-26: this function previously claimed in its docstring to reverse
 * and did not — it was extracted from PartyProfile without the `.reverse()`
 * that the original had. Nothing imported it (only its own test, which fed an
 * oldest-first fixture), so the bug was invisible: the tests passed while the
 * shipped code kept using the correct inline copy. Wiring this file in without
 * this fix would have printed every customer statement backwards, with the
 * balance column appearing to run the wrong way and the last row failing to
 * tie to CLOSING BALANCE.
 *
 * Positive delta = debit (increases what they owe), negative = credit.
 */
export function buildStatementRows(statement: StatementEntry[]): StatementRow[] {
  return [...statement].reverse().map((entry: StatementEntry, i: number) => {
    const isPayment = entry.isPayment
    const particulars = isPayment
      ? (entry.type === 'payment-received' ? 'Payment received' : 'Payment made')
      : (entry.invoiceNo || entry.type || '—')
    const delta = entry.delta
    return {
      index: i + 1,
      date: formatDate(entry.date),
      particulars,
      debit: delta > 0 ? Math.abs(delta) : 0,
      credit: delta < 0 ? Math.abs(delta) : 0,
      balance: entry.runningBalance,
    }
  })
}

/**
 * Compute the closing balance + label for the statement.
 * Uses stats.balance (canonical) — never re-derived.
 */
export function buildStatementClosing(
  balance: number,
  partyType: string | undefined,
  trueCount: number,
  statementLength: number,
): StatementClosing {
  const label = balance > 0
    ? (partyType === 'supplier' ? 'Advance paid (they owe you)' : 'They owe you')
    : balance < 0 ? 'You owe them' : 'Settled'
  return {
    closing: balance,
    label,
    trueCount,
    truncated: trueCount > statementLength,
  }
}

/**
 * Compute the opening balance — what the party carried in BEFORE the first
 * line of the statement. Derived, never a second source of truth:
 *   opening = oldest.runningBalance - oldest.delta
 *
 * 🔒 INPUT IS NEWEST-FIRST, so the oldest entry is the LAST element.
 * This read `statement[0]` — the NEWEST entry — until 2026-07-26. On the
 * fixture in the test that is the difference between an opening of ₹0 and a
 * fabricated ₹1,500 printed at the top of a customer's statement. It was never
 * shipped (nothing imported this file), but wiring it in would have.
 *
 * Falls back to stats.balance when the statement is empty.
 */
export function computeStatementOpening(
  statement: StatementEntry[],
  statsBalance: number,
): number {
  if (statement.length === 0) return statsBalance
  const oldest = statement[statement.length - 1]
  return roundMoney((oldest.runningBalance ?? 0) - (oldest.delta ?? 0))
}

/**
 * Compute ageing buckets from the statement.
 *
 * 🔒 INPUT IS NEWEST-FIRST. Walking backward therefore allocates OLDEST-FIRST,
 * which is the FIFO rule ageing requires: the money a customer still owes is
 * assumed to be against their oldest unpaid bills. Feeding an oldest-first
 * array here silently inverts that to LIFO and reports old debt as current.
 *
 * Allocates each positive-delta entry to an age bucket until the closing
 * balance is accounted for. Leftover (e.g. an opening balance) goes to
 * 'current'.
 */
export function computeAgeingBuckets(
  statement: StatementEntry[],
  closingBalance: number,
  now: number = Date.now(),
): AgeingBuckets {
  const buckets: AgeingBuckets = { current: 0, overdue: 0, serious: 0, critical: 0 }
  let remaining = Math.abs(closingBalance)

  for (let i = statement.length - 1; i >= 0 && remaining > 0.005; i--) {
    const entry = statement[i]
    if (entry.isPayment) continue
    if (!entry.delta || entry.delta <= 0) continue

    const entryDate = new Date(entry.date)
    if (isNaN(entryDate.getTime())) continue

    const days = Math.max(0, Math.floor((now - entryDate.getTime()) / (1000 * 60 * 60 * 24)))
    const contribution = Math.min(Math.abs(entry.delta), remaining)

    if (days <= 30) buckets.current += contribution
    else if (days <= 60) buckets.overdue += contribution
    else if (days <= 90) buckets.serious += contribution
    else buckets.critical += contribution

    remaining -= contribution
  }

  if (remaining > 0.005) buckets.current += remaining
  return buckets
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return String(date)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}
