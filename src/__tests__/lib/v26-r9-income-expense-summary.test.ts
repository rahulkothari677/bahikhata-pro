/**
 * 🔒 R9-3 behavioral test — Income/Expense summary server-side aggregate.
 *
 * Verifies that the server-side summary correctly aggregates over the FULL
 * date range, not just the first 200 rows. The test the auditor asked for:
 * "250 income rows → the summary equals the true sum, not the first-page sum."
 *
 * Approach: set a dummy DATABASE_URL so PrismaClient can be constructed,
 * then use jest.spyOn to mock each db.transaction method to return
 * fixture-derived data. Then call computeIncomeExpenseSummary directly.
 */

process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'
process.env.DIRECT_URL = 'postgresql://dummy:dummy@localhost:5432/dummy'

import { jest } from '@jest/globals'
import { db } from '@/lib/db'
import { computeIncomeExpenseSummary } from '@/lib/income-expense-summary'

// ─── Fixture: 250 income rows + 250 expense rows ──────────────────────────
// All income: ₹100 each → total income = ₹25,000
// All expense: ₹50 each → total expense = ₹12,500
// Net cashflow = ₹12,500
// (The old client-side code with limit=200 would have summed only 200 of each,
//  yielding ₹20,000 / ₹10,000 — a ₹5,000 / ₹2,500 understatement.)
const INCOME_TOTAL = 25000
const EXPENSE_TOTAL = 12500
const INCOME_COUNT = 250
const EXPENSE_COUNT = 250

describe('computeIncomeExpenseSummary [R9-3]', () => {
  beforeEach(() => {
    jest.restoreAllMocks()

    ;(jest.spyOn(db.transaction, 'aggregate') as unknown as jest.Mock).mockImplementation((args: any) => {
      if (args.where.type === 'income') {
        return Promise.resolve({ _sum: { totalAmount: INCOME_TOTAL }, _count: INCOME_COUNT })
      }
      if (args.where.type === 'expense') {
        return Promise.resolve({ _sum: { totalAmount: EXPENSE_TOTAL }, _count: EXPENSE_COUNT })
      }
      return Promise.resolve({ _sum: { totalAmount: 0 }, _count: 0 })
    })

    ;(jest.spyOn(db.transaction, 'groupBy') as unknown as jest.Mock).mockImplementation((args: any) => {
      if (args.where.type === 'income') {
        return Promise.resolve([
          { category: 'Commission', _sum: { totalAmount: 15000 }, _count: 150 },
          { category: 'Interest', _sum: { totalAmount: 10000 }, _count: 100 },
        ])
      }
      if (args.where.type === 'expense') {
        return Promise.resolve([
          { category: 'Rent', _sum: { totalAmount: 5000 }, _count: 1 },
          { category: 'Salary', _sum: { totalAmount: 7500 }, _count: 249 },
        ])
      }
      return Promise.resolve([])
    })

    const countSpy = jest.spyOn(db.transaction, 'count') as any
    countSpy.mockResolvedValue(INCOME_COUNT + EXPENSE_COUNT)
  })

  test('returns the FULL aggregate, not the first-200-row sum', async () => {
    const from = new Date('2026-01-01T00:00:00')
    const to = new Date('2026-12-31T23:59:59')
    const result = await computeIncomeExpenseSummary('user1', from, to, false)
    // 🔒 R9-3: the OLD code returned 200*100=20,000 for income. The new endpoint
    // returns the true 25,000 because it uses SQL SUM over the whole range.
    expect(result.totalIncome).toBe(INCOME_TOTAL)
    expect(result.totalExpense).toBe(EXPENSE_TOTAL)
    expect(result.netCashflow).toBe(INCOME_TOTAL - EXPENSE_TOTAL)
    expect(result.count).toBe(INCOME_COUNT + EXPENSE_COUNT)
  })

  test('byCategory breakdown sums to the headline total', async () => {
    const from = new Date('2026-01-01T00:00:00')
    const to = new Date('2026-12-31T23:59:59')
    const result = await computeIncomeExpenseSummary('user1', from, to, false)
    const incomeCatSum = result.byCategory.income.reduce((s, c) => s + c.total, 0)
    const expenseCatSum = result.byCategory.expense.reduce((s, c) => s + c.total, 0)
    expect(incomeCatSum).toBe(INCOME_TOTAL)
    expect(expenseCatSum).toBe(EXPENSE_TOTAL)
  })

  test('range echoes the input dates as YYYY-MM-DD (IST)', async () => {
    // 🔒 TZ FIX: Use explicit +05:30 offsets so the test is timezone-independent.
    // Was: new Date('2026-01-15T00:00:00') parsed as local time → in UTC it's
    // fine, but istDateString() converts to IST → can shift the date.
    const from = new Date('2026-01-15T00:00:00+05:30')
    const to = new Date('2026-01-31T23:59:59+05:30')
    const result = await computeIncomeExpenseSummary('user1', from, to, false)
    expect(result.range.from).toBe('2026-01-15')
    expect(result.range.to).toBe('2026-01-31')
  })

  test('zeroes totals when hideProfit is true (staff role)', async () => {
    const from = new Date('2026-01-01T00:00:00')
    const to = new Date('2026-12-31T23:59:59')
    const result = await computeIncomeExpenseSummary('user1', from, to, true)
    expect(result.totalIncome).toBe(0)
    expect(result.totalExpense).toBe(0)
    expect(result.netCashflow).toBe(0)
    expect(result.byCategory.income).toEqual([])
    expect(result.byCategory.expense).toEqual([])
    // Count is still returned (it reveals volume, not money).
    expect(result.count).toBe(INCOME_COUNT + EXPENSE_COUNT)
  })

  test('uses "Other" when category is null', async () => {
    ;(jest.spyOn(db.transaction, 'groupBy') as unknown as jest.Mock).mockImplementation((args: any) => {
      if (args.where.type === 'expense') {
        return Promise.resolve([
          { category: null, _sum: { totalAmount: 5000 }, _count: 5 },
        ])
      }
      return Promise.resolve([])
    })
    const from = new Date('2026-01-01T00:00:00')
    const to = new Date('2026-12-31T23:59:59')
    const result = await computeIncomeExpenseSummary('user1', from, to, false)
    expect(result.byCategory.expense[0].category).toBe('Other')
  })

  test('empty range returns zeros, not errors', async () => {
    const aggSpy = jest.spyOn(db.transaction, 'aggregate') as any
    const groupSpy = jest.spyOn(db.transaction, 'groupBy') as any
    const cntSpy = jest.spyOn(db.transaction, 'count') as any
    aggSpy.mockResolvedValue({ _sum: { totalAmount: null }, _count: 0 })
    groupSpy.mockResolvedValue([])
    cntSpy.mockResolvedValue(0)
    const from = new Date('2026-01-01T00:00:00')
    const to = new Date('2026-01-02T23:59:59')
    const result = await computeIncomeExpenseSummary('user1', from, to, false)
    expect(result.totalIncome).toBe(0)
    expect(result.totalExpense).toBe(0)
    expect(result.netCashflow).toBe(0)
    expect(result.byCategory.income).toEqual([])
    expect(result.byCategory.expense).toEqual([])
    expect(result.count).toBe(0)
  })

  test('passes date range + userId filter to all 5 queries (no cross-user leak)', async () => {
    const from = new Date('2026-03-01T00:00:00')
    const to = new Date('2026-03-31T23:59:59')
    const userId = 'user-special-id'
    await computeIncomeExpenseSummary(userId, from, to, false)

    const aggregateSpy = jest.spyOn(db.transaction, 'aggregate') as jest.Mock
    const groupBySpy = jest.spyOn(db.transaction, 'groupBy') as jest.Mock
    const countSpy = jest.spyOn(db.transaction, 'count') as jest.Mock

    // Both aggregate calls, both groupBy calls, and the count call should
    // receive the same date + userId filter.
    for (const call of [...aggregateSpy.mock.calls, ...groupBySpy.mock.calls, ...countSpy.mock.calls]) {
      const args: any = call[0]
      expect(args.where.userId).toBe(userId)
      expect(args.where.date.gte).toEqual(from)
      expect(args.where.date.lte).toEqual(to)
    }
    expect(aggregateSpy.mock.calls.length).toBe(2)
    expect(groupBySpy.mock.calls.length).toBe(2)
    expect(countSpy.mock.calls.length).toBe(1)
  })
})
