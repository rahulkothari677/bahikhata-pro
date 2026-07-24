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
 * Reverses newest-first → oldest-first for display.
 * Positive delta = debit (increases what they owe), negative = credit.
 */
export function buildStatementRows(statement: StatementEntry[]): StatementRow[] {
  return statement.map((entry: StatementEntry, i: number) => {
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
 * Compute the opening balance from the oldest statement entry.
 * opening = oldest.runningBalance - oldest.delta
 * Falls back to stats.balance when the statement is empty.
 */
export function computeStatementOpening(
  statement: StatementEntry[],
  statsBalance: number,
): number {
  if (statement.length === 0) return statsBalance
  const oldest = statement[0]
  return roundMoney(oldest.runningBalance - oldest.delta)
}

/**
 * Compute ageing buckets from the statement.
 * Walks backward, allocating each positive-delta entry to age buckets
 * until the closing balance is fully accounted for.
 * Leftover (e.g. opening balance) goes to 'current'.
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
