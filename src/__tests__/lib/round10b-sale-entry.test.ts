/**
 * Round 10b — the New Sale screen (2026-07-22).
 *
 * Two defects found by reading the component, its API and its state wiring as
 * one story, which is the pass this screen had never had.
 *
 * 1. DRAFTS LOST THE TRANSACTION TYPE.
 *    A credit note in progress autosaved into the SAME bucket as a plain sale
 *    (`txn-sale`) and the saved payload carried none of the fields that make
 *    it a note. A shopkeeper recording a ₹500 customer return who got
 *    interrupted, came back, restored the draft and saved it recorded a ₹500
 *    SALE: the customer's dues went UP ₹500 instead of DOWN ₹500 — a ₹1,000
 *    swing the wrong way — and GST reported an outward supply rather than a
 *    credit note.
 *
 * 2. THE SCREEN SHOWED PROFIT TO STAFF.
 *    "Gross Profit ₹X (Y%)" rendered in the summary with no hideProfit gate,
 *    on the one screen shop assistants use all day. Rounds 12-15 closed this
 *    on the dashboard, inventory and reports and missed this one.
 */
import fs from 'fs'
import path from 'path'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const entry = readStripped('components/ledger/TransactionEntry.tsx')

describe('drafts remember what the form was', () => {
  test('the autosave payload carries the transaction mode', () => {
    const start = entry.indexOf('save({')
    expect(start).toBeGreaterThan(-1)
    const payload = entry.slice(start, entry.indexOf('})', start))
    for (const field of ['actualType', 'noteReason', 'affectsStock', 'originalTransactionId']) {
      expect(payload).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })

  test('the autosave effect re-runs when the mode changes', () => {
    // Otherwise switching into note mode would not be persisted until some
    // other field happened to change.
    const start = entry.indexOf('save({')
    const deps = entry.slice(entry.indexOf('}, [', start), entry.indexOf('])', entry.indexOf('}, [', start)))
    expect(deps).toMatch(/actualType/)
    expect(deps).toMatch(/originalTransactionId/)
  })

  test('restore applies the mode, and an older draft without it does not downgrade a note', () => {
    expect(entry).toMatch(/if \(draft\.actualType\) setActualType\(draft\.actualType\)/)
    expect(entry).toMatch(/if \(typeof draft\.affectsStock === 'boolean'\) setAffectsStock/)
    // `undefined` must leave the current mode alone rather than force a sale.
    expect(entry).toMatch(/if \(draft\.originalTransactionId !== undefined\)/)
  })

  test('the restore toast names the mode so the user can see what came back', () => {
    expect(entry).toMatch(/restoredAs/)
    expect(entry).toMatch(/credit note/)
  })
})

describe('profit is not shown to hide-profit staff on the entry screen', () => {
  test('the component reads hideProfit', () => {
    expect(entry).toMatch(/const \{ hideProfit \} = useSetting\(\)/)
  })

  test('both profit rows are gated', () => {
    // The sale row and the "profit reversed" row for credit/debit notes.
    expect(entry).toMatch(/\{!hideProfit && isSale && !isNote && totalProfit > 0 &&/)
    expect(entry).toMatch(/\{!hideProfit && isNote && totalProfit < 0 &&/)
  })

  test('no profit row renders without the gate', () => {
    // Any JSX branch keyed on totalProfit must be behind !hideProfit.
    const branches = entry.match(/\{[^{}]*totalProfit [<>]=? 0 &&/g) || []
    expect(branches.length).toBeGreaterThan(0)
    for (const b of branches) expect(b).toMatch(/!hideProfit/)
  })
})

describe('items verified as already correct — do not re-flag', () => {
  test('the paid-amount snap zone is already narrowed (V26 N7)', () => {
    const paid = readStripped('lib/paid-amount.ts')
    // A ₹999.50 payment on a ₹1,000 bill must stay partial.
    expect(paid).toMatch(/0\.005/)
    expect(paid).not.toMatch(/Math\.abs\(totalAmount - finalPaid\) < 1/)
  })

  test('estimate conversion carries the order discount', () => {
    const convert = readStripped('app/api/transactions/[id]/convert/route.ts')
    expect(convert).toMatch(/const orderDiscount = toMoney\(estimate\.discountAmount\)/)
    expect(convert).toMatch(/discountAmount: roundMoney\(orderDiscount\)/)
  })

  test('the profit reports are refused server-side for hide-profit staff', () => {
    // BillWiseProfit/ItemWiseProfit have no client gate and do not need one —
    // the data never leaves the server.
    const reports = readStripped('app/api/reports/route.ts')
    expect(reports).toMatch(/hideProfit && \(type === 'bill-profit' \|\| type === 'item-profit'\)/)
  })
})
