/**
 * Bills grouped by day (Phase 5d-2, ledger model v4): the day a bill belongs
 * to is its IST calendar day — the same key the totals route groups by
 * (DATE_TRUNC on istLocal, read as a naive IST midnight; lib/trend-buckets.ts).
 * A bill at 23:30 IST on the 1st is the 1st's, never the 2nd's.
 */
import { sqlBucketKey } from './trend-buckets'

/** The IST day key of a bill's date ("2026-10-02T00:00:00.000Z" form). */
export function billDayKey(date: string | Date): string {
  return sqlBucketKey(new Date(date), 'day')
}

/** "Today", "Yesterday", or "Thu 1 Oct" (with the year when it is not this year's). */
export function billDayLabel(key: string, now: Date, words: { today: string; yesterday: string }): string {
  const today = billDayKey(now)
  const yesterday = new Date(new Date(today).getTime() - 86_400_000).toISOString()
  if (key === today) return words.today
  if (key === yesterday) return words.yesterday
  const d = new Date(key)
  const sameYear = d.getUTCFullYear() === new Date(today).getUTCFullYear()
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
}

/** Rows split into day groups, in the order given (the list is newest first). */
export function groupByDay<T extends { date: string | Date }>(rows: T[]): { key: string; rows: T[] }[] {
  const out: { key: string; rows: T[] }[] = []
  for (const r of rows) {
    const key = billDayKey(r.date)
    const last = out[out.length - 1]
    if (last && last.key === key) last.rows.push(r)
    else out.push({ key, rows: [r] })
  }
  return out
}
