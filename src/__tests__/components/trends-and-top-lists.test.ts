/**
 * 🔒 GUARD: Trends and Top lists on Home (Phase 5b-5, ledger model v4 §7).
 *
 * - One Trends card with one switch (Sales · Profit · vs Purchases · Payments);
 *   Profit is left out for an account that may not see profit.
 * - Slide to read: the tooltip is pinned to the chart's top and follows the
 *   finger, so a day's figure is read without lifting it.
 * - Top lists read the same analytics query as the Business Analytics card.
 * - Buy again puts what is due first.
 */
import { describe, test, expect, jest } from '@jest/globals'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { topListRows, trendViews } from '@/components/dashboard/DashboardCharts'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

const en = translations.en as unknown as Record<string, string>
const hi = translations.hi as unknown as Record<string, string>
const t = (k: string) => en[k] ?? k

describe('Trends', () => {
  test('four views, three when profit is hidden', () => {
    expect(trendViews(false)).toEqual(['sales', 'profit', 'svp', 'modes'])
    expect(trendViews(true)).toEqual(['sales', 'svp', 'modes'])
  })
  test('the tooltip is pinned to the top (slide to read), and Sales vs purchases still uses its one calculation (#237)', () => {
    const code = readCode('src/components/dashboard/DashboardCharts.tsx')
    expect(code).toMatch(/<Tooltip\s+position=\{\{ y: 0 \}\}/)
    expect(code).toMatch(/salesVsPurchases\(kpis\)/)
  })
})

describe('Top lists', () => {
  const data = {
    topProducts: [{ name: 'Atta 5kg', quantity: 12, revenue: 3060 }],
    topCustomers: [{ name: 'Anita Singh', profit: 410.5, totalSales: 3635.27 }],
    reorder: [
      { name: 'Sugar', avgGapDays: 10, daysSinceLastPurchase: 4, shouldReorder: false },
      { name: 'Oil', avgGapDays: 7, daysSinceLastPurchase: 9, shouldReorder: true },
    ],
  }
  test('ranked rows: name, one line, value on the right', () => {
    expect(topListRows('items', data, t)).toEqual([{ name: 'Atta 5kg', line: '12 sold', value: '₹3,060' }])
    expect(topListRows('customers', data, t)).toEqual([{ name: 'Anita Singh', line: 'Sales ₹3,635.27', value: '₹410.50' }])
  })
  test('buy again: due first, then the soonest', () => {
    const rows = topListRows('buy', data, t)
    expect(rows.map((r) => [r.name, r.value])).toEqual([['Oil', 'Due'], ['Sugar', 'In 6 days']])
    expect(rows[0].line).toBe('Every 7 days · last 9 days ago')
  })
  test('one analytics query for Top lists and Business Analytics', () => {
    for (const f of ['src/components/dashboard/DashboardCharts.tsx', 'src/components/dashboard/AnalyticsInsights.tsx']) {
      const code = readCode(f)
      expect({ f, shared: /useAnalytics\(\)/.test(code), own: /queryKey: \['analytics'\]/.test(code) }).toEqual({ f, shared: true, own: false })
    }
  })
  test('every Trends and Top lists word exists in English and Hindi', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('trend.') || k.startsWith('top.'))
    expect(keys.length).toBeGreaterThanOrEqual(22)
    expect(keys.filter((k) => !hi[k])).toEqual([])
  })
})
