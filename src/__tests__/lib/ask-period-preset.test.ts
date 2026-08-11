/**
 * 🔒 A period must not be quietly swapped for a similar-sounding one.
 *
 * Ask speaks in AskPeriod; the date picker speaks in DatePreset. Two of the
 * pairs LOOK equivalent and are not:
 *
 *   this_week  Monday-to-today       vs  last7    the last seven days
 *   this_fy    1 April – 31 March    vs  thisYear 1 January – 31 December
 *
 * Mapping those onto each other because the names rhyme would open a report
 * showing a DIFFERENT period than the one asked for — with the picker
 * confidently displaying the wrong label above it. A real figure, for a
 * question nobody asked, which is the wrong-subject bug in a new costume.
 *
 * So the rule is: an exact preset ONLY where the ranges are genuinely
 * identical. Everywhere else, null — and the caller sends explicit dates,
 * which the picker shows as "Custom" because that is what it is.
 */

import { describe, test, expect } from '@jest/globals'
import { presetForAskPeriod, periodHasRange } from '@/lib/ask-period-preset'
import { getPresetRange } from '@/components/common/DateRangePicker'
import type { AskPeriod } from '@/lib/ask-patterns'

describe('presets that are genuinely the same range', () => {
  test.each([
    ['today', 'today'],
    ['yesterday', 'yesterday'],
    ['this_month', 'thisMonth'],
    ['last_month', 'lastMonth'],
  ] as const)('%s → %s', (period, preset) => {
    expect(presetForAskPeriod(period)).toBe(preset)
  })
})

describe('the two that must NOT be mapped', () => {
  test('this_week is not last7 — they differ by up to six days of trading', () => {
    /*
     * On a Tuesday, "this week" is two days and "last 7 days" is seven. A
     * shopkeeper asking for this week's sales and shown a seven-day figure
     * gets a bigger number than the truth, labelled as theirs.
     */
    expect(presetForAskPeriod('this_week')).toBeNull()
  })

  test('this_fy is not thisYear — April-to-March is not January-to-December', () => {
    // In February the two overlap by two months out of twelve.
    expect(presetForAskPeriod('this_fy')).toBeNull()
  })

  test('and the ranges really do differ, so this is not a theoretical worry', () => {
    const week = getPresetRange('last7')
    const year = getPresetRange('thisYear')
    // thisYear starts in January; the Indian FY starts in April. Unless it IS
    // January-to-March, the start months differ.
    expect(year.from.getMonth()).toBe(0)
    // last7 always spans seven days; "this week" cannot when today is Monday.
    const days = Math.round((week.to.getTime() - week.from.getTime()) / 86_400_000)
    expect(days).toBeGreaterThanOrEqual(6)
  })
})

describe('all_time carries no range', () => {
  test('no preset', () => {
    expect(presetForAskPeriod('all_time')).toBeNull()
  })

  test('and the caller is told not to send dates at all', () => {
    /*
     * Forcing a report back to the beginning of time is slow and is not what
     * "open the P&L" means — the report should keep its own default.
     */
    expect(periodHasRange('all_time')).toBe(false)
    for (const p of ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_fy'] as AskPeriod[]) {
      expect({ p, hasRange: periodHasRange(p) }).toEqual({ p, hasRange: true })
    }
  })
})

describe('every AskPeriod is handled', () => {
  test('no period falls through to undefined', () => {
    // A missing case would return undefined, which the caller would treat as
    // "no preset" by accident rather than by decision.
    const all: AskPeriod[] = ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_fy', 'all_time']
    for (const p of all) {
      const result = presetForAskPeriod(p)
      expect({ p, isNullOrString: result === null || typeof result === 'string' })
        .toEqual({ p, isNullOrString: true })
    }
  })
})
