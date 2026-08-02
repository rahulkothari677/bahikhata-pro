/**
 * 🔒 The Settle screen must default the DIRECTION of money from BOTH signals.
 *
 * Found by auditing my own session diff, not by a failing test — which is the
 * point of writing this one.
 *
 * When Settle moved from a dialog to a page, the old code was:
 *
 *   const defaultType = party?.type === 'supplier' ? 'paid'
 *     : (stats?.balance ?? 0) < 0 ? 'paid'
 *     : 'received'
 *
 * and the page carried over only the FIRST branch. It type-checked, it built,
 * and 2,532 tests passed, because nothing asserted the second branch existed.
 *
 * What it costs a shopkeeper: a CUSTOMER with a negative balance — one who
 * overpaid, or whose credit notes exceed their bills — is someone we owe. The
 * page's own header says "You owe them", but the direction box would have said
 * "Received". Recording it that way moves the balance the WRONG way, so the
 * error is twice the amount handed over, and it lands on a party whose account
 * is already unusual enough that nobody is checking it closely.
 *
 * These are source guards, in the same style as double-count-guard.test.ts:
 * they exist specifically to fail if the branch is deleted again.
 */
import fs from 'fs'
import path from 'path'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const src = readStripped('components/parties/PartySettle.tsx')

describe('Settle defaults the payment direction from party type AND balance sign', () => {
  test('the scan actually reaches the defaulting code', () => {
    // Without this, every assertion below could pass against an empty string.
    expect(src.length).toBeGreaterThan(500)
    expect(src).toMatch(/setPaymentType/)
  })

  test('a supplier defaults to money going out', () => {
    expect(src).toMatch(/type === 'supplier'/)
  })

  test('a NEGATIVE balance also defaults to money going out', () => {
    // The branch that was lost. `balance < 0` means we owe them, whatever the
    // party type says.
    expect(src).toMatch(/balance < 0/)
  })

  test('both signals feed the same default, not two separate rules', () => {
    // Written as one condition so a future edit cannot satisfy the two tests
    // above with unrelated code elsewhere in the file.
    expect(src).toMatch(/type === 'supplier'\s*\|\|\s*balance < 0[\s\S]{0,40}setPaymentType\('paid'\)/)
  })

  test("the default is applied once and cannot overwrite a manual choice", () => {
    // A bare effect on [balance] would snap the dropdown back every refetch,
    // silently reversing a direction the shopkeeper had deliberately changed.
    expect(src).toMatch(/directionDefaulted/)
    expect(src).toMatch(/directionDefaulted\.current = true/)
  })

  test('the page still labels a negative balance as money we owe', () => {
    // The label and the default must agree; this is the pairing that broke.
    expect(src).toMatch(/balance < 0 \? 'You owe them'/)
  })
})
