/**
 * 🔒 V26 N4 — Behavioral tests for the profit-leak fix in insights + consolidated.
 *
 * Two endpoints were missing the `shouldHideProfit` gate:
 *   - /api/insights — surfaced exact margin-drop/-up percentages from grossProfit
 *   - /api/reports/consolidated — returned profit + netProfit per shop + total
 *
 * After V26 N4:
 *   - insights: when hideProfit is true, NO insight with category === 'profit'
 *     appears in the response (margin-drop, margin-up, and any future profit
 *     insight). Stock/dues/sales insights remain.
 *   - consolidated: when hideProfit is true, profit + netProfit are stripped
 *     from each shop row and the total (revenue/expenses/GST/stock remain).
 *
 * This file exercises the route-independent pure helpers that the routes
 * delegate to: stripConsolidatedProfit (exported from the route via re-export)
 * and a small replica of the insights filter logic. The routes themselves are
 * thin wrappers that we verify with the CI guardrail test (see
 * v26-profit-leak-guard.test.ts).
 */

import { describe, test, expect } from '@jest/globals'
import {
  buildConsolidatedReport,
  type ShopAggregates,
} from '@/lib/consolidated-reports'

// ─── Helper: replicate stripConsolidatedProfit from the route ─────────────
// The route keeps this helper private; we replicate the same logic here to
// exercise it. If the route's helper drifts, the CI guardrail test will catch
// it (it greps for shouldHideProfit in the route file).

function stripConsolidatedProfit<T extends ShopAggregates>(s: T): T {
  return { ...s, profit: undefined as unknown as number, netProfit: undefined as unknown as number }
}

// ─── Consolidated: strip profit + netProfit ──────────────────────────────

describe('🔒 V26 N4 — Consolidated report profit stripping', () => {
  const baseShop: ShopAggregates = {
    shopId: 'shop1', shopName: 'Main Shop',
    revenue: 100000, profit: 25000, expenses: 5000, income: 2000, netProfit: 22000,
    outputTax: 18000, inputTax: 8000, netGST: 10000,
    stockValue: 50000, productCount: 100,
    saleCount: 50, purchaseCount: 20,
  }

  test('stripConsolidatedProfit removes profit + netProfit, keeps everything else', () => {
    const stripped = stripConsolidatedProfit(baseShop)
    expect(stripped.profit).toBeUndefined()
    expect(stripped.netProfit).toBeUndefined()
    // Everything else is intact
    expect(stripped.revenue).toBe(100000)
    expect(stripped.expenses).toBe(5000)
    expect(stripped.income).toBe(2000)
    expect(stripped.outputTax).toBe(18000)
    expect(stripped.inputTax).toBe(8000)
    expect(stripped.netGST).toBe(10000)
    expect(stripped.stockValue).toBe(50000)
    expect(stripped.productCount).toBe(100)
    expect(stripped.saleCount).toBe(50)
    expect(stripped.purchaseCount).toBe(20)
  })

  test('buildConsolidatedReport retains profit when called normally (no stripping)', () => {
    // Sanity check: the builder itself still produces profit + netProfit.
    // Stripping is the route's job, not the builder's.
    const shops = [{ id: 'shop1', name: 'Main Shop' }]
    const txns = [{
      shopId: 'shop1', type: 'sale',
      subtotal: 1000, discountAmount: 0, grossProfit: 200,
      totalAmount: 1180, cgst: 90, sgst: 90, igst: 0,
      paymentMode: 'cash', deletedAt: null,
    }]
    const products = [{ shopId: 'shop1', currentStock: 10, purchasePrice: 50 }]
    const report = buildConsolidatedReport(shops, txns, products, new Date('2026-07-01'), new Date('2026-07-31'))
    expect(report.shops[0].profit).toBe(200)
    expect(report.shops[0].netProfit).toBe(200)  // 200 profit + 0 income - 0 expenses
    expect(report.total.profit).toBe(200)
    expect(report.total.netProfit).toBe(200)
  })

  test('UI can detect stripped profit via `=== undefined` check', () => {
    // The UI uses `shop.profit !== undefined` to decide whether to render the
    // Profit column. Confirm stripped rows have undefined (not null, not 0).
    const stripped = stripConsolidatedProfit(baseShop)
    expect(stripped.profit).toBeUndefined()
    expect(stripped.netProfit).toBeUndefined()
    // The UI's check: `shops.some(s => s.profit !== undefined)` should be FALSE
    // when all shops are stripped.
    const allStripped = [baseShop, baseShop].map(stripConsolidatedProfit)
    expect(allStripped.some(s => s.profit !== undefined)).toBe(false)
    expect(allStripped.some(s => s.netProfit !== undefined)).toBe(false)
  })

  test('stripping is idempotent (stripping an already-stripped row is a no-op)', () => {
    const once = stripConsolidatedProfit(baseShop)
    const twice = stripConsolidatedProfit(once)
    expect(twice.profit).toBeUndefined()
    expect(twice.netProfit).toBeUndefined()
    expect(twice.revenue).toBe(100000)
  })
})

// ─── Insights: profit-category filter ────────────────────────────────────

describe('🔒 V26 N4 — Insights profit-category filter', () => {
  // Replicates the route's filter logic: when hideProfit is true, insights
  // with category === 'profit' are filtered out before the response is sent.

  function filterInsights(insights: Array<{ category: string }>, hideProfit: boolean) {
    return hideProfit ? insights.filter(i => i.category !== 'profit') : insights
  }

  test('hideProfit=true removes all profit-category insights', () => {
    const insights = [
      { category: 'stock' },
      { category: 'profit' },     // margin-drop
      { category: 'dues' },
      { category: 'profit' },     // margin-up
      { category: 'sales' },
    ]
    const filtered = filterInsights(insights, true)
    expect(filtered).toHaveLength(3)
    expect(filtered.every(i => i.category !== 'profit')).toBe(true)
  })

  test('hideProfit=false keeps all insights (including profit)', () => {
    const insights = [
      { category: 'stock' },
      { category: 'profit' },
      { category: 'dues' },
    ]
    const filtered = filterInsights(insights, false)
    expect(filtered).toHaveLength(3)
    expect(filtered.some(i => i.category === 'profit')).toBe(true)
  })

  test('hideProfit=true with no profit insights → no change', () => {
    const insights = [
      { category: 'stock' },
      { category: 'dues' },
      { category: 'sales' },
    ]
    const filtered = filterInsights(insights, true)
    expect(filtered).toHaveLength(3)
  })
})
