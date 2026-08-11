/**
 * Turning "pichhle mahine" into the date picker's own preset.
 *
 * ── THE TRAP THIS FILE EXISTS TO AVOID ────────────────────────────────
 *
 * Ask speaks in AskPeriod: today, yesterday, this_week, this_month,
 * last_month, this_fy, all_time. The date picker speaks in DatePreset: today,
 * yesterday, last7, last30, thisMonth, lastMonth, thisQuarter, thisYear.
 *
 * They LOOK alike, and two of the pairs are not the same range at all:
 *
 *   this_week  is Monday-to-today.        last7   is the last seven days.
 *   this_fy    is 1 April to 31 March.    thisYear is 1 January to 31 December.
 *
 * Mapping those onto each other because the names rhyme would open a report
 * showing a DIFFERENT period than the one asked for, with the picker
 * confidently displaying the wrong label above it. That is the wrong-subject
 * bug in a new costume: a real figure, for a question nobody asked.
 *
 * So: an exact preset only where the ranges are genuinely identical.
 * Everywhere else the caller sends explicit dates and the picker shows
 * "Custom", which is true.
 */

import type { DatePreset } from '@/components/common/DateRangePicker'
import type { AskPeriod } from '@/lib/ask-patterns'

/**
 * The preset whose range is EXACTLY this period, or null when none is.
 *
 * Null is not a failure — it means "use the explicit dates", which the caller
 * already has.
 */
export function presetForAskPeriod(period: AskPeriod): DatePreset | null {
  switch (period) {
    case 'today': return 'today'
    case 'yesterday': return 'yesterday'
    case 'this_month': return 'thisMonth'
    case 'last_month': return 'lastMonth'

    /*
     * NOT last7. Monday-to-today is one to seven days; the last seven days is
     * always seven and reaches back into last week. On a Tuesday they differ
     * by five days of trading.
     */
    case 'this_week': return null

    /*
     * NOT thisYear. The Indian financial year runs April to March; the
     * picker's "This Year" is the calendar year. In, say, February they
     * overlap by two months out of twelve.
     */
    case 'this_fy': return null

    // No range to set — the report keeps whatever it defaults to.
    case 'all_time': return null

    default: return null
  }
}

/**
 * Does this period have a range worth carrying to a report at all?
 *
 * "all_time" deliberately does not: forcing a report to the beginning of time
 * is slower and is not what "open the P&L" means.
 */
export function periodHasRange(period: AskPeriod): boolean {
  return period !== 'all_time'
}
