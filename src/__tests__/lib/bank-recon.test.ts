/**
 * 🔒 V17 Audit Phase 6 — Bank Reconciliation tests.
 *
 * Tests CSV parsing, auto-match algorithm, and edge cases.
 * Pure-function tests — no DB, no network.
 */

import {
  parseBankCsv,
  autoMatch,
  type MatchablePayment,
  type MatchableTransaction,
} from '@/lib/bank-recon'
import { roundMoney } from '@/lib/money'

// ─── CSV Parser Tests ─────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 6 — Bank CSV parser', () => {
  test('parses standard HDFC-style CSV (Date, Description, Amount)', () => {
    const csv = `Date,Description,Amount
01/07/2026,UPI/Rahul Traders/1234,500.00
02/07/2026,ATM Withdrawal,-2000.00
03/07/2026,Salary Credit,15000.00`
    const result = parseBankCsv(csv, 'HDFC')
    expect(result.transactions).toHaveLength(3)
    expect(result.transactions[0].amount).toBe(500)
    expect(result.transactions[1].amount).toBe(-2000)
    expect(result.transactions[2].amount).toBe(15000)
    expect(result.totalCredits).toBe(15500)
    expect(result.totalDebits).toBe(2000)
    expect(result.bankName).toBe('HDFC')
  })

  test('parses separate Credit/Debit columns', () => {
    const csv = `Date,Description,Credit,Debit
01/07/2026,UPI Payment,500.00,
02/07/2026,ATM,,2000.00`
    const result = parseBankCsv(csv, 'SBI')
    // First row: credit 500, debit empty → amount = 500 - 0 = 500
    // Second row: credit empty, debit 2000 → amount = 0 - 2000 = -2000
    // Both should be parsed (parseAmount('') = 0, not skipped since amount ≠ 0)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0].amount).toBe(500)   // credit = positive
    expect(result.transactions[1].amount).toBe(-2000)  // debit = negative
  })

  test('handles ₹ symbol and commas in amounts', () => {
    const csv = `Date,Description,Amount
01/07/2026,Large Payment,"₹1,50,000.00"`
    const result = parseBankCsv(csv, 'ICICI')
    expect(result.transactions[0].amount).toBe(150000)
  })

  test('handles yyyy-mm-dd date format', () => {
    const csv = `Date,Description,Amount
2026-07-01,Test Payment,500.00`
    const result = parseBankCsv(csv, 'Axis')
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].date.getFullYear()).toBe(2026)
    expect(result.transactions[0].date.getMonth()).toBe(6)  // July (0-indexed)
  })

  test('skips header/footer rows that are not transactions', () => {
    // Lines without a valid date (like "Statement Period") are skipped by parseDate
    const csv = `Statement Period Jul 2026
Date,Description,Amount
01/07/2026,Real Transaction,500.00`
    const result = parseBankCsv(csv, 'SBI')
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].amount).toBe(500)
  })

  test('empty CSV returns empty result', () => {
    const result = parseBankCsv('', 'Test')
    expect(result.transactions).toHaveLength(0)
    expect(result.totalCredits).toBe(0)
    expect(result.totalDebits).toBe(0)
  })

  test('CSV with only headers returns empty result', () => {
    const csv = `Date,Description,Amount`
    const result = parseBankCsv(csv, 'Test')
    expect(result.transactions).toHaveLength(0)
  })

  test('null/undefined input returns empty result', () => {
    const result = parseBankCsv(null as any, 'Test')
    expect(result.transactions).toHaveLength(0)
  })

  test('handles negative amounts in parentheses (accounting format)', () => {
    const csv = `Date,Description,Amount
01/07/2026,ATM Withdrawal,(2000.00)`
    const result = parseBankCsv(csv, 'HDFC')
    expect(result.transactions[0].amount).toBe(-2000)
  })
})

// ─── Auto-Match Tests ─────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 6 — Auto-match algorithm', () => {
  const basePayments: MatchablePayment[] = [
    { id: 'p1', amount: 500, date: new Date('2026-07-01'), type: 'received', mode: 'upi', partyName: 'Rahul' },
    { id: 'p2', amount: 2000, date: new Date('2026-07-02'), type: 'paid', mode: 'bank', partyName: 'Supplier' },
  ]

  const baseTxns: MatchableTransaction[] = [
    { id: 't1', type: 'sale', totalAmount: 1180, paidAmount: 1180, paymentMode: 'upi', date: new Date('2026-07-03'), partyName: 'Priya', invoiceNo: 'INV-001' },
  ]

  test('EXACT match: amount ±₹0.01 AND date ±2 days', () => {
    const bankTxns = [
      { date: new Date('2026-07-01'), description: 'UPI/Rahul', amount: 500 },
    ]
    const results = autoMatch(bankTxns, basePayments, baseTxns)
    expect(results[0].matchType).toBe('exact')
    expect(results[0].confidence).toBe(1.0)
    expect(results[0].matchedPaymentId).toBe('p1')
  })

  test('FUZZY match: amount ±₹5 AND date ±5 days', () => {
    const bankTxns = [
      { date: new Date('2026-07-04'), description: 'UPI/Rahul', amount: 498 },  // ₹2 off, 3 days later
    ]
    const results = autoMatch(bankTxns, basePayments, baseTxns)
    expect(results[0].matchType).toBe('fuzzy')
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.4)
    expect(results[0].confidence).toBeLessThan(1.0)
    expect(results[0].matchedPaymentId).toBe('p1')
  })

  test('PARTIAL match: amount ±20% AND date ±7 days', () => {
    const bankTxns = [
      { date: new Date('2026-07-06'), description: 'UPI/Rahul', amount: 450 },  // 10% off, 5 days later
    ]
    const results = autoMatch(bankTxns, basePayments, baseTxns)
    expect(results[0].matchType).toBe('partial')
    expect(results[0].confidence).toBeGreaterThan(0)
    expect(results[0].confidence).toBeLessThan(0.7)
    expect(results[0].matchedPaymentId).toBe('p1')
  })

  test('NO match: amount too far off', () => {
    const bankTxns = [
      { date: new Date('2026-07-01'), description: 'Random', amount: 9999 },
    ]
    const results = autoMatch(bankTxns, basePayments, baseTxns)
    expect(results[0].matchType).toBe('none')
    expect(results[0].matchedPaymentId).toBeUndefined()
  })

  test('credit bank txn matches received payment (not paid)', () => {
    const bankTxns = [
      { date: new Date('2026-07-01'), description: 'Credit', amount: 500 },  // positive = credit
    ]
    const results = autoMatch(bankTxns, basePayments, baseTxns)
    expect(results[0].matchedPaymentId).toBe('p1')  // p1 = received (₹500)
    expect(results[0].matchedPaymentId).not.toBe('p2')  // p2 = paid (should not match credit)
  })

  test('debit bank txn matches paid payment (not received)', () => {
    const bankTxns = [
      { date: new Date('2026-07-02'), description: 'Debit', amount: -2000 },  // negative = debit
    ]
    const results = autoMatch(bankTxns, basePayments, baseTxns)
    expect(results[0].matchedPaymentId).toBe('p2')  // p2 = paid (₹2000)
    expect(results[0].matchedPaymentId).not.toBe('p1')
  })

  test('excludes cash payments from matching', () => {
    const cashPayment: MatchablePayment[] = [
      { id: 'cash1', amount: 500, date: new Date('2026-07-01'), type: 'received', mode: 'cash', partyName: 'Walk-in' },
    ]
    const bankTxns = [
      { date: new Date('2026-07-01'), description: 'UPI', amount: 500 },
    ]
    const results = autoMatch(bankTxns, cashPayment, [])
    expect(results[0].matchType).toBe('none')  // cash payment can't match bank txn
  })

  test('1:1 matching — a payment is only matched once', () => {
    const bankTxns = [
      { date: new Date('2026-07-01'), description: 'First', amount: 500 },
      { date: new Date('2026-07-01'), description: 'Second', amount: 500 },
    ]
    // Only 1 payment of ₹500 — the second bank txn should NOT match it again
    const singlePayment: MatchablePayment[] = [
      { id: 'p1', amount: 500, date: new Date('2026-07-01'), type: 'received', mode: 'upi', partyName: 'Rahul' },
    ]
    const results = autoMatch(bankTxns, singlePayment, [])
    expect(results[0].matchType).toBe('exact')  // first match
    expect(results[1].matchType).toBe('none')   // second should NOT match (already used)
  })

  test('empty bank txns returns empty results', () => {
    const results = autoMatch([], basePayments, baseTxns)
    expect(results).toHaveLength(0)
  })

  test('empty payments + transactions → all bank txns unmatched', () => {
    const bankTxns = [
      { date: new Date('2026-07-01'), description: 'Test', amount: 500 },
    ]
    const results = autoMatch(bankTxns, [], [])
    expect(results).toHaveLength(1)
    expect(results[0].matchType).toBe('none')
  })

  test('matches against transactions (sale with UPI payment)', () => {
    const bankTxns = [
      { date: new Date('2026-07-03'), description: 'UPI Payment', amount: 1180 },
    ]
    // No payments, but a sale with UPI paymentMode + paidAmount = 1180
    const results = autoMatch(bankTxns, [], baseTxns)
    expect(results[0].matchType).toBe('exact')
    expect(results[0].matchedTransactionId).toBe('t1')
    expect(results[0].matchedDescription).toContain('INV-001')
  })

  test('total credits + debits computed correctly from parsed CSV', () => {
    const csv = `Date,Description,Amount
01/07/2026,Credit 1,1000.00
02/07/2026,Debit 1,-500.00
03/07/2026,Credit 2,2000.00
04/07/2026,Debit 2,-300.00`
    const result = parseBankCsv(csv, 'Test')
    expect(result.totalCredits).toBe(3000)
    expect(result.totalDebits).toBe(800)
  })
})
