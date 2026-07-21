/**
 * computeIncomeExpenseSummary — server-side SQL aggregate of income + expense
 * totals over an explicit date range.
 *
 * Extracted from /api/income-expense/summary/route.ts so it can be unit-tested
 * without loading next-auth (which is ESM-only and breaks jest's CJS resolver).
 *
 * 🔒 R9-3 fix: replaces the client-side `?type=all&limit=200` fetch + JS reduce
 * that silently understated totals for shops with >200 transactions of any
 * type. A busy shop fills the 200-row window in ~10 days, dropping last
 * month's rent from "Total Expense". This function uses SQL SUM over the
 * FULL date range — always correct, regardless of volume.
 *
 * Returns all money values in RUPEES (the money extension converts paise →
 * rupees on read via Prisma's aggregate / groupBy).
 */
import { db, withConnectionRetry } from '@/lib/db'

export interface IncomeExpenseSummary {
  totalIncome: number
  totalExpense: number
  netCashflow: number
  byCategory: {
    income: Array<{ category: string; total: number; count: number }>
    expense: Array<{ category: string; total: number; count: number }>
  }
  range: { from: string; to: string }
  count: number
}

export async function computeIncomeExpenseSummary(
  userId: string,
  from: Date,
  to: Date,
  hideProfit: boolean
): Promise<IncomeExpenseSummary> {
  // Run all aggregates in parallel inside the connection-retry wrapper.
  // (Neon cold-start safety — the first query after idle can fail.)
  const [incomeAgg, expenseAgg, incomeByCat, expenseByCat, totalCount] = await withConnectionRetry(() =>
    Promise.all([
      db.transaction.aggregate({
        where: {
          userId,
          type: 'income',
          deletedAt: null,
          date: { gte: from, lte: to },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: {
          userId,
          type: 'expense',
          deletedAt: null,
          date: { gte: from, lte: to },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      db.transaction.groupBy({
        by: ['category'],
        where: {
          userId,
          type: 'income',
          deletedAt: null,
          date: { gte: from, lte: to },
        },
        _sum: { totalAmount: true },
        _count: true,
        orderBy: { _sum: { totalAmount: 'desc' } },
      }),
      db.transaction.groupBy({
        by: ['category'],
        where: {
          userId,
          type: 'expense',
          deletedAt: null,
          date: { gte: from, lte: to },
        },
        _sum: { totalAmount: true },
        _count: true,
        orderBy: { _sum: { totalAmount: 'desc' } },
      }),
      db.transaction.count({
        where: {
          userId,
          OR: [{ type: 'income' }, { type: 'expense' }],
          deletedAt: null,
          date: { gte: from, lte: to },
        },
      }),
    ])
  )

  // Profit visibility: zero out totals if the user's role hides profit.
  // Per-category breakdowns are also zeroed (they reveal the same data).
  const totalIncome = hideProfit ? 0 : (incomeAgg._sum.totalAmount ?? 0)
  const totalExpense = hideProfit ? 0 : (expenseAgg._sum.totalAmount ?? 0)
  const incomeCats = hideProfit
    ? []
    : incomeByCat.map((r) => ({
        category: r.category || 'Other',
        total: r._sum.totalAmount ?? 0,
        count: r._count,
      }))
  const expenseCats = hideProfit
    ? []
    : expenseByCat.map((r) => ({
        category: r.category || 'Other',
        total: r._sum.totalAmount ?? 0,
        count: r._count,
      }))

  return {
    totalIncome,
    totalExpense,
    netCashflow: totalIncome - totalExpense,
    byCategory: { income: incomeCats, expense: expenseCats },
    range: {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    },
    count: totalCount,
  }
}
