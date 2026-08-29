/**
 * IMS (#40) — the month where doing nothing is an answer.
 *
 * Section 38 was substituted by Notification 16/2025-Central Tax so that input
 * credit is built from what a taxpayer ACCEPTS in the Invoice Management
 * System — and an invoice nobody acts on is DEEMED ACCEPTED when GSTR-2B
 * generates on the 14th. Tied to ITC from 1 Oct 2025, compulsory for every
 * GSTR-3B filer from 1 Apr 2026.
 *
 * The matching was already built (/api/gstr-2b/reconcile). What was missing is
 * the deadline, and what each mismatch now ASKS of the shopkeeper.
 */

import { imsWindow, IMS_ACTIONS, IMS_GENERATION_DAY, IMS_WARN_WITHIN_DAYS } from '@/lib/ims-deadline'
import { readCode } from '@/test-support/read-source'

/** July 2026 as the portal writes it. Its 2B generates 14 Aug 2026. */
const JULY = '072026'

describe('the date that arrives on its own', () => {
  test('the deadline is the 14th of the FOLLOWING month', () => {
    // Not the 14th of the tax period. Off by one month here would tell a
    // shopkeeper the door had shut a month before it had.
    const w = imsWindow(JULY, false, new Date(2026, 7, 1))
    expect(w.generationDate).toEqual(new Date(2026, 7, IMS_GENERATION_DAY))
  })

  test('December rolls into January of the next year', () => {
    const w = imsWindow('122026', false, new Date(2026, 11, 20))
    expect(w.generationDate).toEqual(new Date(2027, 0, IMS_GENERATION_DAY))
  })

  test('open, closing and past are three different answers', () => {
    expect(imsWindow(JULY, false, new Date(2026, 7, 1)).state).toBe('open')
    expect(imsWindow(JULY, false, new Date(2026, 7, 10)).state).toBe('closing')
    expect(imsWindow(JULY, false, new Date(2026, 7, 20)).state).toBe('deemed-accepted')
  })

  test('the 14th itself is still in time; the 15th is not', () => {
    // The boundary decides whether a shopkeeper can still refuse an invoice.
    expect(imsWindow(JULY, false, new Date(2026, 7, 14)).state).toBe('closing')
    expect(imsWindow(JULY, false, new Date(2026, 7, 15)).state).toBe('deemed-accepted')
  })

  test('the warning band is a week — long enough to ask the supplier', () => {
    /*
     * A single day is an alarm, not a chance to act. A week lets a shopkeeper
     * ask a supplier what a strange invoice is before deciding to reject it,
     * which is the decision this whole screen exists to support.
     */
    const w = imsWindow(JULY, false, new Date(2026, 7, IMS_GENERATION_DAY - IMS_WARN_WITHIN_DAYS))
    expect(w.state).toBe('closing')
    expect(w.daysLeft).toBe(IMS_WARN_WITHIN_DAYS)
  })
})

describe('a filed GSTR-3B closes the period whatever the calendar says', () => {
  test('checked BEFORE the day count', () => {
    /*
     * Otherwise a period filed early would be reported as still open, and the
     * shopkeeper sent to a portal screen that refuses them. Same ordering rule
     * as the GSTR-1A window, and for the same reason.
     */
    expect(imsWindow(JULY, true, new Date(2026, 7, 1)).state).toBe('period-closed')
    expect(imsWindow(JULY, true, new Date(2026, 7, 20)).state).toBe('period-closed')
  })
})

describe('the message says that silence is agreement', () => {
  test('before the date, it says doing nothing accepts', () => {
    /*
     * The single most important sentence on the screen. Every shopkeeper's
     * instinct is that ignoring something leaves it alone; since the amended
     * Section 38 it does the opposite.
     */
    for (const asOn of [new Date(2026, 7, 1), new Date(2026, 7, 10)]) {
      expect(imsWindow(JULY, false, asOn).message).toMatch(/accepted automatically/)
    }
  })

  test('after it, it says the supplier’s version was accepted too', () => {
    // Accepting the invoice means accepting the tax treatment on it, which is
    // the part that quietly becomes the shopkeeper's problem.
    expect(imsWindow(JULY, false, new Date(2026, 7, 20)).message)
      .toMatch(/whatever the supplier said/)
  })

  test('and that it can still be fixed until GSTR-3B is filed', () => {
    // Otherwise "deemed accepted" reads as final, and someone who could still
    // fix it on the portal does not try.
    expect(imsWindow(JULY, false, new Date(2026, 7, 20)).message)
      .toMatch(/until you file GSTR-3B/)
  })
})

describe('an invoice you did not book asks a question, not a chore', () => {
  test('both readings are offered, and neither is chosen for them', () => {
    /*
     * THE POINT OF THE WHOLE TASK. The screen used to label these "Missing
     * Purchase" — a conclusion the app cannot reach. It tells the shopkeeper
     * they forgot something, so the obvious move is to enter the bill and make
     * the numbers agree.
     *
     * The same row can mean a supplier has filed an invoice against their
     * GSTIN that is not theirs. Entering that turns somebody else's mistake
     * into their own wrong return — and ignoring it accepts it anyway.
     *
     * Only the shopkeeper knows which. So both ways out are offered.
     */
    const a = IMS_ACTIONS.twoBOnly
    expect(a.options).toHaveLength(2)
    expect(a.options.join(' ')).toMatch(/forgot to enter/)
    expect(a.options.join(' ')).toMatch(/reject it on the portal/)
    expect(a.detail).toMatch(/not yours/)
  })

  test('a books-only row does NOT claim anything was deemed accepted', () => {
    /*
     * Nothing is on the portal to accept, so nothing can be deemed accepted.
     * Saying otherwise would send a shopkeeper chasing a deadline that does
     * not apply to them, and the action here is with the supplier anyway.
     */
    expect(IMS_ACTIONS.booksOnly.detail).toMatch(/Nothing is deemed accepted here/)
    expect(IMS_ACTIONS.booksOnly.options.join(' ')).toMatch(/Chase the supplier/)
  })

  test('a matched row offers no action at all', () => {
    // Calm when fine. An "action" on a row that agrees is noise that trains
    // people to skim the rows that do not.
    expect(IMS_ACTIONS.matched.options).toEqual([])
  })
})

describe('it is wired into the screen that already matches', () => {
  const api = readCode('src/app/api/gstr-2b/reconcile/route.ts')
  const ui = readCode('src/components/reports/Gstr2bReconciliation.tsx')

  test('the existing reconciliation is extended, not replaced', () => {
    /*
     * The matching was already built and good. A second matching engine would
     * be two rules answering "does this invoice exist in both places?", which
     * is the drift class that caused four earlier bugs.
     */
    expect(api).toContain('imsWindow(monthYear')
    expect(api).toContain('matched.length')      // the original summary survives
  })

  test('the deadline uses the SAME period’s GSTR-3B status', () => {
    expect(api).toMatch(/gstReturn\.findUnique\(\{\s*where:\s*\{\s*userId_monthYear:\s*\{\s*userId,\s*monthYear\s*\}/)
  })

  test('the dangerous label is gone', () => {
    // "Missing Purchase" told the shopkeeper what to conclude. Asserted on the
    // render — readCode strips comments, and the note above the label quotes
    // the old wording.
    expect(ui).not.toContain('Missing Purchase')
    expect(ui).toContain('Not in your books')
  })

  test('the countdown is silent when everything matched', () => {
    // Calm when fine. A countdown on a month with nothing to act on is how a
    // banner becomes furniture.
    expect(ui).toContain('summary.twoBOnly > 0 || summary.booksOnly > 0')
  })
})
