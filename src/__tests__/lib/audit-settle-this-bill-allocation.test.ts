/**
 * 🔒 "SETTLE THIS BILL" MUST ACTUALLY ALLOCATE TO THAT BILL.
 *
 * Found in the browser on 2026-08-03, on live data. Opening a ₹553 bill and
 * pressing "Settle ₹553" filled the amount correctly but left EVERY bill box
 * at 0 — "Applied to bills ₹0 of ₹553 · ₹553 will be kept as an advance".
 *
 * The payment would have been recorded as an unallocated advance and the
 * invoice would still have read ₹553 due. The shopkeeper collects the money,
 * the bill still says unpaid, and the customer gets asked for it again.
 *
 * THE MECHANISM — a React effect-ordering race that no unit test caught:
 *
 *   mount pass, both effects run against the SAME render's values
 *     effect 1 (intent):    setAlloc({ bill: '553' }); setTouched(true)
 *     effect 2 (auto-fill): sees touched === false, parsedAmount === 0
 *                           → setAlloc({})            ← wipes it
 *   the two writes batch; the later wins → {}
 *   next render: touched is finally true, effect 2 returns early and never
 *                restores what it deleted
 *
 * `touched` is state, captured by the render. A ref is read at the moment the
 * effect runs, which is what closes the window.
 *
 * These are source guards. The race lives in effect ordering, which a pure
 * function test cannot reach — so they assert the specific mechanism that
 * fixes it, and that the release path exists.
 */
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.join(process.cwd(), 'src/components/parties/PartySettle.tsx'), 'utf8',
)

describe('Settle-this-bill keeps its explicit allocation', () => {
  test('the scan reaches the component', () => {
    expect(src.length).toBeGreaterThan(1000)
    expect(src).toMatch(/pendingSettle/)
  })

  test('a ref guards the explicit allocation, not just state', () => {
    expect(src).toMatch(/explicitAlloc\s*=\s*useRef\(false\)/)
  })

  test('consuming the intent raises the ref', () => {
    const intent = src.slice(src.indexOf('if (!pendingSettle'), src.indexOf('if (!pendingSettle') + 500)
    expect(intent).toMatch(/explicitAlloc\.current\s*=\s*true/)
    expect(intent).toMatch(/setAlloc\(\{\s*\[pendingSettle\.transactionId\]/)
  })

  test('auto-fill checks the ref BEFORE it can clear the allocation', () => {
    const start = src.indexOf('planAllocationOldestFirst(openBills')
    expect(start).toBeGreaterThan(-1)
    // Walk back to the effect that contains the planner call.
    const effect = src.slice(src.lastIndexOf('useEffect(() => {', start), start)
    // The early return must mention the ref, and must come before setAlloc({}).
    const guardIdx = effect.indexOf('explicitAlloc.current')
    const clearIdx = effect.indexOf('setAlloc({})')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(clearIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(clearIdx)
  })

  test('"Auto-fill oldest first" releases the explicit choice', () => {
    // Without this the ref would latch and auto-fill could never resume.
    expect(src).toMatch(/explicitAlloc\.current\s*=\s*false[\s\S]{0,40}setTouched\(false\)/)
  })

  test('the amount stays editable after the intent is applied', () => {
    // A part-payment against a specific bill is the ordinary case; the intent
    // pre-fills, it must not lock.
    expect(src).not.toMatch(/id="settle-amount"[\s\S]{0,300}\breadOnly\b/)
    expect(src).not.toMatch(/id="settle-amount"[\s\S]{0,300}\bdisabled\b/)
  })
})
