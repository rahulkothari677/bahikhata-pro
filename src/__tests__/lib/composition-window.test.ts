/**
 * Leaving the composition scheme part-way through a quarter.
 *
 * THE BUG. CMP-08 charged composition tax on the WHOLE quarter regardless of
 * when the shop left. Crossing ₹1.5 crore ends composition on the crossing
 * date itself, with no grace period — from that moment the shop issues tax
 * invoices and charges regular GST. So 1% was applied on top of turnover the
 * shop had already paid regular GST on.
 *
 * The CA review: *"a shop that already charged and remitted regular GST on
 * post-crossing sales, then has 1% composition tax applied on top of that same
 * turnover by your CMP-08 calculation, is paying tax twice."* And it lands on
 * exactly the shops that are growing.
 *
 * The two directions are NOT symmetric, and these tests exist mostly to pin
 * that: entry can only be 1 April, so nothing prorates; exit is immediate and
 * mid-quarter, so the quarter splits.
 */

import {
  compositionWindow,
  sliceForComposition,
  canEnterCompositionFrom,
  financialYearStart,
} from '@/lib/composition-window'
import { readCode } from '@/test-support/read-source'

/** Q2 of FY 2026-27: July, August, September. periodEnd is exclusive. */
const Q2_START = new Date(2026, 6, 1)
const Q2_END = new Date(2026, 9, 1)

const onScheme = (from?: string | null, to?: string | null) =>
  compositionWindow({ compositionCategory: 'trader', compositionFrom: from ?? null, compositionTo: to ?? null })

describe('a shop still on the scheme', () => {
  test('is charged for the whole quarter', () => {
    const s = sliceForComposition(onScheme('2026-04-01'), Q2_START, Q2_END)!
    expect(s.compositionStart).toEqual(Q2_START)
    expect(s.compositionEnd).toEqual(Q2_END)
    expect(s.splitsMidPeriod).toBe(false)
    expect(s.note).toBeNull()
  })

  test('a shop that was never on it gets nothing, not zero', () => {
    /*
     * "Not a composition dealer" and "₹0 of composition tax" are different
     * answers. Returning a zero would let CMP-08 render a return the shop
     * must not file.
     */
    expect(sliceForComposition(compositionWindow({ compositionCategory: null }), Q2_START, Q2_END)).toBeNull()
  })
})

describe('leaving mid-quarter — the double-taxation bug', () => {
  test('the quarter stops at the exit date', () => {
    // Crossed ₹1.5 crore on 15 August. Only 1 July → 15 August is composition.
    const s = sliceForComposition(onScheme('2026-04-01', '2026-08-15'), Q2_START, Q2_END)!
    expect(s.splitsMidPeriod).toBe(true)
    expect(s.compositionStart).toEqual(Q2_START)
    // exclusive end = the day AFTER the exit date
    expect(s.compositionEnd).toEqual(new Date(2026, 7, 16))
  })

  test('the boundary is local midnight, not exit + 24 hours', () => {
    /*
     * Caught by these tests on the first run. An exit date arrives as UTC
     * midnight; in IST that is 05:30 on the day itself. Adding 86,400,000 ms
     * lands on 05:30 the next day, so the first five and a half hours of the
     * following day would still count as composition turnover — while every
     * quarter in the routes is built at LOCAL midnight. The two would disagree
     * by a few hours exactly at the seam, which is where the disputed invoice
     * always is.
     */
    const s = sliceForComposition(onScheme('2026-04-01', '2026-08-15'), Q2_START, Q2_END)!
    expect(s.compositionEnd.getHours()).toBe(0)
    expect(s.compositionEnd.getMinutes()).toBe(0)
  })

  test('the exit date itself is still composition turnover', () => {
    /*
     * The shop is a composition dealer UP TO AND INCLUDING the crossing date,
     * and regular from the day after. Treating the exit as exclusive would
     * push that day's sales into the regular scheme — and that is the one day
     * most likely to carry the large invoice that caused the crossing.
     */
    const s = sliceForComposition(onScheme('2026-04-01', '2026-08-15'), Q2_START, Q2_END)!
    const exitDay = new Date(2026, 7, 15, 23, 0)
    expect(exitDay >= s.compositionStart && exitDay < s.compositionEnd).toBe(true)
  })

  test('the rest of the quarter is handed to the regular scheme', () => {
    // Not silently dropped — it belongs in GSTR-1/3B, and the screen has to
    // say so or the missing turnover looks like our arithmetic failing.
    const s = sliceForComposition(onScheme('2026-04-01', '2026-08-15'), Q2_START, Q2_END)!
    expect(s.regularStart).toEqual(new Date(2026, 7, 16))
    expect(s.regularEnd).toEqual(Q2_END)
    expect(s.note).toMatch(/GSTR-1 and GSTR-3B/)
    expect(s.note).toMatch(/15 August 2026/)
  })

  test('a shop that left BEFORE the quarter is charged nothing for it', () => {
    // Left in June. Q2 is entirely regular-scheme — CMP-08 must refuse, not
    // return ₹0, or the shop files a return it should not.
    expect(sliceForComposition(onScheme('2026-04-01', '2026-06-20'), Q2_START, Q2_END)).toBeNull()
  })

  test('a shop that leaves AFTER the quarter is charged the full quarter', () => {
    const s = sliceForComposition(onScheme('2026-04-01', '2026-12-31'), Q2_START, Q2_END)!
    expect(s.splitsMidPeriod).toBe(false)
    expect(s.compositionEnd).toEqual(Q2_END)
  })
})

describe('entry is prospective only', () => {
  test('1 April is allowed', () => {
    expect(canEnterCompositionFrom(new Date(2026, 3, 1)).allowed).toBe(true)
  })

  test.each([
    ['2026-08-15', 'mid-quarter'],
    ['2026-04-02', 'one day late'],
    ['2026-01-01', 'calendar new year, not the FY'],
  ])('%s (%s) is refused', (date) => {
    const r = canEnterCompositionFrom(new Date(date))
    expect(r.allowed).toBe(false)
    // Refused WITH the reason — told only "not allowed", a shopkeeper assumes
    // the app is limited rather than the law.
    expect(r.reason).toMatch(/1 April/)
    expect(r.reason).toMatch(/law, not a limit in the app/)
  })

  test('the financial year runs April to March, not January to December', () => {
    expect(financialYearStart(new Date(2026, 7, 15))).toEqual(new Date(2026, 3, 1))
    expect(financialYearStart(new Date(2027, 1, 10))).toEqual(new Date(2026, 3, 1))
  })
})

describe('a back-dated registration cannot be charged for months before it', () => {
  test('the window clamps to the entry date', () => {
    // Entered 1 July, asked about Q2 which starts 1 July — same thing here,
    // but a Q1 question must not charge for April–June.
    const q1 = sliceForComposition(onScheme('2026-07-01'), new Date(2026, 3, 1), new Date(2026, 6, 1))
    expect(q1).toBeNull()
  })
})

describe('the settings route enforces both dates', () => {
  /*
   * These read the route as text because the handler needs a session, a
   * database and a Next request to call. What they pin is the SHAPE of two
   * rules that were each wrong once, in ways nothing else would notice.
   */
  const route = readCode('src/app/api/settings/route.ts')

  test('switching the scheme on stamps 1 April, never today', () => {
    /*
     * MY OWN BUG, found while wiring the screen. The route refused a
     * client-supplied entry date that was not 1 April — and then, when the
     * client sent none, wrote `new Date()`: the very value it had just
     * rejected. A rule enforced on one path and broken on the other is not a
     * rule.
     *
     * It also silently lost turnover. Once CMP-08 began clamping to this
     * column, a shop switching composition on in August would have had its
     * quarter start on the day it toggled, dropping every earlier sale in
     * that quarter from the return with no error anywhere.
     */
    expect(route).toContain('financialYearStart(new Date())')
    expect(route).not.toMatch(/sanitized\.compositionFrom\s*=\s*new Date\(\)/)
  })

  test('an exit before the entry date is refused, not stored', () => {
    /*
     * Storing it fails silently and confusingly: sliceForComposition finds no
     * overlap for any quarter, so every CMP-08 answers "you were not a
     * composition dealer then" while Settings still shows the scheme on. A
     * contradiction with nothing to click.
     */
    expect(route).toContain('Exit date is before the start date')
  })
})

describe('CMP-08 and GSTR-4 use the SAME window', () => {
  /*
   * THE DRIFT THIS FILE EXISTS TO PREVENT, and which happened anyway.
   *
   * composition-window.ts was written so the quarterly return and the annual
   * return could not disagree. I then wired it into /api/cmp-08 only, and
   * wrote a commit message claiming both. /api/gstr-4 kept aggregating the
   * whole financial year, so a shop that left the scheme in August had an
   * annual return declaring post-exit regular-scheme sales as composition
   * turnover — disagreeing with the sum of its own four CMP-08s.
   *
   * Neither error is visible. Table 6 is just bigger than it should be, and
   * the gap against Table 5 reads as rounding until a notice arrives. Found by
   * opening the app and checking a claim I had made about my own code, not by
   * any test.
   *
   * A shared module only prevents drift where it is actually called, so the
   * call itself is what gets asserted.
   */
  test.each([
    'src/app/api/cmp-08/route.ts',
    'src/app/api/gstr-4/route.ts',
  ])('%s narrows its period through sliceForComposition', file => {
    const code = readCode(file)
    expect({ file, uses: code.includes('sliceForComposition') }).toEqual({ file, uses: true })
  })

  test('neither route aggregates on an unclamped period boundary', () => {
    /*
     * The stronger claim: importing the helper is not the same as using it on
     * every query. Both routes had aggregates keyed to the raw period start —
     * `fyStart` in the annual return, `periodStart` in the quarterly one — and
     * those are exactly the names that must no longer appear inside a date
     * filter. Written against `gte:` specifically, because both names remain
     * legitimately in use for building the period and for reporting it back.
     */
    for (const file of ['src/app/api/cmp-08/route.ts', 'src/app/api/gstr-4/route.ts']) {
      const code = readCode(file)
      const badFilters = code.match(/gte:\s*(fyStart|periodStart|qStart)\b/g) || []
      expect({ file, badFilters }).toEqual({ file, badFilters: [] })
    }
  })
})

describe('the settings screen shows what the server actually holds', () => {
  const ui = readCode('src/components/settings/Settings.tsx')

  test('a refused exit date rolls the field back to the saved value', () => {
    /*
     * FOUND IN THE BROWSER, not by any API test — the API behaved correctly
     * throughout. The server refused an exit date earlier than the start date
     * and returned the reason; the field went on displaying the refused date,
     * and once the toast faded the screen showed a date the server had never
     * accepted.
     *
     * The cause is the same one that made the save guard fail earlier in this
     * task: the input's onChange writes into state before onBlur runs, so the
     * "previous value" captured there is the REJECTED one. Rolling back to it
     * restores exactly what was refused.
     *
     * Both bugs come from treating bound state as a record of what was saved.
     * It is a record of what was typed.
     */
    expect(ui).toContain('const prevTo = savedCompositionTo.current')
    expect(ui).not.toMatch(/const prevTo = compositionTo\b/)
  })

  test('the saved marker advances only after the server accepts', () => {
    // Otherwise a refused save would look saved, and the next blur would skip
    // it as unchanged — losing the correction silently.
    const persist = ui.slice(ui.indexOf('const persistComposition'), ui.indexOf('const persistRoundOff'))
    const okIndex = persist.indexOf('savedCompositionTo.current = patch.compositionTo')
    const catchIndex = persist.indexOf('} catch')
    expect(okIndex).toBeGreaterThan(-1)
    expect(okIndex).toBeLessThan(catchIndex)
  })
})
