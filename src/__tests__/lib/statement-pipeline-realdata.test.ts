/**
 * End-to-end statement pipeline against a REAL production payload (2026-07-26).
 *
 * The unit tests for the statement helpers were passing while the shipped code
 * was a different copy, so a green suite proved nothing about what a customer
 * actually receives. This test runs the WHOLE chain the PDF uses —
 *
 *     /api/parties/[id]  ->  computeStatementRunningBalance()
 *                        ->  computeStatementOpening()
 *                        ->  buildStatementRows()
 *
 * — on a payload captured verbatim from a running server, and asserts the two
 * properties a CA checks on a statement:
 *
 *   1. The opening balance is real. It is DERIVED (oldest.runningBalance -
 *      oldest.delta) but must equal the party's independently stored
 *      openingBalance field. Two different routes to the same number is the
 *      cross-check — the extraction bug produced Rs 1,500 here instead of 500.
 *
 *   2. The last row ties to the closing balance, reading top to bottom.
 *
 * Fixture: party "Statement Order Test", openingBalance 500, three sales on
 * three DIFFERENT dates (so ordering is provable), no payments.
 * Server-reported balance: 4000 = 500 + 1000 + 2000 + 500.
 */
import { computeStatementRunningBalance } from '@/lib/statement-balance'
import {
  buildStatementRows,
  computeStatementOpening,
  computeAgeingBuckets,
} from '@/lib/statement-rows'

/** Captured verbatim from GET /api/parties/[id] — note: NEWEST-FIRST. */
const API_STATEMENT_TRANSACTIONS = [
  { id: 't3', invoiceNo: 'INV-0015', date: '2026-07-20T00:00:00.000Z', type: 'sale', totalAmount: 500, paidAmount: 0 },
  { id: 't2', invoiceNo: 'INV-0014', date: '2026-06-15T00:00:00.000Z', type: 'sale', totalAmount: 2000, paidAmount: 0 },
  { id: 't1', invoiceNo: 'INV-0013', date: '2026-05-10T00:00:00.000Z', type: 'sale', totalAmount: 1000, paidAmount: 0 },
]
const API_STATEMENT_PAYMENTS: any[] = []
const SERVER_BALANCE = 4000
const PARTY_OPENING_BALANCE = 500

describe('statement pipeline on real API data', () => {
  const statement = computeStatementRunningBalance(
    API_STATEMENT_TRANSACTIONS as any,
    API_STATEMENT_PAYMENTS as any,
    SERVER_BALANCE,
  )

  test('the API hands us newest-first, which the helpers depend on', () => {
    // If this ever flips, buildStatementRows and computeStatementOpening both
    // silently invert. Asserting it here makes the dependency explicit.
    const dates = statement.map((e: any) => String(e.date).slice(0, 10))
    const sorted = [...dates].sort().reverse()
    expect(dates).toEqual(sorted)
  })

  test('top row ties to the headline balance', () => {
    expect(statement[0].runningBalance).toBe(SERVER_BALANCE)
  })

  test('the DERIVED opening equals the party\'s stored openingBalance', () => {
    // The cross-check that catches the extraction bug: two independent routes
    // to the same number. The broken copy returned 1500 here.
    const opening = computeStatementOpening(statement as any, SERVER_BALANCE)
    expect(opening).toBe(PARTY_OPENING_BALANCE)
  })

  test('printed rows read oldest-first, and the last row is the closing balance', () => {
    const rows = buildStatementRows(statement as any)
    expect(rows.map(r => r.particulars)).toEqual(['INV-0013', 'INV-0014', 'INV-0015'])
    // Running balance climbs as you read down: 500+1000, +2000, +500.
    expect(rows.map(r => r.balance)).toEqual([1500, 3500, 4000])
    expect(rows[rows.length - 1].balance).toBe(SERVER_BALANCE)
  })

  test('every sale lands in the debit column, none in credit', () => {
    const rows = buildStatementRows(statement as any)
    expect(rows.map(r => r.debit)).toEqual([1000, 2000, 500])
    expect(rows.every(r => r.credit === 0)).toBe(true)
  })

  test('ageing allocates oldest-first (FIFO), not newest-first', () => {
    // Ageing as at 2026-07-26: INV-0013 is 77 days old (61-90 "serious"),
    // INV-0014 is 41 days (31-60 "overdue"), INV-0015 is 6 days ("current").
    // Total allocated is 3500; the remaining 500 is the opening balance, which
    // has no date and is treated as current.
    const now = new Date('2026-07-26T00:00:00Z').getTime()
    const b = computeAgeingBuckets(statement as any, SERVER_BALANCE, now)
    expect(b.serious).toBe(1000)   // oldest bill aged correctly
    expect(b.overdue).toBe(2000)
    expect(b.current).toBe(1000)   // 500 newest + 500 undated opening
    expect(b.current + b.overdue + b.serious + b.critical).toBe(SERVER_BALANCE)
  })
})
