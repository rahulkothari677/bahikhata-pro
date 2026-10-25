/**
 * Phase 7g-1 — the saved bill on a phone (#193, #186, #153, #321).
 *
 *  - #186: a line shows the price as the shopkeeper TYPED it. Atta billed at
 *    ₹255 (MRP, 5% included) read ₹242.86 — the before-GST figure stored for
 *    the tax invoice. A GST bill shows both; a bill without GST columns never
 *    shows a before-GST figure (lib/refill-line.ts, shownLinePrice).
 *  - #153: Send bill is for a bill the shop GAVE; a purchase (a bill it
 *    received), an income or an expense has no one to send it to.
 *  - #321: the printed bill's HSN column read `item.hsnCode`, a field no bill
 *    line has, so every GST bill printed "—" for HSN. Every field the bill
 *    screen reads from a line must be a stored column.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { shownLinePrice } from '@/lib/refill-line'
import { readCode, balancedBlock } from '@/test-support/read-source'

describe('a line shows the price as typed (#186)', () => {
  const atta = { unitPrice: 242.86, enteredPrice: 255, priceIncludesGst: true }

  test('an MRP line reads ₹255 — and ₹242.86 before GST on a GST bill', () => {
    expect(shownLinePrice(atta, true)).toEqual({ price: 255, beforeGst: 242.86 })
  })
  test('a bill without GST columns never shows a before-GST figure', () => {
    expect(shownLinePrice(atta, false)).toEqual({ price: 255, beforeGst: null })
  })
  test('a price typed before GST is shown once', () => {
    expect(shownLinePrice({ unitPrice: 230, enteredPrice: 230, priceIncludesGst: false }, true)).toEqual({ price: 230, beforeGst: null })
  })
  test('a line saved before typed prices were kept shows its stored price', () => {
    expect(shownLinePrice({ unitPrice: 230, enteredPrice: null, priceIncludesGst: null }, true)).toEqual({ price: 230, beforeGst: null })
  })
  test('a 0% line whose price "includes GST" has nothing taken out — shown once', () => {
    expect(shownLinePrice({ unitPrice: 40, enteredPrice: 40, priceIncludesGst: true }, true)).toEqual({ price: 40, beforeGst: null })
  })
})

const detail = readCode('components/ledger/TransactionDetail.tsx')
const SEND_GATE = '{!(isPurchase || isIncome || isExpense) && ('

/** True when the file has ONE Send bill button and it sits inside the gate. */
function sendBillGated(code: string): boolean {
  if (code.split('Send bill').length - 1 !== 1) return false
  if (!code.includes(SEND_GATE)) return false
  return balancedBlock(code, SEND_GATE).includes('Send bill')
}

describe('Send bill only where a bill is sent (#153)', () => {
  test('the bill screen gates it', () => {
    expect(sendBillGated(detail)).toBe(true)
  })
  test('the check catches an ungated button and a second copy', () => {
    expect(sendBillGated(detail.replace(SEND_GATE, '{('))).toBe(false)
    expect(sendBillGated(detail + '\n<Button>Send bill</Button>')).toBe(false)
  })
})

describe('the phone reads lines, not a six-column table (#193)', () => {
  test('a stacked list on a phone; the table from the small-tablet width up', () => {
    const list = detail.indexOf('<ul className="sm:hidden divide-y')
    const table = detail.indexOf('<div className="hidden sm:block overflow-x-auto">')
    expect(list).toBeGreaterThan(-1)
    expect(table).toBeGreaterThan(list)
    // both SHOW the one price rule's answer (a call whose result is not rendered proves nothing)
    for (const part of [detail.slice(list, table), detail.slice(table, detail.indexOf('</table>', table))]) {
      expect(part).toContain('const price = linePrice(item)')
      expect(part).toContain('{price.main}')
    }
  })
  test('the on-screen bill never prints the stored before-GST price as "the" price', () => {
    const screen = balancedBlock(detail, 'export function TransactionDetail() {')
    expect(screen).not.toMatch(/formatINR\(item\.unitPrice\)/)
  })
})

/** Fields a saved bill line has: the TransactionItem columns and relations. */
function lineFields(): Set<string> {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  const start = schema.indexOf('model TransactionItem {')
  expect(start).toBeGreaterThan(-1)
  const body = schema.slice(start, schema.indexOf('\n}', start))
  const names = body.split(/\r?\n/).map((l) => l.trim().match(/^([a-zA-Z]\w*)\s+[A-Z]/)?.[1]).filter(Boolean) as string[]
  return new Set(names)
}

/** Fields read as `item.x` in a block that are not stored on a line. */
function unknownLineReads(block: string, fields: Set<string>): string[] {
  const read = Array.from(block.matchAll(/\bitem\.([a-zA-Z]\w*)/g), (m) => m[1])
  return Array.from(new Set(read.filter((f) => !fields.has(f))))
}

describe('every field the bill reads from a line exists (#321)', () => {
  const fields = lineFields()

  test('the schema list is the real one', () => {
    for (const f of ['hsn', 'unitPrice', 'enteredPrice', 'priceIncludesGst', 'total', 'product']) expect(fields.has(f)).toBe(true)
  })
  test('the bill screen and the printed bill read only stored fields', () => {
    const screen = balancedBlock(detail, 'export function TransactionDetail() {')
    // Sliced to the next function: balancedBlock would stop at the `{ txn, … }` in its signature.
    const p0 = detail.indexOf('function PrintInvoiceContent(')
    const p1 = detail.indexOf('function formatAuditValue(', p0)
    expect(p0).toBeGreaterThan(-1)
    expect(p1).toBeGreaterThan(p0)
    const print = detail.slice(p0, p1)
    expect(print).toContain('item.hsn')
    expect(unknownLineReads(screen, fields)).toEqual([])
    expect(unknownLineReads(print, fields)).toEqual([])
  })
  test('the check catches the old hsnCode read', () => {
    expect(unknownLineReads('<td>{item.hsnCode}</td>', fields)).toEqual(['hsnCode'])
  })
})
