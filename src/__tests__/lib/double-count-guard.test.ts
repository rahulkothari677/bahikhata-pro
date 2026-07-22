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

const src = readStripped('components/parties/PartyProfile.tsx')

describe('Settle dialog shows the risk before saving, not after', () => {
  test('it computes how much is already recorded on the bills', () => {
    expect(src).toMatch(/const alreadyPaidOnBills =/)
    // Received money compares against invoice `totalReceived`, money paid out
    // against `totalPaid` — using one for both would show a supplier the
    // customer figure.
    expect(src).toMatch(/paymentType === 'received'/)
    expect(src).toMatch(/stats\?\.totalReceived/)
    expect(src).toMatch(/stats\?\.totalPaid/)
  })

  test('the panel is rendered inside the dialog, gated on there being a risk', () => {
    expect(src).toMatch(/\{alreadyPaidOnBills > 0 && \(/)
    expect(src).toMatch(/Already recorded on this party/)
    // It must state the outstanding figure too — the number the shopkeeper
    // is deciding against.
    expect(src).toMatch(/Outstanding right now/)
  })

  test('typing more than is outstanding warns inline as you type', () => {
    expect(src).toMatch(/const overpayAmount = Math\.max\(/)
    expect(src).toMatch(/\{overpayAmount > 0 && \(/)
  })
})

describe('over-payment requires a deliberate act', () => {
  const handler = src.slice(src.indexOf('const handleSavePayment'), src.indexOf('const handleSendReminder'))

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
