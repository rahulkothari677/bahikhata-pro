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
import { istDateString } from '@/lib/timezone'

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
    // 🔒 TZ FIX (2026-07-21): was `toISOString().slice(0, 10)`, which returns
    // the UTC date. The shop runs in IST (UTC+5:30), so any local time before
    // 05:30 formats as the PREVIOUS day: a range starting 15 Jan 00:00 IST was
    // reported as "2026-01-14". The user then sees a financial summary labelled
    // with a date range that is off by one day — and the label is what they'd
    // quote to their accountant.
    //
    // This is the same defect class as the historical "GSTR month label shows
    // the previous month" bug. istDateString() exists precisely for it, and its
    // own doc-comment warns against this exact mistake.
    range: {
      from: istDateString(from),
      to: istDateString(to),
    },
    count: totalCount,
  }
}
