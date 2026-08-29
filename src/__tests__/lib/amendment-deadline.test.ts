/**
 * How long a correction stays possible, and which ones are never possible
 * (#89, #90).
 *
 * `buildAmendments` answers "has this invoice changed since we filed it?".
 * These are the two questions that follow, and the app never asked either:
 * is it too late, and is this change even allowed?
 */

import {
  amendmentDeadline,
  gstinChangeBlocksAmendment,
  GSTIN_AMENDMENT_REMEDY,
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

describe('a customer GSTIN can never be amended', () => {
  test('it is blocked, whatever else changed on the invoice', () => {
    expect(gstinChangeBlocksAmendment(['Customer GSTIN changed from A to B'])).toBe(true)
    expect(gstinChangeBlocksAmendment(['Value changed', 'Customer GSTIN changed'])).toBe(true)
  })

  test('ordinary corrections are not blocked', () => {
    for (const c of ['Value changed', 'Invoice date changed', 'Place of supply changed']) {
      expect({ c, blocked: gstinChangeBlocksAmendment([c]) }).toEqual({ c, blocked: false })
    }
  })

  test('the remedy is credit note + fresh invoice, not an amendment', () => {
    /*
     * WHAT I SHIPPED THIS MORNING WAS WRONG. The GSTR-1A route said a GSTIN
     * change "has to go in next month's return as an amendment". It does not —
     * it cannot be amended in any period, because it would move input credit
     * to a different business without telling the original buyer.
     *
     * Sending someone to next month's amendment screen would cost them a
     * rejected return and a wasted month.
     */
    expect(GSTIN_AMENDMENT_REMEDY).toMatch(/credit note/)
    expect(GSTIN_AMENDMENT_REMEDY).toMatch(/fresh bill/)
    expect(GSTIN_AMENDMENT_REMEDY).not.toMatch(/next month/)
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
    expect(viaGstr1a.reason).toBe(GSTIN_AMENDMENT_REMEDY)
    expect(gstinChangeBlocksAmendment(changes)).toBe(true)
  })
})
