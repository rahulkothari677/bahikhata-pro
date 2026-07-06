/**
 * 🔒 V11 §4.6: Centralized IST timezone helpers.
 *
 * WHY: V10/V11 fixed timezone bugs in 4+ files, each with its own inline
 * `IST_OFFSET_MS = 5.5 * 60 * 60 * 1000` and `getISTDateParts()` function.
 * Duplicated code = inconsistent fixes and future bugs. This module is the
 * single source of truth for IST date math.
 *
 * RULES:
 * - IST = UTC + 5:30 (no DST — India doesn't observe daylight saving)
 * - All "day" and "month" boundaries in API routes MUST use these helpers
 * - Never use `setHours(0,0,0,0)` or `new Date(now.getFullYear(), now.getMonth(), 1)`
 *   in API route handlers — these use server-local time (UTC on Vercel)
 *
 * Usage:
 *   import { istDayStart, istMonthStart, istNow } from '@/lib/timezone'
 *   const startOfToday = istDayStart(new Date())
 *   const startOfMonth = istMonthStart(new Date())
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // IST = UTC + 5:30

/**
 * Get the IST date parts (year, month, day, etc.) from a UTC Date.
 * Returns the same values you'd get from a Date object in IST.
 */
export function getISTDateParts(date: Date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),  // 0-indexed (0 = January)
    day: ist.getUTCDate(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    seconds: ist.getUTCSeconds(),
    ms: ist.getUTCMilliseconds(),
  }
}

/**
 * Get the start of the current IST day (00:00:00 IST) as a UTC Date.
 *
 * Example: if now is 2026-07-06 03:00 IST (= 2026-07-05 21:30 UTC),
 * this returns 2026-07-05 18:30:00 UTC (= 2026-07-06 00:00 IST).
 *
 * Use this for "Today" KPIs in API routes — NOT `setHours(0,0,0,0)`
 * (which uses server-local time = UTC on Vercel = wrong for IST users).
 */
export function istDayStart(date: Date = new Date()): Date {
  const parts = getISTDateParts(date)
  return new Date(Date.UTC(parts.year, parts.month, parts.day) - IST_OFFSET_MS)
}

/**
 * Get the start of the current IST month (1st day, 00:00:00 IST) as a UTC Date.
 *
 * Example: if now is 2026-07-15 10:00 IST, this returns 2026-06-30 18:30 UTC
 * (= 2026-07-01 00:00 IST).
 *
 * Use this for "This Month" defaults in API routes — NOT
 * `new Date(now.getFullYear(), now.getMonth(), 1)` (which uses server-local time).
 */
export function istMonthStart(date: Date = new Date()): Date {
  const parts = getISTDateParts(date)
  return new Date(Date.UTC(parts.year, parts.month, 1) - IST_OFFSET_MS)
}

/**
 * Get the start of a specific IST month, offset by N months from the reference date.
 *
 * Example: istMonthStartOffset(new Date(), -1) = start of last month in IST.
 *          istMonthStartOffset(new Date(), -5) = start of 5 months ago in IST.
 *
 * Use this for "last 6 months" charts and reports.
 */
export function istMonthStartOffset(date: Date, monthOffset: number): Date {
  const parts = getISTDateParts(date)
  // JavaScript Date handles month underflow/overflow correctly:
  // new Date(Date.UTC(2026, 6 - 5, 1)) = new Date(Date.UTC(2026, 1, 1)) = Feb 1, 2026
  return new Date(Date.UTC(parts.year, parts.month + monthOffset, 1) - IST_OFFSET_MS)
}

/**
 * Get the current time as a Date (same as `new Date()`, but explicit).
 * Included for API consistency — if you're using istDayStart, use istNow
 * instead of `new Date()` for readability.
 */
export function istNow(): Date {
  return new Date()
}

/**
 * Check if two dates are in the same IST calendar month.
 *
 * Use this for GSTR-1 single-month validation and any "same month?" checks.
 */
export function isSameISTMonth(date1: Date, date2: Date): boolean {
  const p1 = getISTDateParts(date1)
  const p2 = getISTDateParts(date2)
  return p1.year === p2.year && p1.month === p2.month
}
