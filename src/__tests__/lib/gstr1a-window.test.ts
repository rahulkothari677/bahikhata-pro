/**
 * GSTR-1A — the same-period correction window (#41).
 *
 * THE DEFECT. When a filed invoice changes, this app had one answer: carry the
 * correction into the NEXT period's GSTR-1 as a 9A/9C amendment. /api/gstr-1
 * builds those from snapshots `monthYear: { not: monthYear }`, so a correction
 * to the period being viewed never surfaced on that period's own screen.
 *
 * The two routes are not equivalent. GSTR-3B's outward table has been locked
 * since July 2025 and auto-fills from GSTR-1, so correcting inside the window
 * means the right tax is paid once; missing it means paying the wrong figure
 * and reclaiming it next month.
 */

import { gstr1aWindow, correctionFitsGstr1a } from '@/lib/gstr1a-window'
import { readCode } from '@/test-support/read-source'

describe('when the window is open', () => {
  test('GSTR-1 filed, GSTR-3B not — open', () => {
    const w = gstr1aWindow({ gstr1Filed: true, gstr3bFiled: false })
    expect(w.state).toBe('open')
    expect(w.isOpen).toBe(true)
  })

  test('GSTR-3B filed — closed for good', () => {
    const w = gstr1aWindow({ gstr1Filed: true, gstr3bFiled: true })
    expect(w.state).toBe('closed')
    expect(w.isOpen).toBe(false)
  })

  test('GSTR-1 not filed — nothing to amend', () => {
    /*
     * Distinct from 'closed'. An unfiled return is simply editable, and saying
     * "amend it" about a draft would send someone to a portal screen for a
     * return the department has never seen.
     */
    const w = gstr1aWindow({ gstr1Filed: false, gstr3bFiled: false })
    expect(w.state).toBe('not-filed-yet')
    expect(w.isOpen).toBe(false)
  })

  test('the open message explains the cost of waiting, not just the rule', () => {
    // §2 — the moat is telling them whether the return will survive. "You may
    // file GSTR-1A" is a fact; "waiting means paying the wrong amount and
    // claiming it back next month" is a reason to act.
    const w = gstr1aWindow({ gstr1Filed: true, gstr3bFiled: false })
    expect(w.message).toMatch(/GSTR-3B/)
    expect(w.message).toMatch(/next month|claiming it back/)
  })
})

describe('a quarterly filer gets a refusal, not a guess', () => {
  /*
   * The CA left Q4.6 blank — GSTR-1A was one of the questions he did not
   * answer. My understanding is that QRMP filers get a GSTR-1A after the
   * quarterly GSTR-1, but that is unconfirmed, and this decides whether a
   * shopkeeper acts on a deadline.
   *
   * Refusing beats guessing, and it is checked BEFORE the 3B branch: a
   * quarterly filer with an unfiled GSTR-3B would otherwise fall through to
   * 'open' and be told confidently about a window on a schedule nobody has
   * confirmed.
   */
  test.each([
    [false, 'GSTR-3B unfiled'],
    [true, 'GSTR-3B filed'],
  ])('quarterly + %s → unknown, and says to ask the CA', (gstr3bFiled) => {
    const w = gstr1aWindow({ gstr1Filed: true, gstr3bFiled, filingFrequency: 'quarterly' })
    expect(w.state).toBe('unknown-for-qrmp')
    expect(w.isOpen).toBe(false)
    expect(w.message).toMatch(/CA/)
  })

  test('a monthly filer is answered normally', () => {
    expect(gstr1aWindow({ gstr1Filed: true, gstr3bFiled: false, filingFrequency: 'monthly' }).state).toBe('open')
  })
})

describe('the one thing GSTR-1A cannot do', () => {
  test('a changed customer GSTIN is refused, with the reason', () => {
    /*
     * Changing who an invoice was billed to moves input credit from one
     * taxpayer to another, and a same-period amendment may not do that (#90).
     *
     * It matters because it is a COMMON mistake, not an exotic one — typing
     * the wrong customer's GSTIN is one of the most frequent filing errors.
     * Offering GSTR-1A for it would send a shopkeeper to a screen that refuses
     * the change, and they would conclude the app was wrong rather than the
     * route.
     */
    const r = correctionFitsGstr1a(['GSTIN changed from 27AAA... to 29BBB...'])
    expect(r.fits).toBe(false)
    expect(r.reason).toMatch(/next month/)
  })

  test('value, date and place-of-supply changes are all fine', () => {
    for (const change of ['value changed', 'invoice date changed', 'place of supply changed', 'cancelled after filing']) {
      expect({ change, fits: correctionFitsGstr1a([change]).fits }).toEqual({ change, fits: true })
    }
  })

  test('one blocked change blocks the whole invoice', () => {
    // An invoice whose GSTIN AND value both moved cannot be split across two
    // routes — the portal matches on the original invoice, once.
    expect(correctionFitsGstr1a(['value changed', 'GSTIN changed']).fits).toBe(false)
  })
})

describe('the route surfaces this period, which it never used to', () => {
  const api = readCode('src/app/api/gstr-1/route.ts')

  test('the current period is checked against its own filed snapshot', () => {
    /*
     * The whole bug in one line. Amendments are built from
     * `monthYear: { not: monthYear }` — every OTHER period. So a correction to
     * the period on screen appeared nowhere until next month, by which time
     * the cheap fix had expired.
     */
    expect(api).toContain("existingSnapshot?.filingStatus === 'filed'")
    expect(api).toContain('filedInvoicesFrom(existingSnapshot.rawJson, monthYear)')
  })

  test('the window is decided from the SAME period’s GSTR-3B', () => {
    // Not any 3B, and not a date estimate — the closing edge is a stored fact.
    expect(api).toMatch(/gstReturn\.findUnique\(\{\s*where:\s*\{\s*userId_monthYear:\s*\{\s*userId,\s*monthYear\s*\}/)
  })

  test('it reuses buildAmendments rather than comparing a second way', () => {
    /*
     * Two rules answering "has this invoice changed?" would drift, and this
     * one decides WHICH RETURN a correction belongs in. Same reasoning as the
     * shared composition window.
     */
    const usesShared = api.includes('buildAmendments(ownFiled, ownCurrent)')
    expect({ usesShared }).toEqual({ usesShared: true })
  })

  test('every amendment table is flattened, none silently dropped', () => {
    /*
     * The four tables carry rows under three shapes — b2ba/b2cla use `inv`,
     * cdnra uses `nt`, cdnura is a flat array. My first version spread them
     * into one loop reading `.inv`, which typechecked only by accident. A
     * dropped table is a correction the shopkeeper is never told about.
     */
    for (const table of ['own.b2ba.flatMap', 'own.b2cla.flatMap', 'own.cdnra.flatMap', '...own.cdnura']) {
      expect({ table, present: api.includes(table) }).toEqual({ table, present: true })
    }
  })

  test('the extra queries only run when the window is actually open', () => {
    // A closed or unfiled period must not pay for two transaction queries on
    // every report load.
    expect(api).toContain('if (window.isOpen && ownFiled.length > 0)')
  })
})

describe('the screen does not overclaim', () => {
  const ui = readCode('src/components/reports/Gstr1aWindow.tsx')

  test('it says plainly that no GSTR-1A file is generated', () => {
    /*
     * We do not hold the portal's GSTR-1A JSON schema. A file that looks
     * upload-ready and is not would be the worst output this app could make —
     * worse than no feature, because it would be trusted.
     */
    expect(ui).toContain('We do not generate the')
  })

  test('it stays silent when nothing has changed since filing', () => {
    // Announcing an open window every month with nothing in it is how a panel
    // becomes furniture people stop reading.
    expect(ui).toContain("window.state === 'open' && corrections.length === 0) return null")
  })

  test('a CLOSED window renders nothing at all', () => {
    /*
     * My first version rendered a "GSTR-1A has closed" card whenever
     * corrections were outstanding. Verifying in the live app showed it could
     * never appear: the route computes corrections ONLY while the window is
     * open, so that array is always empty here. Dead code reading as a
     * working feature.
     *
     * Silence is also correct — once the window shuts, the correction belongs
     * in the next period, and NeedsAmending below already shows it. A card
     * announcing a closed door would sit on every past month forever.
     */
    expect(ui).toContain("if (window.state === 'closed') return null")
    expect(ui).not.toContain('GSTR-1A has closed for this month')
  })

  test('it renders above NeedsAmending, because it is the one that expires', () => {
    const report = readCode('src/components/reports/Gstr1Report.tsx')
    expect(report.indexOf('<Gstr1aWindow')).toBeLessThan(report.indexOf('<NeedsAmending'))
  })
})
