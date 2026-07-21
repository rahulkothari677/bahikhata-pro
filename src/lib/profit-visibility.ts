import { db } from '@/lib/db'

/**
 * 🔒 FIX H2: Server-side profit hiding.
 *
 * Was: hideProfit was display-only — the UI hid profit, but the API always
 * returned it. Staff (or anyone with devtools) could read margins the owner
 * explicitly chose to hide.
 *
 * Now: this helper fetches the setting and checks the role. If hideProfit
 * is true AND the caller is staff, profit fields should be stripped from
 * the response. Owners always see their own profit.
 */

/**
 * Check whether profit should be hidden for this user.
 * Returns true if hideProfit is enabled AND the user is staff.
 * Owners always see profit.
 */
export async function shouldHideProfit(
  userId: string,
  role: string,
): Promise<boolean> {
  if (!role || role === 'owner') return false

  const setting = await db.setting.findUnique({
    where: { userId },
    select: { hideProfit: true },
  })

  return setting?.hideProfit === true
}

/**
 * Strip profit fields from a dashboard response.
 * Removes: todayProfit, rangeProfit, prevRangeProfit, netProfit, profitGrowth
 * (all derivable profit figures), grossProfit from recentTransactions,
 * profit from topProducts + salesTrend.
 *
 * 🔒 R12-2 (Round 12): Added netProfit + profitGrowth to the strip list.
 * netProfit was computed BEFORE stripping (netProfit = rangeProfit + rangeIncome
 * - rangeExpenses) so it was still in the response even after rangeProfit was
 * stripped → a staff member with devtools could read it directly from the
 * network tab. profitGrowth is ((rangeProfit - prevRangeProfit) / prevRangeProfit)
 * * 100 — combined with knowledge of the previous period, it leaks current
 * profit. Both are now stripped.
 */
export function stripDashboardProfit(data: any): any {
  if (!data) return data
  return {
    ...data,
    kpis: data.kpis ? {
      ...data.kpis,
      todayProfit: undefined,
      rangeProfit: undefined,
      prevRangeProfit: undefined,
      netProfit: undefined,
      profitGrowth: undefined,
    } : data.kpis,
    salesTrend: data.salesTrend?.map((p: any) => ({ ...p, profit: undefined })),
    recentTransactions: data.recentTransactions?.map((t: any) => ({
      ...t,
      grossProfit: undefined,
      profit: undefined,
    })),
    topProducts: data.topProducts?.map((p: any) => ({
      ...p,
      profit: undefined,
    })),
  }
}

/**
 * Strip profit fields from a P&L report response.
 * Removes: grossProfit, netProfit, profitMargin from summary.
 */
export function stripReportProfit(data: any): any {
  if (data.summary) {
    return {
      ...data,
      summary: {
        ...data.summary,
        grossProfit: undefined,
        netProfit: undefined,
        profitMargin: undefined,
      },
    }
  }
  return data
}

/**
 * Strip grossProfit from a single transaction object.
 */
export function stripTransactionProfit(txn: any): any {
  if (!txn) return txn
  const { grossProfit, ...rest } = txn
  return rest
}

/**
 * Strip grossProfit from an array of transactions.
 */
export function stripTransactionsProfit(transactions: any[]): any[] {
  return transactions.map(t => {
    const { grossProfit, ...rest } = t
    return rest
  })
}
