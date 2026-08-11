/**
 * 🔒 "May to July", "14 June to 27 July" — ranges nobody named in advance.
 *
 * Rahul asked the obvious question after P5.2 shipped named periods: what
 * about an arbitrary range? The honest answer was that the app could not
 * express one at all — a shopkeeper reconciling a quarter does not think in
 * our seven buckets.
 *
 * Date arithmetic is where quiet errors live, so the rules are pinned here:
 * refuse rather than repair, include the last day, and infer the year in the
 * one direction that produces data rather than a blank report.
 */

import { describe, test, expect } from '@jest/globals'
import { parseDateRange, hasDateRangeShape } from '@/lib/ask-date-range'

const IST = 5.5 * 60 * 60 * 1000
/** Read a returned instant back as its IST calendar day. */
const ist = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10)

/** A fixed "now" so year inference is testable without waiting for the calendar. */
const AUG_2026 = new Date('2026-08-11T06:00:00Z')   // 11 Aug 2026, IST afternoon
const MAR_2026 = new Date('2026-03-11T06:00:00Z')   // 11 Mar 2026

describe('day and month on both sides', () => {
  test('"14 june to 27 july" spans exactly those days', () => {
    const r = parseDateRange('14 june to 27 july', AUG_2026)!
    expect(ist(r.from)).toBe('2026-06-14')
    /*
     * THE OFF-BY-ONE THAT WOULD NEVER BE REPORTED. `to` is exclusive, so it
     * must be the 28th for the 27th to be included. Ending on the 27th would
     * silently drop a day off every range a shopkeeper asks for.
     */
    expect(ist(r.to)).toBe('2026-07-28')
  })

  test('ordinals and Hinglish separators', () => {
    for (const q of ['14th june to 27th july', '14 june se 27 july', '14 june se 27 july tak', '14 june - 27 july']) {
      const r = parseDateRange(q, AUG_2026)
      expect({ q, from: r && ist(r.from), to: r && ist(r.to) })
        .toEqual({ q, from: '2026-06-14', to: '2026-07-28' })
    }
  })

  test('a range that crosses new year keeps the two ends in consecutive years', () => {
    /*
     * I FIRST ASSERTED Dec 2026 → Jan 2027 HERE, AND IT WAS THE TEST THAT WAS
     * WRONG, not the code.
     *
     * Asked in August 2026, December 2026 has not happened. By the rule this
     * module states — the most recent occurrence that has already started —
     * "20 dec to 5 jan" means December 2025 to January 2026, which is the
     * reading that returns data rather than an empty report. It is also
     * consistent with "may to july" asked in March meaning last year's.
     *
     * The part that genuinely matters is that January lands in the year AFTER
     * December, rather than both being stamped with the same year and
     * producing a backwards range.
     */
    const r = parseDateRange('20 dec to 5 jan', AUG_2026)!
    expect(ist(r.from)).toBe('2025-12-20')
    expect(ist(r.to)).toBe('2026-01-06')
    expect(r.to.getTime()).toBeGreaterThan(r.from.getTime())
  })
})

describe('month to month means WHOLE months', () => {
  test('"may to july" runs 1 May to the end of July', () => {
    const r = parseDateRange('may to july', AUG_2026)!
    expect(ist(r.from)).toBe('2026-05-01')
    // Exclusive end = 1 Aug, so all of 31 July is included.
    expect(ist(r.to)).toBe('2026-08-01')
  })

  test('"april se june tak"', () => {
    const r = parseDateRange('april se june tak', AUG_2026)!
    expect(ist(r.from)).toBe('2026-04-01')
    expect(ist(r.to)).toBe('2026-07-01')
  })
})

describe('which year did they mean', () => {
  test('a range already past this year uses this year', () => {
    // Asked in August, "may to july" is this year's.
    expect(ist(parseDateRange('may to july', AUG_2026)!.from)).toBe('2026-05-01')
  })

  test('a range still ahead this year uses LAST year', () => {
    /*
     * Asked in March, "may to july" of THIS year has not happened. Reporting
     * on it would show an empty page. The most recent occurrence that has
     * actually started is last year's, which is the reading that produces
     * data — the one inference made without being told.
     */
    expect(ist(parseDateRange('may to july', MAR_2026)!.from)).toBe('2025-05-01')
  })
})

describe('refuse rather than repair', () => {
  test('an impossible date is refused, NOT rounded', () => {
    /*
     * Silently turning 31 February into the 28th would answer a question
     * nobody asked, in a report labelled as theirs.
     */
    expect(parseDateRange('31 february to 5 march', AUG_2026)).toBeNull()
    expect(parseDateRange('31 april to 5 may', AUG_2026)).toBeNull()
  })

  test('a backwards single-month range is refused', () => {
    // "27 july to 14 july" — same month, end before start.
    expect(parseDateRange('27 july to 14 july', AUG_2026)).toBeNull()
  })

  test('an unknown month is not a range', () => {
    expect(parseDateRange('smarch to jorvember', AUG_2026)).toBeNull()
  })

  test('sentences with no range at all return null', () => {
    for (const q of ['aaj ki sale', 'is mahine ka profit', 'Anil ka kitna baaki hai', '']) {
      expect({ q, r: parseDateRange(q, AUG_2026) }).toEqual({ q, r: null })
    }
  })
})

describe('the specific shape beats the general one', () => {
  test('"14 june to 27 july" is not read as the whole of June to July', () => {
    /*
     * Both patterns can match this sentence. Day-and-month is checked first;
     * otherwise the days would be dropped and the shopkeeper shown six extra
     * weeks of trading.
     */
    const r = parseDateRange('14 june to 27 july', AUG_2026)!
    expect(ist(r.from)).toBe('2026-06-14')
    expect(ist(r.from)).not.toBe('2026-06-01')
  })
})

describe('the label reads back what was understood', () => {
  test('it names both ends, inclusive', () => {
    const r = parseDateRange('14 june to 27 july', AUG_2026)!
    expect(r.label).toMatch(/14 Jun 2026/)
    // The LAST day, not the exclusive boundary — nobody says "to 28 July".
    expect(r.label).toMatch(/27 Jul 2026/)
  })
})

describe('an attempted-but-invalid range refuses the whole question', () => {
  test('hasDateRangeShape tells "no range" apart from "bad range"', () => {
    /*
     * THE DISTINCTION THAT WAS MISSING. "31 february to 5 march ki sale" was
     * answered "₹0.00 of sales TODAY": the parser correctly refused an
     * impossible date, no period word was found, and the sales branch fell
     * back to its default. A refusal had become an answer to a different
     * question.
     */
    expect(hasDateRangeShape('31 february to 5 march ki sale')).toBe(true)
    expect(parseDateRange('31 february to 5 march ki sale')).toBeNull()
    // No range attempted at all — the caller should carry on normally.
    expect(hasDateRangeShape('aaj ki sale')).toBe(false)
    expect(hasDateRangeShape('is mahine ka profit')).toBe(false)
  })
})
