import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { computeIncomeExpenseSummary } from '@/lib/income-expense-summary'

/**
 * GET /api/income-expense/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 🔒 R9-3 fix: Server-side SQL aggregate of income + expense totals over an
 * explicit date range. Replaces the client-side `?type=all&limit=200` fetch +
 * JS reduce that silently understated totals for shops with >200 transactions
 * of any type (a busy shop fills the 200-row window in ~10 days, dropping
 * last month's rent from "Total Expense").
 *
 * The actual aggregate logic lives in src/lib/income-expense-summary.ts so it
 * can be unit-tested without loading next-auth (which is ESM-only and breaks
 * jest's CJS resolver). This route is a thin auth + validation wrapper.
 *
 * Returns:
 *   {
 *     totalIncome, totalExpense, netCashflow,
 *     byCategory: { income: [...], expense: [...] },
 *     range: { from, to },
 *     count,
 *   }
 */
export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'incomeExpense')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    // Parse + validate dates. Defaults: from = start of month, to = today.
    // 🔒 R9-3 v2 (Verification Ledger): Was using `new Date()` which is UTC on
    // Vercel → "today" starts at 5:30 AM IST, and the date can be a day early
    // between midnight IST and 5:30 AM IST. Now: use the existing IST helpers
    // (istDayStart, istMonthStart) so the range aligns with the user's local day.
    const { istDayStart, istMonthStart } = await import('@/lib/timezone')
    const now = new Date()
    const startOfToday = istDayStart(now)
    const startOfMonth = istMonthStart(now)
    let from: Date
    let to: Date
    try {
      from = fromStr ? new Date(fromStr + 'T00:00:00.000+05:30') : startOfMonth
      to = toStr ? new Date(toStr + 'T23:59:59.999+05:30') : new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1)
      if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error('invalid date')
    } catch {
      return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 })
    }
    if (from > to) {
      return NextResponse.json({ error: '"from" must be on or before "to".' }, { status: 400 })
    }

    const hideProfit = await shouldHideProfit(authCtx.userId, authCtx.role)
    const result = await computeIncomeExpenseSummary(authCtx.userId, from, to, hideProfit)
    return noStore(result)
  } catch (error) {
    return apiError(error, 'Failed to load income/expense summary')
  }
}

