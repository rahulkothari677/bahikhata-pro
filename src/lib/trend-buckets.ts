/**
 * The bars of Home's trend chart (Phase 5b-5).
 *
 * The SQL groups sales by DATE_TRUNC(unit, istLocal("date")) — an IST day,
 * an ISO week (Monday) or a month — and returns each bucket as a naive IST
 * midnight that JS reads as UTC ("2026-10-02T00:00:00.000Z"). The chart's
 * buckets must use exactly those keys, or a bucket's sales are dropped.
 *
 * Two gaps this replaces (found 14 Oct): day buckets stopped at 14, so after
 * the 14th of a month the chart silently left out the month's first days
 * while the card counted them; week buckets were 7-day windows ending today,
 * which match a Monday-start week only on Sundays, so the weekly chart was
 * mostly zeros. Now every bucket in the range is drawn, aligned like the SQL.
 */
import { getISTDateParts } from './timezone'

export type TrendUnit = 'day' | 'week' | 'month'
export interface TrendBucket { key: string; label: string }

const DAY_MS = 86_400_000

/** The IST calendar date of an instant, as a UTC-midnight Date (the SQL's key form). */
export function istDateKey(d: Date): Date {
  const p = getISTDateParts(d)
  return new Date(Date.UTC(p.year, p.month, p.day))
}

/** What DATE_TRUNC(unit, istLocal(date)) returns, as the JS Date the route keys on. */
export function sqlBucketKey(d: Date, unit: TrendUnit): string {
  const day = istDateKey(d)
  if (unit === 'day') return day.toISOString()
  if (unit === 'month') return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)).toISOString()
  const back = (day.getUTCDay() + 6) % 7 // days since Monday (ISO week, as Postgres)
  return new Date(day.getTime() - back * DAY_MS).toISOString()
}

/** Every bucket from the range's first IST day to its last, in SQL key form. */
export function trendBuckets(from: Date, to: Date, unit: TrendUnit): TrendBucket[] {
  const first = new Date(sqlBucketKey(from, unit))
  const last = new Date(sqlBucketKey(to, unit))
  const out: TrendBucket[] = []
  for (let d = first; d <= last && out.length < 400;) {
    const label = unit === 'month'
      ? d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    out.push({ key: d.toISOString(), label })
    d = unit === 'month'
      ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
      : new Date(d.getTime() + (unit === 'week' ? 7 : 1) * DAY_MS)
  }
  return out
}
