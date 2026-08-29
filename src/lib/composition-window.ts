/**
 * WHEN was this shop a composition dealer — and what does a quarter look like
 * if it stopped part-way through?
 *
 * THE BUG THIS CLOSES. CMP-08 charged composition tax on the whole quarter
 * regardless of when the shop left the scheme. Crossing ₹1.5 crore ends
 * composition **on the crossing date itself**, with no grace period: from that
 * moment the shop issues tax invoices and charges regular GST. Our CMP-08 then
 * applied 1% on top of that same turnover.
 *
 * The CA review put it plainly: *"a shop that already charged and remitted
 * regular GST on post-crossing sales, then has 1% composition tax applied on
 * top of that same turnover by your CMP-08 calculation, is paying tax twice."*
 * And it lands on exactly the shops that are growing.
 *
 * THE TWO DIRECTIONS ARE NOT SYMMETRIC, which is why this file exists rather
 * than a date filter written inline in two routes.
 *
 *   ENTRY is prospective only. CMP-02 takes effect from the start of a
 *   financial year and must be filed before that year begins. There is no
 *   mid-year opt-in, so there is no proration to invent — the whole-quarter
 *   calculation is already right for this direction. The app should refuse
 *   mid-year entry and say why, rather than quietly allowing a state the law
 *   does not have.
 *
 *   EXIT is immediate and mid-quarter. It genuinely happens, it cannot be
 *   designed away, and the quarter splits at the crossing date.
 *
 * ONE FUNCTION, TWO CALLERS. CMP-08 and GSTR-4 both need this window. Two
 * date filters written separately would drift, and a composition return that
 * disagrees with its own annual summary is the kind of error nobody spots
 * until a notice arrives. Same reasoning as the shared supply classifier.
 *
 * @see prisma/schema.prisma Setting.compositionFrom / compositionTo
 */

export interface CompositionRegistration {
  compositionCategory: string | null
  /** When the shop entered. NULL for a shop that has always been on it. */
  compositionFrom?: Date | string | null
  /** When it stopped. NULL = still in the scheme. */
  compositionTo?: Date | string | null
}

export interface CompositionWindow {
  /** Is the shop on the scheme at all? */
  registered: boolean
  /** Start of the period CMP-08 may charge for — never before this. */
  from: Date | null
  /** End of it. NULL = open-ended. */
  to: Date | null
}

/**
 * Midnight at the START of the day after this one, in local time.
 *
 * NOT `+ 86,400,000 ms`, which is what I wrote first and what the tests
 * caught. An exit date arrives as `new Date('2026-08-15')` — UTC midnight,
 * which in IST is 05:30 on the 15th. Adding a day of milliseconds lands on
 * 05:30 on the 16th, not on midnight, so the first five and a half hours of
 * the 16th would still be counted as composition turnover.
 *
 * Every period in the CMP-08 and GSTR-4 routes is built with
 * `new Date(year, month, day)` — local midnight. This boundary has to be
 * built the same way or the two disagree by a few hours at the seam, which
 * is precisely where the disputed invoice will be.
 */
function startOfNextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function compositionWindow(s: CompositionRegistration): CompositionWindow {
  return {
    registered: !!s.compositionCategory,
    from: asDate(s.compositionFrom),
    to: asDate(s.compositionTo),
  }
}

export interface PeriodSlice {
  /** The part of the period the shop was on composition. */
  compositionStart: Date
  compositionEnd: Date
  /** True when the shop left mid-period, so the rest is regular-scheme. */
  splitsMidPeriod: boolean
  /** The regular-scheme remainder, when it exists. */
  regularStart: Date | null
  regularEnd: Date | null
  /** Plain sentence for the screen when a split happened. */
  note: string | null
}

/**
 * Narrow a quarter (or any period) to the part the shop was actually a
 * composition dealer for.
 *
 * `periodEnd` is EXCLUSIVE, matching how the routes already build quarters.
 *
 * Returns null when the shop was not on composition for any of it — which is
 * a different answer from "zero turnover" and must not be reported as ₹0 tax.
 */
export function sliceForComposition(
  window: CompositionWindow,
  periodStart: Date,
  periodEnd: Date,
): PeriodSlice | null {
  if (!window.registered) return null

  // Entry can only be a financial-year boundary, so `from` never splits a
  // quarter in practice — but clamping to it costs nothing and protects
  // against a back-dated registration being charged for months before it.
  const start = window.from && window.from > periodStart ? window.from : periodStart

  /*
   * The exit date is INCLUSIVE of that day's turnover: the shop is a
   * composition dealer up to and including the crossing date, and regular
   * from the day after. Treating it as exclusive would push one day's sales
   * into the regular scheme that CMP-08 should still cover — a small error,
   * but on the one day most likely to carry the large invoice that caused the
   * crossing in the first place.
   */
  const exitExclusive = window.to ? startOfNextDay(window.to) : null
  const end = exitExclusive && exitExclusive < periodEnd ? exitExclusive : periodEnd

  if (end <= start) return null   // left before this period began

  const splits = !!(exitExclusive && exitExclusive < periodEnd && exitExclusive > periodStart)

  return {
    compositionStart: start,
    compositionEnd: end,
    splitsMidPeriod: splits,
    regularStart: splits ? end : null,
    regularEnd: splits ? periodEnd : null,
    note: splits
      ? `You left the composition scheme on ${window.to!.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. This CMP-08 covers only the turnover up to that date — everything after it belongs in GSTR-1 and GSTR-3B, because you were charging regular GST by then.`
      : null,
  }
}

/** Financial year containing this date, as a start Date (1 April). */
export function financialYearStart(d: Date): Date {
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return new Date(y, 3, 1)
}

/**
 * May a shop opt IN to composition with effect from this date?
 *
 * Only from the start of a financial year — CMP-02 is prospective and must be
 * filed before the year begins (Rule 3). A brand-new registration opting in at
 * registration is the one exception, and it is not this code path: that shop
 * has no prior regular-scheme turnover in the year to double-tax.
 *
 * Refusing beats guessing, and refusing with the REASON beats refusing: a
 * shopkeeper told only "not allowed" assumes the app is limited, not the law.
 */
export function canEnterCompositionFrom(date: Date): { allowed: boolean; reason: string } {
  const fyStart = financialYearStart(date)
  const isFyStart =
    date.getFullYear() === fyStart.getFullYear() &&
    date.getMonth() === 3 &&
    date.getDate() === 1

  return isFyStart
    ? { allowed: true, reason: '' }
    : {
      allowed: false,
      reason:
        'Composition can only start at the beginning of a financial year (1 April), and the CMP-02 form has to be filed before that year begins. This is the law, not a limit in the app — mid-year opt-in is not possible.',
    }
}
