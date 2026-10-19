/**
 * A chosen period and the one before it — one rule for every server route
 * that compares "this period" with "the period before" (Home's figures, their
 * proof sheets, Insights). Same arithmetic as /api/dashboard: the period
 * before ends 1 ms before this one starts and lasts as long.
 *
 * Bad input (unparseable dates, from after to) returns null so the route can
 * refuse with 400 instead of guessing a period.
 */
import { istMonthStart } from './timezone'

export interface PeriodWindow { from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number }

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const IST_OFFSET_MS = 330 * 60_000

/**
 * One end of a period. An instant (what the app sends) is taken as it is. A
 * plain date is a whole Indian day: `from` its first millisecond, `to` its
 * last. `new Date('2026-09-30')` is UTC midnight — 05:30 IST — so a plain `to`
 * silently dropped most of the last day (19 Oct: September read ₹1,225 short
 * on a hand check). An impossible date (31 Feb) is refused, never rolled over.
 */
function bound(s: string, end: boolean): Date {
  const m = DATE_ONLY.exec(s)
  if (!m) return new Date(s)
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (new Date(utc).getUTCDate() !== Number(m[3])) return new Date(NaN)
  const start = utc - IST_OFFSET_MS
  return new Date(end ? start + 86_400_000 - 1 : start)
}

export function rangeWindow(fromStr: string | null, toStr: string | null, now: Date = new Date()): PeriodWindow | null {
  const from = fromStr ? bound(fromStr, false) : istMonthStart(now)
  const to = toStr ? bound(toStr, true) : now
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null
  const dur = to.getTime() - from.getTime()
  return {
    from, to,
    prevFrom: new Date(from.getTime() - dur),
    prevTo: new Date(from.getTime() - 1),
    days: Math.max(1, Math.ceil(dur / 86_400_000)),
  }
}
