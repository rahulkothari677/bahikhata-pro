/**
 * The double-counted payment (Rahul hit this for real, 2026-07-22).
 *
 * What it does to a shopkeeper: money typed into a bill's "Paid Amount" and
 * money recorded through "Settle" BOTH reduce what the customer owes. Enter
 * the same ₹100 in both places and the dues read ₹100 lower than reality —
 * and the statement sent to that customer understates the debt, so the
 * shopkeeper under-collects.
 *
 * The app already detected this, but only in a toast AFTER the save. These
 * guards assert the numbers now appear BEFORE the save, and that paying more
 * than is outstanding — the signature of re-entering a bill's payment —
 * requires a deliberate confirmation.
 */
import fs from 'fs'
import path from 'path'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// 🔒 AUDIT C5: the Settle DIALOG became a PAGE (PartySettle.tsx) — with nine
// open bills the dialog pushed its own save button off-screen. These guards
// were repointed, NOT relaxed: moving a screen must not quietly drop its safety
// rails, and this suite caught that the first version of the page had done
// exactly that (no double-count panel, no inline overpay warning, no
// confirm-before-save).
const src = readStripped('components/parties/PartySettle.tsx')

describe('Settle screen shows the risk before saving, not after', () => {
  test('it computes how much is already recorded on the bills', () => {
    expect(src).toMatch(/const alreadyPaidOnBills =/)
    // Received money compares against invoice `totalReceived`, money paid out
    // against `totalPaid` — using one for both would show a supplier the
    // customer figure.
    expect(src).toMatch(/paymentType === 'received'/)
    expect(src).toMatch(/stats\?\.totalReceived/)
    expect(src).toMatch(/stats\?\.totalPaid/)
  })

  /*
   * The standing amber panel was REMOVED on 2026-08-03, deliberately.
   *
   * It rendered whenever `alreadyPaidOnBills > 0` — that figure is the lifetime
   * total received from the party, so for any real customer it is always above
   * zero and the panel was always on. It was not a risk signal, it was
   * furniture. Rahul read it as "you have to pay ₹25,456.51", which is not what
   * it meant at all: a permanent warning is one people stop reading, and a
   * MISREAD permanent warning is worse than none.
   *
   * The protection was not dropped, it was moved to the moments that actually
   * carry risk, which the tests below pin down:
   *   - the figure is still computed, and still named in the confirmation; and
   *   - the inline warning fires when the amount EXCEEDS the outstanding, which
   *     is the real signature of re-entering money already on a bill.
   *
   * If the panel is ever reinstated, gate it on genuine risk, not on history.
   */
  test('the double-count figure is still computed and still reaches the shopkeeper', () => {
    expect(src).toMatch(/const alreadyPaidOnBills =/)
    // Used at the point of decision rather than displayed unconditionally.
    expect(src).toMatch(/alreadyPaidOnBills > 0/)
  })

  test('typing more than is outstanding warns inline as you type', () => {
    expect(src).toMatch(/const overpayAmount = Math\.max\(/)
    expect(src).toMatch(/\{overpayAmount > 0 && \(/)
    // The warning must name both numbers being compared, or it is just a colour.
    expect(src).toMatch(/more than the \{formatINR\(Math\.abs\(balance\)\)\} outstanding/)
  })

  test('the warning is legible — no micro-type on a money warning', () => {
    // globals.css reserves text-2xs (11px) for micro labels and text-3xs (10px)
    // for badges; body copy is text-xs minimum. A warning about money is not a
    // micro label.
    const warn = src.slice(src.indexOf('{overpayAmount > 0 && ('))
    expect(warn.slice(0, 200)).not.toMatch(/text-(2xs|3xs)/)
  })
})

describe('over-payment requires a deliberate act', () => {
  const handler = src.slice(src.indexOf('const handleSave ='), src.indexOf('if (isLoading'))

  test('the confirmation happens BEFORE the network call', () => {
    const confirmIdx = handler.indexOf('confirmDialog(')
    const fetchIdx = handler.indexOf("offlineFetch('/api/payments'")
    expect(confirmIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(-1)
    // The old behaviour warned only after the server had already stored it.
    expect(confirmIdx).toBeLessThan(fetchIdx)
  })

  test('cancelling stops the save', () => {
    expect(handler).toMatch(/if \(!confirmed\) return/)
  })

  test('it uses a tolerance so rounding cannot trigger a spurious prompt', () => {
    // Settling the exact outstanding amount must not ask "are you sure".
    expect(handler).toMatch(/outstanding \+ 0\.005/)
  })

  test('the message names the shortfall the shopkeeper would end up with', () => {
    expect(handler).toMatch(/less than reality/)
    expect(handler).toMatch(/already recorded as paid on their bills/)
  })

  test('with no bill-recorded payments it explains the advance instead of crying wolf', () => {
    // A genuine advance is legitimate; the prompt must not imply an error.
    expect(handler).toMatch(/treated as an advance/)
  })
})
