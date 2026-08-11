/**
 * "May to July", "14 June to 27 July" — a period nobody named in advance.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Ask understood exactly seven periods: today, yesterday, this week, this
 * month, last month, this financial year, all time. Rahul asked the obvious
 * question — what about "May to July", or "14 June to 27 July"? — and the
 * honest answer was that the app could not express such a range at all.
 *
 * A shopkeeper reconciling a quarter, or checking the run-up to Diwali, does
 * not think in our seven buckets.
 *
 * ── THE RULES IT FOLLOWS ──────────────────────────────────────────────
 *
 * IT REFUSES RATHER THAN GUESSES. An impossible date (31 February), a
 * backwards range, a month it does not recognise — all return null, and the
 * caller says it cannot answer. Silently repairing "31 February" to the 28th
 * would answer a question nobody asked, in a report labelled as theirs.
 *
 * THE YEAR IS THE MOST RECENT ONE THAT HAS ALREADY HAPPENED. "May to July"
 * asked in August means this year; asked in March it means LAST year, because
 * May to July of this year has not occurred yet and a report of the future is
 * empty. This is the one inference made without being told, and it is made in
 * the direction that produces data rather than a blank page.
 *
 * DATES ARE IST DAY BOUNDARIES, like everything else in the books, and the
 * range is half-open [from, to) — 14 June to 27 July INCLUDES all of 27 July.
 * Getting that wrong loses a day off the end of every range a shopkeeper asks
 * for, which is exactly the kind of quiet error nobody reports.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Month names, English and the spellings people actually type. */
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, janvary: 0,
  feb: 1, february: 1, febuary: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4, mai: 4,
  jun: 5, june: 5,
  jul: 6, july: 6, julay: 6,
  aug: 7, august: 7, agast: 7,
  sep: 8, sept: 8, september: 8, sitambar: 8,
  oct: 9, october: 9, aktubar: 9,
  nov: 10, november: 10, navambar: 10,
  dec: 11, december: 11, disambar: 11,
}

const MONTH_WORDS = Object.keys(MONTHS).join('|')

/** Words that separate the two ends of a range, in both languages. */
const RANGE_SEP = '(?:to|till|until|se|tak|se lekar|-|–|—)'

export interface AskDateRange {
  /** Inclusive start, at IST midnight. */
  from: Date
  /** EXCLUSIVE end — the day after the last day asked for. */
  to: Date
  /** For the "Showing:" line — "1 May to 31 Jul 2026". */
  label: string
}

/** IST midnight for a calendar day, expressed as a real (UTC) instant. */
function istDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS)
}

/** Does this calendar day exist? Catches 31 February and 31 April. */
function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day
}

const fmt = (d: Date) =>
  new Date(d.getTime() + IST_OFFSET_MS).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })

/**
 * Pick the year for a month range that named none.
 *
 * The most recent occurrence that has already STARTED. Asked in August, "May
 * to July" is this year. Asked in March, it is last year — because this year's
 * May has not happened and the report would be empty.
 */
function yearForMonths(startMonth: number, now: Date): number {
  const y = now.getUTCFullYear()
  return startMonth <= now.getUTCMonth() ? y : y - 1
}

/**
 * Parse an explicit date range out of a question, or null if there is none.
 *
 * `now` is injectable so the year inference can be tested without waiting for
 * the calendar.
 */
/**
 * Does this sentence LOOK like it names a range, whether or not it parses?
 *
 * The distinction matters more than it sounds. "31 february to 5 march" is
 * refused by the parser — correctly, the date does not exist — and the caller
 * then fell through to its default period and answered about TODAY. So a
 * refusal became a different answer, under the shopkeeper's own words.
 *
 * With this, the caller can tell "no range here, carry on" apart from "a range
 * was attempted and it was not valid", and refuse the whole question.
 */
export function hasDateRangeShape(question: string): boolean {
  const q = question.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim()
  return new RegExp(
    `\\b(?:\\d{1,2}\\s*(?:st|nd|rd|th)?\\s*)?(${MONTH_WORDS})\\b\\s*${RANGE_SEP}\\s*(?:\\d{1,2}\\s*(?:st|nd|rd|th)?\\s*)?(${MONTH_WORDS})\\b`,
  ).test(q)
}

export function parseDateRange(question: string, now: Date = new Date()): AskDateRange | null {
  const q = question.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim()
  const nowIst = new Date(now.getTime() + IST_OFFSET_MS)

  /*
   * DAY + MONTH on both sides: "14 june to 27 july", "1 apr se 30 jun".
   * Checked first — it is the more specific shape, and the month-only pattern
   * below would otherwise match the same sentence and lose the days.
   */
  const dayMonth = new RegExp(
    `\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(${MONTH_WORDS})\\b\\s*${RANGE_SEP}\\s*(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(${MONTH_WORDS})\\b`,
  ).exec(q)

  if (dayMonth) {
    const [, d1, m1, d2, m2] = dayMonth
    const startMonth = MONTHS[m1], endMonth = MONTHS[m2]
    const startDay = Number(d1), endDay = Number(d2)
    const year = yearForMonths(startMonth, nowIst)
    // A range that crosses new year: "20 dec to 5 jan" ends the following year.
    const endYear = endMonth < startMonth ? year + 1 : year

    if (!isRealDate(year, startMonth, startDay) || !isRealDate(endYear, endMonth, endDay)) {
      return null   // 31 February. Refuse; do not round to the 28th.
    }

    const from = istDay(year, startMonth, startDay)
    // +1 day: the range must INCLUDE the last day named.
    const to = istDay(endYear, endMonth, endDay + 1)
    if (to <= from) return null

    return { from, to, label: `${fmt(from)} to ${fmt(istDay(endYear, endMonth, endDay))}` }
  }

  /*
   * MONTH TO MONTH: "may to july", "april se june tak". Whole months, so the
   * range runs from the 1st of the first to the 1st of the month AFTER the
   * last — "may to july" includes all of July.
   */
  const monthOnly = new RegExp(
    `\\b(${MONTH_WORDS})\\b\\s*${RANGE_SEP}\\s*(${MONTH_WORDS})\\b`,
  ).exec(q)

  if (monthOnly) {
    const startMonth = MONTHS[monthOnly[1]], endMonth = MONTHS[monthOnly[2]]
    const year = yearForMonths(startMonth, nowIst)
    const endYear = endMonth < startMonth ? year + 1 : year

    const from = istDay(year, startMonth, 1)
    const to = istDay(endYear, endMonth + 1, 1)
    if (to <= from) return null

    const lastDay = new Date(to.getTime() - 86_400_000)
    return { from, to, label: `${fmt(from)} to ${fmt(lastDay)}` }
  }

  return null
}
