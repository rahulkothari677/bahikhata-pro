/**
 * 🔒 Phase 7b — Behavioral tests for statement helpers.
 *
 * buildStatementRows, buildStatementClosing, computeStatementOpening,
 * and computeAgeingBuckets were closures inside PartyProfile.tsx with
 * zero tests. They compute the statement rows, closing balance label,
 * opening balance, and ageing breakdown that appear on the PDF the
 * customer receives.
 */

import {
  buildStatementRows,
  buildStatementClosing,
  computeStatementOpening,
  computeAgeingBuckets,
  type StatementEntry,
} from '@/lib/statement-rows'

const now = new Date('2026-07-24T12:00:00Z').getTime()

const fixture: StatementEntry[] = [
  { date: '2026-07-01', delta: 1000, runningBalance: 1000, invoiceNo: 'INV-001' },
  { date: '2026-07-05', delta: -500, runningBalance: 500, isPayment: true, type: 'payment-received' },
  { date: '2026-07-10', delta: 2000, runningBalance: 2500, invoiceNo: 'INV-002' },
  { date: '2026-07-15', delta: -1000, runningBalance: 1500, isPayment: true, type: 'payment-received' },
  { date: '2026-07-20', delta: 500, runningBalance: 2000, invoiceNo: 'INV-003' },
]

describe('🔒 Phase 7b — buildStatementRows', () => {

  test('maps entries to rows with correct debit/credit split', () => {
    const rows = buildStatementRows(fixture)
    expect(rows).toHaveLength(5)

    // Sale: delta=+1000 → debit 1000, credit 0
    expect(rows[0].debit).toBe(1000)
    expect(rows[0].credit).toBe(0)
    expect(rows[0].particulars).toBe('INV-001')

    // Payment: delta=-500 → debit 0, credit 500
    expect(rows[1].debit).toBe(0)
    expect(rows[1].credit).toBe(500)
    expect(rows[1].particulars).toBe('Payment received')
  })

  test('running balance is preserved in each row', () => {
    const rows = buildStatementRows(fixture)
    expect(rows[0].balance).toBe(1000)
    expect(rows[1].balance).toBe(500)
    expect(rows[4].balance).toBe(2000)
  })

  test('index is 1-based', () => {
    const rows = buildStatementRows(fixture)
    expect(rows[0].index).toBe(1)
    expect(rows[4].index).toBe(5)
  })

  test('empty statement returns empty array', () => {
    expect(buildStatementRows([])).toEqual([])
  })
})

describe('🔒 Phase 7b — buildStatementClosing', () => {

  test('positive balance for customer → "They owe you"', () => {
    const c = buildStatementClosing(2000, 'customer', 5, 5)
    expect(c.closing).toBe(2000)
    expect(c.label).toBe('They owe you')
    expect(c.truncated).toBe(false)
  })

  test('positive balance for supplier → "Advance paid (they owe you)"', () => {
    const c = buildStatementClosing(500, 'supplier', 3, 3)
    expect(c.label).toBe('Advance paid (they owe you)')
  })

  test('negative balance → "You owe them"', () => {
    const c = buildStatementClosing(-1500, 'customer', 3, 3)
    expect(c.label).toBe('You owe them')
  })

  test('zero balance → "Settled"', () => {
    const c = buildStatementClosing(0, 'customer', 3, 3)
    expect(c.label).toBe('Settled')
  })

  test('truncation detected when trueCount > statementLength', () => {
    const c = buildStatementClosing(2000, 'customer', 600, 500)
    expect(c.truncated).toBe(true)
    expect(c.trueCount).toBe(600)
  })
})

describe('🔒 Phase 7b — computeStatementOpening', () => {

  test('opening = oldest.runningBalance - oldest.delta', () => {
    // oldest: runningBalance=1000, delta=1000 → opening=0
    const opening = computeStatementOpening(fixture, 2000)
    expect(opening).toBe(0)
  })

  test('empty statement falls back to statsBalance', () => {
    expect(computeStatementOpening([], 2000)).toBe(2000)
  })

  test('statement with only payments: opening computed correctly', () => {
    const paymentsOnly: StatementEntry[] = [
      { date: '2026-07-01', delta: -500, runningBalance: 500, isPayment: true, type: 'payment-received' },
    ]
    // opening = 500 - (-500) = 1000
    expect(computeStatementOpening(paymentsOnly, 500)).toBe(1000)
  })
})

describe('🔒 Phase 7b — computeAgeingBuckets', () => {

  test('all entries within 30 days → all in current bucket', () => {
    const recent: StatementEntry[] = [
      { date: '2026-07-20', delta: 1000, runningBalance: 1000, invoiceNo: 'INV-001' },
    ]
    const buckets = computeAgeingBuckets(recent, 1000, now)
    expect(buckets.current).toBe(1000)
    expect(buckets.overdue).toBe(0)
    expect(buckets.serious).toBe(0)
    expect(buckets.critical).toBe(0)
  })

  test('entry 45 days old → overdue bucket', () => {
    const old: StatementEntry[] = [
      { date: '2026-06-09', delta: 2000, runningBalance: 2000, invoiceNo: 'INV-001' },
    ]
    const buckets = computeAgeingBuckets(old, 2000, now)
    expect(buckets.overdue).toBe(2000)
    expect(buckets.current).toBe(0)
  })

  test('entry 75 days old → serious bucket', () => {
    const old: StatementEntry[] = [
      { date: '2026-05-10', delta: 1500, runningBalance: 1500, invoiceNo: 'INV-001' },
    ]
    const buckets = computeAgeingBuckets(old, 1500, now)
    expect(buckets.serious).toBe(1500)
  })

  test('entry 120 days old → critical bucket', () => {
    const old: StatementEntry[] = [
      { date: '2026-03-26', delta: 3000, runningBalance: 3000, invoiceNo: 'INV-001' },
    ]
    const buckets = computeAgeingBuckets(old, 3000, now)
    expect(buckets.critical).toBe(3000)
  })

  test('payments are skipped (do not contribute to ageing)', () => {
    const withPayment: StatementEntry[] = [
      { date: '2026-07-01', delta: 1000, runningBalance: 1000, invoiceNo: 'INV-001' },
      { date: '2026-07-05', delta: -500, runningBalance: 500, isPayment: true, type: 'payment-received' },
    ]
    // Closing = 500. Only the sale (1000) contributes, capped at 500.
    const buckets = computeAgeingBuckets(withPayment, 500, now)
    expect(buckets.current).toBe(500) // 1000 capped at closing 500
  })

  test('buckets sum to closing balance', () => {
    const mixed: StatementEntry[] = [
      { date: '2026-07-20', delta: 500, runningBalance: 500, invoiceNo: 'INV-001' },
      { date: '2026-06-01', delta: 1000, runningBalance: 1500, invoiceNo: 'INV-002' },
      { date: '2026-04-01', delta: 2000, runningBalance: 3500, invoiceNo: 'INV-003' },
    ]
    const closing = 3500
    const buckets = computeAgeingBuckets(mixed, closing, now)
    const sum = buckets.current + buckets.overdue + buckets.serious + buckets.critical
    expect(Math.round(sum * 100) / 100).toBe(closing)
  })

  test('zero balance → all buckets zero', () => {
    const buckets = computeAgeingBuckets(fixture, 0, now)
    expect(buckets.current).toBe(0)
    expect(buckets.overdue).toBe(0)
    expect(buckets.serious).toBe(0)
    expect(buckets.critical).toBe(0)
  })

  test('leftover (opening balance) goes to current', () => {
    // Closing = 5000, but only 3000 in sale entries → 2000 leftover
    const withGap: StatementEntry[] = [
      { date: '2026-07-20', delta: 3000, runningBalance: 5000, invoiceNo: 'INV-001' },
    ]
    const buckets = computeAgeingBuckets(withGap, 5000, now)
    expect(buckets.current).toBe(5000) // 3000 from entry + 2000 leftover
  })
})
