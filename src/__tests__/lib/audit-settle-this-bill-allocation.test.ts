/**
 * 🔒 "SETTLE THIS BILL" — TARGETS THE BILL, AND FOLLOWS THE AMOUNT.
 *
 * Two live findings, both from Rahul, one day apart in the same flow.
 *
 * ── 1. The allocation was silently dropped ────────────────────────────────
 * Opening a ₹553 bill and pressing "Settle ₹553" filled the amount but left
 * every bill box at 0: "Applied to bills ₹0 of ₹553 · will be kept as an
 * advance". The payment would have been stored as an unallocated advance and
 * the invoice would still have read ₹553 due — collect the money, the bill
 * still says unpaid, ask the customer again.
 *
 * Cause: two effects wrote `alloc`. On the mount pass both ran against the
 * same render's values — the intent set alloc = { bill: 553 }, then the
 * auto-fill effect, still seeing touched === false and parsedAmount === 0,
 * called setAlloc({}). The writes batched and the later one won.
 *
 * ── 2. Part-payment was impossible without editing two fields ─────────────
 *   "when i click settle bill from sales ledger for due and enter the amount
 *    it's not accepting the payment. also it directly taking the full payment
 *    automatically."
 *
 * The first fix pinned the pre-filled allocation with a ref and set `touched`,
 * which means "the shopkeeper chose this". Lowering Amount received to ₹200
 * then left the bill still claiming ₹400 — "You have applied more than the
 * amount received" — with Record disabled. A part-payment flow you cannot make
 * a part-payment in.
 *
 * ── The rule both findings point at ───────────────────────────────────────
 * `alloc` has exactly ONE writer: the allocation effect. The intent records
 * WHICH bill and a starting amount; it never writes `alloc`. `touched` means
 * only "a bill box was edited by hand". So changing the amount re-derives the
 * split, which is what makes repeated part-payments against one bill work.
 *
 * Single ownership also removes the mount race by construction — there is no
 * second writer left to be overwritten.
 */
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.join(process.cwd(), 'src/components/parties/PartySettle.tsx'), 'utf8',
)

/** The intent effect — the one that consumes `pendingSettle`. */
const intentEffect = (() => {
  const i = src.indexOf('if (!pendingSettle')
  return i === -1 ? '' : src.slice(i, i + 600)
})()

/** The allocation effect — the one that calls the oldest-first planner. */
const allocEffect = (() => {
  const p = src.indexOf('planAllocationOldestFirst(rest')
  if (p === -1) return ''
  const start = src.lastIndexOf('useEffect(() => {', p)
  return src.slice(start, src.indexOf('}, [', p) + 60)
})()

describe('the intent records a target, it does not write the allocation', () => {
  test('the scan found both effects', () => {
    expect(intentEffect.length).toBeGreaterThan(50)
    expect(allocEffect.length).toBeGreaterThan(100)
  })

  test('the intent remembers WHICH bill', () => {
    expect(intentEffect).toMatch(/setIntentBillId\(pendingSettle\.transactionId\)/)
  })

  test('the intent does NOT write alloc — that was the mount-race', () => {
    expect(intentEffect).not.toMatch(/setAlloc\(/)
  })

  test('the intent does NOT claim the shopkeeper touched anything', () => {
    // Setting touched here is what froze the pre-filled amount and made a
    // part-payment impossible without editing a second field.
    expect(intentEffect).not.toMatch(/setTouched\(true\)/)
  })
})

describe('the allocation follows the amount', () => {
  test('only a hand edit stops it re-deriving', () => {
    expect(allocEffect).toMatch(/if \(touched\) return/)
    expect(allocEffect).not.toMatch(/explicitAlloc/)
  })

  test('it re-runs when the amount or the target changes', () => {
    expect(allocEffect).toMatch(/\[parsedAmount, openBills, touched, intentBillId\]/)
  })

  test('the targeted bill is paid first, capped at its own due', () => {
    expect(allocEffect).toMatch(/Math\.min\(remaining, intentBill\.due\)/)
  })

  test('any remainder flows oldest-first across the OTHER bills', () => {
    // "Clear this bill, then carry on with the older ones."
    expect(allocEffect).toMatch(/filter\(\(b: any\) => b\.id !== intentBill\.id\)/)
    expect(allocEffect).toMatch(/planAllocationOldestFirst\(rest/)
  })
})

describe('the shopkeeper can always get back to a plain split', () => {
  test('"Auto-fill oldest first" clears the target and the hand edits', () => {
    expect(src).toMatch(/setIntentBillId\(null\)[\s\S]{0,40}setTouched\(false\)/)
  })

  test('that escape hatch is offered when arriving from a bill, not only after an edit', () => {
    expect(src).toMatch(/\(touched \|\| intentBillId\) && parsedAmount > 0/)
  })
})

describe('nothing locks the amount', () => {
  test('the amount field stays editable', () => {
    // A part-payment is the ordinary case; the pre-fill is a suggestion.
    expect(src).not.toMatch(/id="settle-amount"[\s\S]{0,300}\breadOnly\b/)
    expect(src).not.toMatch(/id="settle-amount"[\s\S]{0,300}\bdisabled\b/)
  })
})
