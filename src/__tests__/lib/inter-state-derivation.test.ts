/**
 * R10-1 — the GST tax head must never be a free choice on screen.
 *
 * What the bug did to a shopkeeper: the New Sale screen showed an editable
 * "Inter-state (IGST)" switch. Turning it on moved the tax to IGST in the
 * on-screen total. The server — correctly refusing to trust a tax flag sent by
 * the browser — worked the answer out from the shop and customer states and
 * saved CGST+SGST instead. So the shopkeeper saw one thing, the bill stored
 * another, and the GST return went out under the wrong heading. It would not
 * match the customer's GSTR-2B, and fixing it later means revising a filed
 * return.
 *
 * The fix has two halves and BOTH are asserted here: one shared rule (so the
 * screen and the server cannot compute different answers), and a screen that
 * only offers a choice when the answer is genuinely unknown.
 */
import fs from 'fs'
import path from 'path'
import { deriveInterStateFromStates } from '@/lib/gst-states'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('deriveInterStateFromStates', () => {
  test('different states are inter-state (IGST)', () => {
    expect(deriveInterStateFromStates('Maharashtra', 'Gujarat')).toEqual({
      isInterState: true,
      indeterminate: false,
    })
  })

  test('same state is intra-state (CGST + SGST)', () => {
    expect(deriveInterStateFromStates('Maharashtra', 'Maharashtra')).toEqual({
      isInterState: false,
      indeterminate: false,
    })
  })

  test('case and surrounding spaces do not change the tax head', () => {
    // A customer typed as "maharashtra " must not be billed IGST.
    expect(deriveInterStateFromStates('Maharashtra', '  maharashtra ')).toEqual({
      isInterState: false,
      indeterminate: false,
    })
  })

  test('a missing state on either side is indeterminate, never a silent guess', () => {
    for (const pair of [
      ['Maharashtra', null],
      ['Maharashtra', ''],
      ['Maharashtra', '   '],
      [null, 'Gujarat'],
      [undefined, undefined],
    ] as Array<[string | null | undefined, string | null | undefined]>) {
      const result = deriveInterStateFromStates(pair[0], pair[1])
      expect(result.indeterminate).toBe(true)
      // Indeterminate still defaults to intra-state, which is what the server
      // has always stored — the UI is what asks the user in this case.
      expect(result.isInterState).toBe(false)
    }
  })
})

describe('one definition, used by both the screen and the server', () => {
  test('the server helper delegates to the shared rule instead of re-implementing it', () => {
    const gst = readStripped('lib/gst.ts')
    expect(gst).toMatch(/deriveInterStateFromStates\(/)
    // The old inline comparison must be gone — two copies is how they drift.
    expect(gst).not.toMatch(/shopState\.toLowerCase\(\) !== partyState\.toLowerCase\(\)/)
  })

  test.each([
    'components/ledger/TransactionEntry.tsx',
    'components/ledger/TransactionDetail.tsx',
  ])('%s uses the shared rule', (rel) => {
    const src = readStripped(rel)
    expect(src).toMatch(/deriveInterStateFromStates/)
  })
})

describe('the New Sale screen offers a choice only when the answer is unknown', () => {
  const entry = readStripped('components/ledger/TransactionEntry.tsx')

  test('the switch is rendered only in the indeterminate branch', () => {
    // The exact shape that was broken: an unconditional
    // `<Switch checked={isInterState} onCheckedChange={setIsInterState} />`.
    const switchUses = entry.match(/<Switch[^>]*onCheckedChange=\{setIsInterState\}/g) || []
    expect(switchUses).toHaveLength(1)
    const idx = entry.indexOf('onCheckedChange={setIsInterState}')
    const preceding = entry.slice(Math.max(0, idx - 300), idx)
    expect(preceding).toMatch(/derivedInterState\.indeterminate \?/)
  })

  test('the on-screen preview follows the derivation, not a stale user choice', () => {
    // Without this the badge could say IGST while the totals still showed
    // CGST+SGST — or a restored draft could keep the old answer.
    expect(entry).toMatch(/if \(!derivedInterState\.indeterminate\)/)
    expect(entry).toMatch(/setIsInterState\(prev =>/)
  })

  test('an unknown state tells the user how to fix it', () => {
    expect(entry).toMatch(/no state saved/)
    expect(entry).toMatch(/state is not set/)
  })
})

describe('the edit dialog shows the same derived answer', () => {
  const detail = readStripped('components/ledger/TransactionDetail.tsx')

  test('no editable inter-state control exists there', () => {
    expect(detail).not.toMatch(/onCheckedChange=\{[^}]*[iI]nterState/)
  })

  test('it displays the value the server will compute, not the stale stored one', () => {
    // The old disabled Switch showed the SAVED flag, which goes stale the
    // moment the customer is changed in the dialog.
    expect(detail).toMatch(/editInterState/)
    expect(detail).not.toMatch(/<Switch checked=\{form\.isInterState\} disabled \/>/)
  })
})
