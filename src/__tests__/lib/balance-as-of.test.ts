/**
 * 🔒 V17 Audit Phase 8 — Balance As Of Any Date tests.
 *
 * Tests the computeBalanceAsOf() function with realistic data.
 * Pure-function tests — no DB, no network.
 *
 * Key invariants:
 *   1. Date boundary: transactions ON the asOfDate are INCLUDED (inclusive)
 *   2. Soft-deleted transactions are excluded
 *   3. Credit notes reduce receivable
 *   4. Debit notes reduce payable
 *   5. Payments reduce outstanding
 *   6. Opening balance is always included (it's a starting point)
 *   7. Formula matches computePartyBalance() (same sign conventions)
 */

import {
  computeBalanceAsOf,
  type BalanceAsOfTransaction,
  type BalanceAsOfPayment,
} from '@/lib/balance-as-of'
import { roundMoney } from '@/lib/money'

// ─── Fixtures ─────────────────────────────────────────────────────────────

const OPENING_BALANCE = 1000

const TRANSACTIONS: BalanceAsOfTransaction[] = [
  // June 15: Sale ₹5,000 (paid ₹2,000) → outstanding ₹3,000
  { type: 'sale', date: new Date('2026-06-15'), totalAmount: 5000, paidAmount: 2000, deletedAt: null },
  // June 20: Purchase ₹2,000 (paid ₹2,000) → outstanding ₹0
  { type: 'purchase', date: new Date('2026-06-20'), totalAmount: 2000, paidAmount: 2000, deletedAt: null },
  // June 25: Credit note ₹1,000 (paid ₹0) → reduces receivable by ₹1,000
  { type: 'credit-note', date: new Date('2026-06-25'), totalAmount: 1000, paidAmount: 0, deletedAt: null },
  // July 5: Sale ₹3,000 (paid ₹0) → outstanding ₹3,000 (AFTER June 30, should NOT be included)
  { type: 'sale', date: new Date('2026-07-05'), totalAmount: 3000, paidAmount: 0, deletedAt: null },
  // Soft-deleted sale (should be excluded)
  { type: 'sale', date: new Date('2026-06-10'), totalAmount: 99999, paidAmount: 0, deletedAt: new Date() },
]

const PAYMENTS: BalanceAsOfPayment[] = [
  // June 18: Received ₹1,000 (customer paid us)
  { type: 'received', date: new Date('2026-06-18'), amount: 1000, deletedAt: null },
  // June 28: Paid ₹500 (we paid supplier)
  { type: 'paid', date: new Date('2026-06-28'), amount: 500, deletedAt: null },
  // July 3: Received ₹2,000 (AFTER June 30, should NOT be included)
  { type: 'received', date: new Date('2026-07-03'), amount: 2000, deletedAt: null },
  // Soft-deleted payment (should be excluded)
  { type: 'received', date: new Date('2026-06-12'), amount: 99999, deletedAt: new Date() },
]

const AS_OF_JUNE_30 = new Date('2026-06-30T23:59:59.999Z')
const AS_OF_JULY_31 = new Date('2026-07-31T23:59:59.999Z')

// ─── Tests ────────────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 8 — Balance As Of Any Date', () => {

  describe('Date boundary (inclusive)', () => {
    test('transactions ON the asOfDate are included', () => {
      const txns: BalanceAsOfTransaction[] = [
        { type: 'sale', date: new Date('2026-06-30T12:00:00Z'), totalAmount: 1000, paidAmount: 0, deletedAt: null },
      ]
      const result = computeBalanceAsOf(0, txns, [], AS_OF_JUNE_30)
      expect(result.balance).toBe(1000)  // sale outstanding = 1000
      expect(result.saleCount).toBe(1)
    })

    test('transactions AFTER the asOfDate are excluded', () => {
      const txns: BalanceAsOfTransaction[] = [
        { type: 'sale', date: new Date('2026-07-01T00:00:01Z'), totalAmount: 1000, paidAmount: 0, deletedAt: null },
      ]
      const result = computeBalanceAsOf(0, txns, [], AS_OF_JUNE_30)
      expect(result.balance).toBe(0)
      expect(result.saleCount).toBe(0)
    })

    test('payments AFTER the asOfDate are excluded', () => {
      const payments: BalanceAsOfPayment[] = [
        { type: 'received', date: new Date('2026-07-01T00:00:01Z'), amount: 500, deletedAt: null },
      ]
      const result = computeBalanceAsOf(0, [], payments, AS_OF_JUNE_30)
      expect(result.balance).toBe(0)
      expect(result.paymentCount).toBe(0)
    })
  })

  describe('Balance computation (June 30)', () => {
    const result = computeBalanceAsOf(OPENING_BALANCE, TRANSACTIONS, PAYMENTS, AS_OF_JUNE_30)

    test('opening balance is included', () => {
      expect(result.openingBalance).toBe(1000)
    })

    test('sale outstanding = ₹5,000 - ₹2,000 = ₹3,000', () => {
      expect(result.salesOutstanding).toBe(3000)
    })

    test('purchase outstanding = ₹2,000 - ₹2,000 = ₹0', () => {
      expect(result.purchaseOutstanding).toBe(0)
    })

    test('credit note outstanding = ₹1,000 - ₹0 = ₹1,000', () => {
      expect(result.creditNoteOutstanding).toBe(1000)
    })

    test('payments received = ₹1,000', () => {
      expect(result.paymentsReceived).toBe(1000)
    })

    test('payments paid = ₹500', () => {
      expect(result.paymentsPaid).toBe(500)
    })

    test('balance = 1000 + 3000 - 0 - 1000 + 0 - 1000 + 500 = 2500', () => {
      // openingBalance(1000) + salesOut(3000) - purchaseOut(0) - cnOut(1000) + dnOut(0)
      // - paymentsReceived(1000) + paymentsPaid(500)
      // = 1000 + 3000 - 0 - 1000 + 0 - 1000 + 500 = 2500
      expect(result.balance).toBe(2500)
    })

    test('July transactions are excluded', () => {
      expect(result.saleCount).toBe(1)  // only the June 15 sale
      expect(result.paymentCount).toBe(2)  // June 18 received + June 28 paid
    })

    test('soft-deleted transactions are excluded', () => {
      // The soft-deleted sale of ₹99,999 is NOT included
      expect(result.balance).toBeLessThan(99999)
    })
  })

  describe('Balance computation (July 31 — includes everything)', () => {
    const result = computeBalanceAsOf(OPENING_BALANCE, TRANSACTIONS, PAYMENTS, AS_OF_JULY_31)

    test('includes the July 5 sale (₹3,000 outstanding)', () => {
      // salesOutstanding = (5000-2000) + (3000-0) = 6000
      expect(result.salesOutstanding).toBe(6000)
      expect(result.saleCount).toBe(2)
    })

    test('includes the July 3 payment received (₹2,000)', () => {
      // paymentsReceived = 1000 + 2000 = 3000
      expect(result.paymentsReceived).toBe(3000)
      expect(result.paymentCount).toBe(3)
    })

    test('balance = 1000 + 6000 - 0 - 1000 + 0 - 3000 + 500 = 3500', () => {
      expect(result.balance).toBe(3500)
    })
  })

  describe('Credit notes + debit notes', () => {
    test('credit notes reduce receivable', () => {
      const txns: BalanceAsOfTransaction[] = [
        { type: 'sale', date: new Date('2026-06-10'), totalAmount: 5000, paidAmount: 0, deletedAt: null },
        { type: 'credit-note', date: new Date('2026-06-15'), totalAmount: 1000, paidAmount: 0, deletedAt: null },
      ]
      const result = computeBalanceAsOf(0, txns, [], AS_OF_JUNE_30)
      // balance = 0 + 5000 - 0 - 1000 + 0 = 4000
      expect(result.balance).toBe(4000)
      expect(result.balance).not.toBe(6000)  // NOT inflated (sale + CN added)
    })

    test('debit notes reduce payable', () => {
      const txns: BalanceAsOfTransaction[] = [
        { type: 'purchase', date: new Date('2026-06-10'), totalAmount: 5000, paidAmount: 0, deletedAt: null },
        { type: 'debit-note', date: new Date('2026-06-15'), totalAmount: 1000, paidAmount: 0, deletedAt: null },
      ]
      const result = computeBalanceAsOf(0, txns, [], AS_OF_JUNE_30)
      // balance = 0 + 0 - 5000 - 0 + 1000 = -4000 (we owe ₹4,000)
      expect(result.balance).toBe(-4000)
    })
  })

  describe('Edge cases', () => {
    test('no transactions + no payments → balance = opening balance', () => {
      const result = computeBalanceAsOf(500, [], [], AS_OF_JUNE_30)
      expect(result.balance).toBe(500)
      expect(result.saleCount).toBe(0)
      expect(result.paymentCount).toBe(0)
    })

    test('zero opening balance → balance depends only on transactions', () => {
      const txns: BalanceAsOfTransaction[] = [
        { type: 'sale', date: new Date('2026-06-15'), totalAmount: 2000, paidAmount: 500, deletedAt: null },
      ]
      const result = computeBalanceAsOf(0, txns, [], AS_OF_JUNE_30)
      expect(result.balance).toBe(1500)  // 2000 - 500 = 1500 outstanding
    })

    test('all transactions after asOfDate → balance = opening balance only', () => {
      const txns: BalanceAsOfTransaction[] = [
        { type: 'sale', date: new Date('2026-07-15'), totalAmount: 5000, paidAmount: 0, deletedAt: null },
      ]
      const result = computeBalanceAsOf(1000, txns, [], AS_OF_JUNE_30)
      expect(result.balance).toBe(1000)  // only opening balance
    })

    test('null/undefined transactions handled gracefully', () => {
      const result = computeBalanceAsOf(1000, null as any, null as any, AS_OF_JUNE_30)
      expect(result.balance).toBe(1000)
    })

    test('empty arrays handled', () => {
      const result = computeBalanceAsOf(1000, [], [], AS_OF_JUNE_30)
      expect(result.balance).toBe(1000)
    })

    test('float precision (₹0.01 edges)', () => {
      const txns: BalanceAsOfTransaction[] = [
        { type: 'sale', date: new Date('2026-06-15'), totalAmount: 100.01, paidAmount: 33.33, deletedAt: null },
      ]
      const result = computeBalanceAsOf(0, txns, [], AS_OF_JUNE_30)
      // outstanding = 100.01 - 33.33 = 66.68
      expect(result.balance).toBe(66.68)
    })
  })

  describe('Consistency with computePartyBalance (same formula)', () => {
    test('asOfDate = future → same result as current balance', () => {
      // If asOfDate is in the future, ALL transactions are included → same as current balance
      const future = new Date('2099-12-31T23:59:59.999Z')
      const result = computeBalanceAsOf(OPENING_BALANCE, TRANSACTIONS, PAYMENTS, future)

      // This should match what computePartyBalance() would return:
      // openingBalance(1000) + salesOut(6000) - purchaseOut(0) - cnOut(1000) + dnOut(0)
      // - paymentsReceived(3000) + paymentsPaid(500) = 3500
      expect(result.balance).toBe(3500)
    })
  })
})
