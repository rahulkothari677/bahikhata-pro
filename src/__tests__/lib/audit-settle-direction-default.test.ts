/**
 * 🔒 The Settle screen must default the DIRECTION of money correctly, and must
 * never overwrite a direction the shopkeeper chose by hand.
 *
 * ── HISTORY, because this file has now been wrong twice in opposite ways ──
 *
 * FIRST: when Settle moved from a dialog to a page, the old code was
 *
 *   const defaultType = party?.type === 'supplier' ? 'paid'
 *     : (stats?.balance ?? 0) < 0 ? 'paid' : 'received'
 *
 * and the page carried over only the first branch. It type-checked, it built,
 * and 2,532 tests passed, because nothing asserted the second branch existed.
 * This file was written to pin it — as a SOURCE SCAN, matching the literal
 * text `type === 'supplier' || balance < 0`.
 *
 * SECOND: pinning the text pinned the bug in it. Two of them.
 *
 *   1. Asking the party type FIRST contradicts the screen for a supplier who
 *      owes US — after a return, an overpayment, a debit note. The header says
 *      "They owe you" and the direction box said "paid".
 *
 *   2. The `directionDefaulted` ref latched on the first render where `data`
 *      was truthy. With React Query that is the CACHED copy. Found live: a
 *      customer sitting at −₹1,025 was invoiced ₹2,100, Settle opened reading
 *      "They owe you ₹1,075" — and the direction box said "Paid to supplier",
 *      defaulted from the stale figure and then locked so the fresh balance
 *      could not correct it.
 *
 * Both produce exactly the failure the original comment warned about: the label
 * and the direction disagreeing, and a payment recorded backwards moving the
 * balance the wrong way by TWICE the amount.
 *
 * ── WHAT CHANGED, AND WHY THAT IS NOT BENDING A TEST TO GO GREEN ──
 *
 * The rule now lives in `lib/settle-direction`, where `settle-direction.test.ts`
 * exercises every combination of party type and balance sign against a single
 * invariant: the default may never contradict the balance label. That is a
 * stronger statement than the text this file used to match, and it is checked
 * behaviourally rather than by regex.
 *
 * So the assertions below no longer copy the rule. They guard the two things a
 * source scan is actually good for: that PartySettle DELEGATES to that rule
 * instead of growing its own again, and that a manual choice still wins.
 */
import fs from 'fs'
import path from 'path'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const src = readStripped('components/parties/PartySettle.tsx')

describe('Settle defaults the payment direction, and defers to the shopkeeper', () => {
  test('the scan actually reaches the defaulting code', () => {
    // Without this, every assertion below could pass against an empty string.
    expect(src.length).toBeGreaterThan(500)
    expect(src).toMatch(/setPaymentType/)
  })

  test('the direction comes from the shared rule, not a rule rewritten here', () => {
    expect(src).toMatch(/from '@\/lib\/settle-direction'/)
    expect(src).toMatch(/setPaymentType\(defaultSettleDirection\(/)
  })

  test('no hand-rolled direction rule has grown back alongside it', () => {
    // The two shapes this component has already had. Either reappearing means
    // the rule has been forked and the two copies will drift.
    expect(src).not.toMatch(/type === 'supplier'\s*\|\|\s*balance < 0/)
    expect(src).not.toMatch(/setPaymentType\('paid'\)/)
  })

  test('a manual choice is never overwritten', () => {
    // The effect must stop re-deriving once the shopkeeper touches the
    // dropdown. A bare effect on [balance] would snap their deliberate choice
    // back on the next refetch.
    expect(src).toMatch(/userChoseDirection/)
    expect(src).toMatch(/userChoseDirection\.current = true/)
  })

  test('the latch is armed by the dropdown, not by the first render', () => {
    /*
     * THE WHOLE POINT OF THE SECOND FIX. Arming on first render is what let a
     * stale cached balance lock in a wrong direction. The flag must be set
     * inside the Select's change handler and nowhere else, so re-deriving
     * continues for as long as the shopkeeper has not expressed a preference.
     */
    const armings = src.match(/userChoseDirection\.current = true/g) || []
    expect(armings).toHaveLength(1)
    const handler = /onValueChange=\{[\s\S]{0,400}?userChoseDirection\.current = true/
    expect(src).toMatch(handler)
    // And it must NOT be armed inside the defaulting effect.
    expect(src).not.toMatch(/useEffect\([\s\S]{0,300}?userChoseDirection\.current = true/)
  })

  test('the page still labels a negative balance as money we owe', () => {
    // The label and the default must agree; this is the pairing that broke.
    expect(src).toMatch(/balance < 0 \? 'You owe them'/)
  })
})
