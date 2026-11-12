/**
 * Every GST return date, from one place — 9b-1 (12 Nov 2026), master plan 9b
 * ("every due date from one place"), #106.
 *
 * Dates from the verified law report (Downloads\reports\GST law verified
 * September 2026.md, "Due dates have not changed since 2021"):
 *   GSTR-1 monthly        11th of the next month       Notification 83/2020-CT
 *   GSTR-1 quarterly      13th after the quarter       Notification 83/2020-CT
 *   IFF (months 1 and 2)  13th of the next month       Rule 59(2) — optional, B2B only
 *   GSTR-3B monthly       20th of the next month       Rule 61(1)(i)
 *   GSTR-3B quarterly     22nd (Group A) / 24th (Group B) after the quarter — Rule 61(1)(ii)
 *   PMT-06 (months 1, 2)  25th of the next month       Rule 61(3)
 *   GSTR-2B               14th of the next month; for a quarterly filer one 2B
 *                         per quarter, on the 14th after it (IMS FAQ Q28)
 *
 * A period is "MMYYYY" (the portal's form, as Gstr2bImport stores it). Dates are
 * calendar days in India; a Date here is that day at 00:00 local.
 *
 * One-off extensions (the report names two in 2025-26) are not modelled: a
 * notified extension is a setting change, not a rule.
 */

export type FilingFrequency = 'monthly' | 'quarterly'

/**
 * The shop's frequency. Not answered (null) reads as monthly — what the app has
 * always assumed — so a shop that never answers sees exactly what it saw before.
 */
export function filingFrequency(setting: { gstFilingFrequency?: string | null } | null | undefined): FilingFrequency {
  return setting?.gstFilingFrequency === 'quarterly' ? 'quarterly' : 'monthly'
}

/**
 * Group A for the quarterly GSTR-3B (22nd) — Rule 61(1)(ii) as substituted by
 * Notification 82/2020-CT; the rest are Group B (24th). By GST state code:
 * Chhattisgarh 22, Madhya Pradesh 23, Gujarat 24, Daman & Diu 25, Dadra & Nagar
 * Haveli 26, Maharashtra 27, Karnataka 29, Goa 30, Lakshadweep 31, Kerala 32,
 * Tamil Nadu 33, Puducherry 34, Andaman & Nicobar 35, Telangana 36, Andhra Pradesh 37.
 */
export const QUARTERLY_3B_GROUP_A = new Set(['22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37'])

const parse = (fp: string) => ({ month: Number(fp.slice(0, 2)), year: Number(fp.slice(2)) })
/** The given day of the month after (month, year) — month is 1-based. */
const dayAfter = (month: number, year: number, day: number) => new Date(year, month, day)

/** Is this month the last of its quarter (June, September, December, March)? */
export function isQuarterEnd(fp: string): boolean {
  return parse(fp).month % 3 === 0
}

/** The quarter's last month for any month in it, as MMYYYY. */
export function quarterEndOf(fp: string): string {
  const { month, year } = parse(fp)
  const end = Math.ceil(month / 3) * 3
  return String(end).padStart(2, '0') + String(year)
}

/** The three months of fp's quarter, oldest first, as MMYYYY. */
export function quarterMonths(fp: string): string[] {
  const { month, year } = parse(fp)
  const first = (Math.ceil(month / 3) - 1) * 3 + 1
  return [first, first + 1, first + 2].map((m) => String(m).padStart(2, '0') + String(year))
}

export interface DueDate {
  /** What is due: 'GSTR-1', 'IFF', 'GSTR-3B', 'PMT-06'. */
  form: string
  date: Date
  /** The rule that sets it, for ⓘ. */
  basis: string
}

/**
 * What is due for period fp. A quarterly filer's first two months carry the
 * optional IFF and the PMT-06 payment; the quarter's last month carries the
 * quarter's GSTR-1 and GSTR-3B.
 */
export function returnsDue(fp: string, freq: FilingFrequency, stateCode: string | null | undefined): DueDate[] {
  const { month, year } = parse(fp)
  if (freq === 'monthly') {
    return [
      { form: 'GSTR-1', date: dayAfter(month, year, 11), basis: 'Notification 83/2020-CT' },
      { form: 'GSTR-3B', date: dayAfter(month, year, 20), basis: 'Rule 61(1)(i)' },
    ]
  }
  if (!isQuarterEnd(fp)) {
    return [
      { form: 'IFF', date: dayAfter(month, year, 13), basis: 'Rule 59(2) — optional, B2B sales only' },
      { form: 'PMT-06', date: dayAfter(month, year, 25), basis: 'Rule 61(3)' },
    ]
  }
  const groupA = QUARTERLY_3B_GROUP_A.has(String(stateCode ?? '').padStart(2, '0'))
  return [
    { form: 'GSTR-1', date: dayAfter(month, year, 13), basis: 'Notification 83/2020-CT' },
    { form: 'GSTR-3B', date: dayAfter(month, year, groupA ? 22 : 24), basis: `Rule 61(1)(ii) — ${groupA ? 'Group A states, 22nd' : 'Group B states, 24th'}` },
  ]
}

/** The GSTR-3B due date for period fp, or null when fp carries none (a quarterly filer's months 1 and 2). */
export function gstr3bDue(fp: string, freq: FilingFrequency, stateCode: string | null | undefined): Date | null {
  return returnsDue(fp, freq, stateCode).find((d) => d.form === 'GSTR-3B')?.date ?? null
}

/**
 * When the GSTR-2B for period fp is made: the 14th of the next month; for a
 * quarterly filer only the quarter's last month has one (IMS FAQ Q28), so a
 * month 1 or 2 gives null.
 */
export function twoBGenerationDate(fp: string, freq: FilingFrequency): Date | null {
  if (freq === 'quarterly' && !isQuarterEnd(fp)) return null
  const { month, year } = parse(fp)
  return dayAfter(month, year, 14)
}

/** The period after fp — the next month, or for a quarterly filer the next quarter's end. */
export function nextPeriod(fp: string, freq: FilingFrequency): string {
  const { month, year } = parse(fp)
  const step = freq === 'quarterly' ? 3 : 1
  const base = freq === 'quarterly' ? Math.ceil(month / 3) * 3 : month
  const m = base + step
  return String(((m - 1) % 12) + 1).padStart(2, '0') + String(m > 12 ? year + 1 : year)
}

/**
 * How long a supplier's credit note can stay Pending in IMS: until the GSTR-3B
 * due date of (its 2B period + one period) — GSTN FAQ on IMS changes from
 * October 2025. Only for 2B periods from October 2025 on; earlier ones get null.
 */
export function pendingDeadline(twoBPeriod: string, freq: FilingFrequency, stateCode: string | null | undefined): Date | null {
  const { month, year } = parse(twoBPeriod)
  if (year * 12 + month < 2025 * 12 + 10) return null
  const own = freq === 'quarterly' ? quarterEndOf(twoBPeriod) : twoBPeriod
  return gstr3bDue(nextPeriod(own, freq), freq, stateCode)
}
