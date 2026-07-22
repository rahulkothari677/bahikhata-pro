/**
 * 🔒 IST DATE-FORMATTING GUARD
 *
 * WHY THIS EXISTS
 * ---------------
 * The shop runs in IST (UTC+5:30). `date.toISOString().slice(0, 10)` returns
 * the **UTC** calendar date, so any instant before 05:30 IST formats as the
 * PREVIOUS day. This defect has now appeared three separate times:
 *
 *   1. GSTR month labels showed the previous month.
 *   2. The Income/Expense summary reported its range starting a day early
 *      (a range from 15 Jan was labelled "2026-01-14").
 *   3. The Day-End Summary stamped itself with YESTERDAY's date, every day —
 *      `istDayStart(now)` is the UTC instant of IST midnight (18:30 the prior
 *      day in UTC), and the code even carried a comment claiming "(IST)".
 *
 * In a ledger these are not cosmetic: the date on a financial summary is what
 * the shopkeeper quotes to their accountant.
 *
 * `istDateString()` / `istYearMonth()` exist for this. These tests pin the
 * behaviour and keep the known offenders honest.
 */

import { istDateString, istYearMonth, istDayStart, istMonthStart } from '@/lib/timezone'
import fs from 'fs'
import path from 'path'

describe('IST date formatting', () => {
  describe('istDateString returns the IST calendar date, not the UTC one', () => {
    test('IST midnight formats as that IST day (the Day-End Summary bug)', () => {
      // 15 Jan 2026 00:00 IST === 14 Jan 2026 18:30 UTC.
      const istMidnightUtcInstant = new Date('2026-01-14T18:30:00.000Z')
      expect(istDateString(istMidnightUtcInstant)).toBe('2026-01-15')
      // What the buggy code produced:
      expect(istMidnightUtcInstant.toISOString().slice(0, 10)).toBe('2026-01-14')
    })

    test('early-morning IST times keep the correct day', () => {
      // 2 AM IST on 1 Jul 2026 === 30 Jun 2026 20:30 UTC.
      const earlyMorningIst = new Date('2026-06-30T20:30:00.000Z')
      expect(istDateString(earlyMorningIst)).toBe('2026-07-01')
    })

    test('istDayStart round-trips through istDateString', () => {
      // Whatever instant istDayStart returns, formatting it must give back the
      // same IST calendar day — this is exactly what day-summary relies on.
      for (const iso of ['2026-01-15T03:00:00+05:30', '2026-07-21T23:45:00+05:30']) {
        const d = new Date(iso)
        expect(istDateString(istDayStart(d))).toBe(istDateString(d))
      }
    })

    test('istYearMonth returns the IST month (the GSTR label bug)', () => {
      // 1 Jul 2026 00:30 IST === 30 Jun 2026 19:00 UTC.
      const firstOfMonthIst = new Date('2026-06-30T19:00:00.000Z')
      expect(istYearMonth(firstOfMonthIst)).toBe('2026-07')
      expect(firstOfMonthIst.toISOString().slice(0, 7)).toBe('2026-06') // the bug
      expect(istYearMonth(istMonthStart(firstOfMonthIst))).toBe('2026-07')
    })
  })

  describe('known offenders stay fixed', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

    test('day-summary stamps its date in IST', () => {
      const src = read('src/app/api/day-summary/route.ts')
      expect(src).toMatch(/date:\s*istDateString\(startOfToday\)/)
      expect(src).not.toMatch(/date:\s*startOfToday\.toISOString\(\)/)
    })

    test('income/expense summary reports its range in IST', () => {
      const src = read('src/lib/income-expense-summary.ts')
      expect(src).toMatch(/from:\s*istDateString\(from\)/)
      expect(src).toMatch(/to:\s*istDateString\(to\)/)
    })
  })
})
