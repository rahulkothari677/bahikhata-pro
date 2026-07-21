/**
 * 🔒 R12-2 (Round 12) behavioral test — stripDashboardProfit must strip ALL
 * derivable profit figures, not just todayProfit/rangeProfit/prevRangeProfit.
 *
 * The bug: the dashboard API computes `netProfit = rangeProfit + rangeIncome
 * - rangeExpenses` BEFORE calling stripDashboardProfit. The old stripper only
 * removed todayProfit/rangeProfit/prevRangeProfit — leaving netProfit in the
 * response. A staff member with devtools could read netProfit directly from
 * the network tab even though rangeProfit was stripped.
 *
 * Also: profitGrowth = ((rangeProfit - prevRangeProfit) / prevRangeProfit) * 100
 * was left in the response. Combined with knowledge of the previous period's
 * profit (even roughly), it leaks current profit.
 *
 * The fix: strip netProfit + profitGrowth too. Also strip `profit` from
 * recentTransactions (the API maps grossProfit → profit in the response).
 */

import { stripDashboardProfit } from '@/lib/profit-visibility'

describe('🔒 R12-2 — stripDashboardProfit strips ALL derivable profit figures', () => {
  const fullDashboard = {
    kpis: {
      todayRevenue: 5000,
      todayProfit: 1200,
      todayTxnCount: 5,
      rangeRevenue: 50000,
      rangeProfit: 12000,
      prevRangeProfit: 10000,
      netProfit: 15000, // ← computed before stripping: rangeProfit + rangeIncome - rangeExpenses
      profitGrowth: 20, // ← computed before stripping: ((rangeProfit - prev) / prev) * 100
      revenueGrowth: 10,
      totalReceivable: 8000,
      totalPayable: 3000,
    },
    salesTrend: [
      { date: '2026-07-01', revenue: 1000, profit: 200 },
      { date: '2026-07-02', revenue: 1500, profit: 300 },
    ],
    recentTransactions: [
      { id: 't1', type: 'sale', totalAmount: 500, grossProfit: 100, profit: 100 },
      { id: 't2', type: 'sale', totalAmount: 300, grossProfit: 60, profit: 60 },
    ],
    topProducts: [
      { name: 'Product A', revenue: 2000, profit: 400 },
    ],
    categoryBreakdown: [{ name: 'Electronics', value: 5000 }],
    lowStockProducts: [{ id: 'p1', name: 'Low Stock Item', currentStock: 2 }],
  }

  const stripped = stripDashboardProfit(fullDashboard)

  test('strips todayProfit from kpis', () => {
    expect(stripped.kpis.todayProfit).toBeUndefined()
  })

  test('strips rangeProfit from kpis', () => {
    expect(stripped.kpis.rangeProfit).toBeUndefined()
  })

  test('strips prevRangeProfit from kpis', () => {
    expect(stripped.kpis.prevRangeProfit).toBeUndefined()
  })

  test('🔒 R12-2: strips netProfit from kpis (was leaking)', () => {
    // netProfit = rangeProfit + rangeIncome - rangeExpenses = 15000
    // Was: left in the response → staff could read it from devtools.
    expect(stripped.kpis.netProfit).toBeUndefined()
  })

  test('🔒 R12-2: strips profitGrowth from kpis (was leaking)', () => {
    // profitGrowth = ((rangeProfit - prevRangeProfit) / prevRangeProfit) * 100 = 20
    // Combined with knowledge of prev period, leaks current profit.
    expect(stripped.kpis.profitGrowth).toBeUndefined()
  })

  test('does NOT strip non-profit KPIs (revenue, receivable, payable, counts)', () => {
    expect(stripped.kpis.todayRevenue).toBe(5000)
    expect(stripped.kpis.rangeRevenue).toBe(50000)
    expect(stripped.kpis.totalReceivable).toBe(8000)
    expect(stripped.kpis.totalPayable).toBe(3000)
    expect(stripped.kpis.todayTxnCount).toBe(5)
    expect(stripped.kpis.revenueGrowth).toBe(10) // revenue growth is not profit
  })

  test('strips profit from salesTrend', () => {
    stripped.salesTrend.forEach((point: any) => {
      expect(point.profit).toBeUndefined()
      expect(point.revenue).toBeDefined() // revenue stays
    })
  })

  test('strips grossProfit AND profit from recentTransactions', () => {
    // The API maps grossProfit → profit in the recentTransactions response shape.
    // Both must be stripped (one is the DB column name, one is the API field name).
    stripped.recentTransactions.forEach((txn: any) => {
      expect(txn.grossProfit).toBeUndefined()
      expect(txn.profit).toBeUndefined()
      expect(txn.totalAmount).toBeDefined() // non-profit fields stay
    })
  })

  test('strips profit from topProducts', () => {
    stripped.topProducts.forEach((p: any) => {
      expect(p.profit).toBeUndefined()
      expect(p.revenue).toBeDefined() // revenue stays
    })
  })

  test('does NOT strip non-profit arrays (categoryBreakdown, lowStockProducts)', () => {
    expect(stripped.categoryBreakdown).toHaveLength(1)
    expect(stripped.lowStockProducts).toHaveLength(1)
  })

  test('handles missing kpis gracefully (no crash)', () => {
    const noKpis = { salesTrend: [], recentTransactions: [], topProducts: [] }
    const result = stripDashboardProfit(noKpis)
    expect(result.kpis).toBeUndefined()
    expect(result.salesTrend).toEqual([])
  })

  test('handles null/undefined input gracefully', () => {
    expect(() => stripDashboardProfit(null)).not.toThrow()
    expect(() => stripDashboardProfit(undefined)).not.toThrow()
  })
})

describe('🔒 R12-2 — stripDashboardProfit does NOT affect owner responses', () => {
  // The API only calls stripDashboardProfit when hideProfit=true AND role=staff.
  // Owners always get the full response. This test verifies the function is
  // only called conditionally (we test the function itself above; here we
  // verify the shape is idempotent for a response that's already stripped).
  test('stripping an already-stripped response is a no-op', () => {
    const alreadyStripped = {
      kpis: { todayRevenue: 5000, todayProfit: undefined, rangeProfit: undefined },
      salesTrend: [{ revenue: 1000, profit: undefined }],
    }
    const result = stripDashboardProfit(alreadyStripped)
    expect(result.kpis.todayProfit).toBeUndefined()
    expect(result.kpis.rangeProfit).toBeUndefined()
    expect(result.salesTrend[0].profit).toBeUndefined()
    // Non-profit fields untouched.
    expect(result.kpis.todayRevenue).toBe(5000)
    expect(result.salesTrend[0].revenue).toBe(1000)
  })
})
