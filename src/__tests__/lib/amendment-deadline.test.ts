/**
 * How long a correction stays possible, and what a GSTIN change needs
 * (#89, #90).
 *
 * `buildAmendments` answers "has this invoice changed since we filed it?".
 * These are the two questions that follow, and the app never asked either:
 * is it too late, and is this change even allowed?
 */

import {
  amendmentDeadline,
  gstinChanged,
  GSTIN_GSTR1A_REMEDY,
  GSTIN_CORRECTION_ROUTE,
} from '@/lib/gstr1-amendments'
import { correctionFitsGstr1a } from '@/lib/gstr1a-window'

describe('the deadline — 30 November, or the annual return, whichever is EARLIER', () => {
  test('an invoice from July 2026 (FY 2026-27) closes on 30 Nov 2027', () => {
    const d = amendmentDeadline('072026', new Date(2026, 7, 29))
    expect(d.novemberCutoff).toEqual(new Date(2027, 10, 30))
    expect(d.expired).toBe(false)
  })

  test('January to March belong to the PREVIOUS financial year', () => {
    /*
     * The one that is easy to get wrong and expensive when you do. February
     * 2026 is in FY 2025-26, so its deadline is 30 November 2026 — not 2027.
     * Reading the calendar year would hand a shopkeeper a year they do not
     * have, and they would discover it only when the portal refused them.
     */
    const feb = amendmentDeadline('022026', new Date(2026, 7, 29))
    expect(feb.novemberCutoff).toEqual(new Date(2026, 10, 30))

    const apr = amendmentDeadline('042026', new Date(2026, 7, 29))
    expect(apr.novemberCutoff).toEqual(new Date(2027, 10, 30))
  })

  test('filing the annual return early shuts the door early', () => {
    /*
     * The half that catches people, and the half a calendar cannot tell you.
     * File GSTR-9 in August and corrections stop in August — three months
     * before the date everyone remembers.
     */
    const d = amendmentDeadline('072026', new Date(2026, 7, 29), new Date(2026, 7, 20))
    expect(d.effectiveDeadline).toEqual(new Date(2026, 7, 20))
    expect(d.expired).toBe(true)
    expect(d.closedBy).toBe('annual-return')
    expect(d.message).toMatch(/annual return/)
  })

  test('an annual return filed AFTER the cutoff does not extend it', () => {
    // "Whichever is earlier" only ever pulls the date forward.
    const d = amendmentDeadline('072026', new Date(2028, 0, 1), new Date(2027, 11, 15))
    expect(d.effectiveDeadline).toEqual(new Date(2027, 10, 30))
    expect(d.closedBy).toBe('november-cutoff')
  })

  test('past the cutoff, it says plainly that it is too late', () => {
    const d = amendmentDeadline('072026', new Date(2027, 11, 1))
    expect(d.expired).toBe(true)
    expect(d.message).toMatch(/Too late/)
  })

  test('while open, it warns that the annual return can close it sooner', () => {
    // A countdown to November alone would be a promise the annual return can
    // break without warning.
    const d = amendmentDeadline('072026', new Date(2027, 0, 1))
    expect(d.expired).toBe(false)
    expect(d.message).toMatch(/annual return/)
  })
})

describe('a customer GSTIN: GSTR-1A refuses it, the later-month route is disputed (#100)', () => {
  test('a GSTIN change is recognised, whatever else changed on the invoice', () => {
    expect(gstinChanged(['Customer GSTIN changed from A to B'])).toBe(true)
    expect(gstinChanged(['Value changed', 'Customer GSTIN changed'])).toBe(true)
  })

  test('ordinary corrections are not GSTIN changes', () => {
    for (const c of ['Value changed', 'Invoice date changed', 'Place of supply changed']) {
      expect({ c, blocked: gstinChanged([c]) }).toEqual({ c, blocked: false })
    }
  })

  test('the advice no longer calls it impossible — it gives the sure route and names the dispute', () => {
    /*
     * REWRITTEN 31 Oct 2026 (#100). On 29 Aug this test locked in "it cannot
     * be amended in any period" — which contradicts the GSTN GSTR-1A FAQ ("only
     * through GSTR 1 of the following tax periods") and the CA, three times.
     * GSTR-1A refuses it; whether Table 9A accepts it is disputed (#345); the
     * credit note + fresh bill route is the one every source accepts.
     */
    expect(GSTIN_CORRECTION_ROUTE).toMatch(/credit note/)
    expect(GSTIN_CORRECTION_ROUTE).toMatch(/fresh bill/)
    expect(GSTIN_CORRECTION_ROUTE).toMatch(/ask your CA/i)
    expect(GSTIN_CORRECTION_ROUTE).not.toMatch(/cannot|never|impossible/i)
    expect(GSTIN_GSTR1A_REMEDY).toMatch(/^GSTR-1A cannot change a customer’s GSTIN\./)
  })

  test('both correction routes give the SAME answer', () => {
    /*
     * The same-period route (GSTR-1A) and the later-period route now share one
     * definition. Two GSTIN rules would eventually disagree, and the
     * disagreement would be invisible — one screen offering a correction the
     * other refuses, on the same invoice.
     */
    const changes = ['Customer GSTIN changed from A to B']
    const viaGstr1a = correctionFitsGstr1a(changes)
    expect(viaGstr1a.fits).toBe(false)
    expect(viaGstr1a.reason).toBe(GSTIN_GSTR1A_REMEDY)
    expect(viaGstr1a.reason).toContain(GSTIN_CORRECTION_ROUTE) // the corrections list says the same words
    expect(gstinChanged(changes)).toBe(true)
  })
})
