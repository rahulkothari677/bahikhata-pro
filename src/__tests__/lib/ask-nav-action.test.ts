/**
 * 🔒 A2 — every answer offers the way out, and only one.
 *
 * Master plan §4.4, Control: "they always know what to do next". Before A2 only
 * balance answers offered anything; every other answer was a dead end — the
 * shopkeeper had to leave, remember where expenses live and find the month
 * again.
 *
 * Two failures are guarded here, and they pull in opposite directions:
 *   1. an answer with NO way out (the dead end A2 exists to fix), and
 *   2. an answer with FOUR buttons (§4.2, one primary action) — which is how
 *      a row of buttons becomes decoration nobody reads.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildNavAction, withNavAction } from '@/lib/ask-nav-action'
import { CAPABILITIES } from '@/lib/ask-capabilities'
import { getById } from '@/lib/nav-registry'

const SALES = { id: 'sales', label: 'Sales' }

describe('the button names the place', () => {
  test('"Open Sales", not "View details"', () => {
    // The shopkeeper is choosing between going somewhere and asking the next
    // question. A vague label makes them tap to find out which they picked.
    expect(buildNavAction({ target: SALES })).toEqual({
      kind: 'open-screen', label: 'Open Sales', destinationId: 'sales',
    })
  })
})

describe('never a second button on an answer that already acts', () => {
  test('a party balance keeps its three actions and gains nothing', () => {
    /*
     * THE REGRESSION THIS PINS. Balance answers already offer Send reminder /
     * Record payment / Open ledger. Appending "Open Parties" makes four, and
     * four buttons under one sentence is read as decoration — §4.2.
     */
    const payload = { headline: 'Anil owes ₹1,075', actions: [{ kind: 'remind' }, { kind: 'settle' }, { kind: 'open-party' }] }
    expect(withNavAction(payload, { id: 'parties', label: 'Parties' })).toBe(payload)
  })

  test('a notice keeps "Fix before filing" — the urgent button is not displaced', () => {
    const payload = { headline: '₹31,00,000 above', actions: [{ kind: 'open-screen', destinationId: 'gstr-3b' }] }
    const out = withNavAction(payload, { id: 'gst-summary', label: 'GST Summary' })
    expect(out.actions).toHaveLength(1)
    expect((out.actions as { destinationId: string }[])[0].destinationId).toBe('gstr-3b')
  })

  test('an answer that IS a navigation gets no button', () => {
    // "khata kholo" already replies "Opening Parties" and takes them there.
    const payload = { headline: 'Opening Parties', navigate: { kind: 'screen', destinationId: 'parties' } }
    expect(withNavAction(payload, { id: 'parties', label: 'Parties' })).toBe(payload)
  })
})

describe('the dead end A2 fixes', () => {
  test('a plain figure gains exactly one way out', () => {
    const out = withNavAction({ headline: '₹5,000.00 of expenses this month' }, { id: 'income-expense', label: 'Income & Expense' })
    expect(out.actions).toEqual([{ kind: 'open-screen', label: 'Open Income & Expense', destinationId: 'income-expense' }])
  })

  test('an empty actions array still counts as no actions', () => {
    // The route sends `actions: undefined` in most places but [] is reachable;
    // treating [] as "already acts" would silently restore the dead end.
    const out = withNavAction({ headline: '₹0.00', actions: [] as unknown[] }, SALES)
    expect(out.actions).toHaveLength(1)
  })
})

describe('permissions and unknown screens produce silence, never a broken button', () => {
  test('no target → no action', () => {
    // Null is what the route sends when the destination is gated for this staff
    // member (rule G6) or names no screen. One dead button teaches a shopkeeper
    // that the whole row is decorative.
    expect(buildNavAction({ target: null })).toBeNull()
    const payload = { headline: '₹5,000.00' }
    expect(withNavAction(payload, null)).toBe(payload)
  })
})

describe('which capabilities can offer a way out at all', () => {
  /*
   * `dataLivesAt` is a ViewType — the app's own screen union — NOT a nav
   * registry id. The two vocabularies overlap for most screens but not all,
   * and `ask-capabilities-guard` already checks it against ViewType. So A2
   * resolves it with getById and accepts that some views are not registry
   * destinations: a party profile and a bill are reached with a record id, and
   * `gst-tax` is a subcategory of GST screens rather than one screen.
   *
   * WHY PIN THE LIST. Silence is the correct behaviour for those three, and
   * silence is also what a registry rename would produce for the other nine —
   * the button would simply stop appearing, on every answer, with no test
   * failing. This is the test that fails instead.
   */
  /*
   * 🔒 #61/#68 changed this list. `tax_due` used to be here — its ViewType
   * `gst-tax` is no registry destination, so a clean GST month had NO button
   * at all, on the one answer that carries the moat. It now declares
   * `opensAt: 'gst-summary'` and resolves.
   *
   * The three that remain are record screens, correctly: a party profile and
   * a bill are reached with a record id, not from a "where can I go" list.
   */
  const NO_SINGLE_SCREEN = ['party_balance', 'party_transactions', 'open_invoice']

  test.each(CAPABILITIES.map(c => [c.name, c.opensAt || c.dataLivesAt] as const))(
    '%s → %s',
    (name, destinationId) => {
      const resolved = Boolean(getById(destinationId))
      expect(resolved).toBe(!NO_SINGLE_SCREEN.includes(name))
    },
  )

  test('#61: the GST answer resolves to a real screen', () => {
    const gst = CAPABILITIES.find(c => c.name === 'tax_due')!
    expect(getById(gst.opensAt!)?.label).toBe('GST Summary')
  })

  test('#68: top products opens the report it came from, not the hub', () => {
    /*
     * It resolved before — to `reports`, the whole hub — so this cannot be a
     * "does it resolve" check. The bug was landing somewhere too vague, which
     * only a named destination catches.
     */
    const top = CAPABILITIES.find(c => c.name === 'top_products')!
    expect(top.opensAt).toBe('item-profit')
    expect(getById('item-profit')?.label).toBe('Item-wise Profit')
  })
})

describe('the route has one exit, so the next answer cannot forget', () => {
  const routeSrc = readFileSync(join(process.cwd(), 'src/app/api/ask/route.ts'), 'utf8')

  test('no answered reply bypasses ok()', () => {
    /*
     * The real failure mode of A2 is not a wrong button — it is the THIRTEENTH
     * answer, added next month, returned directly and silently dead-ended.
     * Reintroduce `return NextResponse.json({ answered: true` anywhere in the
     * route and this fails.
     */
    const bypasses = [...routeSrc.matchAll(/return NextResponse\.json\(\{\s*\n\s*answered: true/g)]
    expect(bypasses).toHaveLength(0)
  })

  test('and the answers really do go through it', () => {
    const viaOk = [...routeSrc.matchAll(/return ok\(\{\s*\n\s*answered: true/g)]
    expect(viaOk.length).toBeGreaterThanOrEqual(10)
  })
})
