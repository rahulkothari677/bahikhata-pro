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
 * Strip cost/profit fields from product rows.
 *
 * 🔒 R15 COMPLETION (2026-07-21): Round 15 hid the Inventory profit figures in
 * the COMPONENT (stat card, list column, grid card, ProductDialog preview) —
 * but /api/products still returned `purchasePrice` and `stockValue` to every
 * caller. A staff member with hideProfit enabled could read the cost price of
 * every product straight from the Network tab, or out of the offline IndexedDB
 * cache. Hiding a number in the UI is not access control; the server must not
 * send it.
 *
 * `purchasePrice` is the cost price — combined with the visible `salePrice` it
 * reveals the exact margin, which is the whole point of hideProfit.
 * `stockValue` is derived from it (stock × purchasePrice), so it leaks the same
 * information in aggregate and must go too.
 *
 * `salePrice`, `mrp`, `currentStock` and the low-stock flags are intentionally
 * KEPT: staff need them to sell and to reorder.
 */
export function stripProductProfit(product: any): any {
  if (!product) return product
  return {
    ...product,
    purchasePrice: undefined,
    stockValue: undefined,
    potentialProfit: undefined,
    profitMargin: undefined,
  }
}

/** Strip cost/profit fields from a list of product rows. */
export function stripProductsProfit(products: any[]): any[] {
  if (!Array.isArray(products)) return products
  return products.map(stripProductProfit)
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
