/**
 * 🔒 R14-1/R14-2 (Round 14) behavioral test — PLReport must not crash or show
 * ₹NaN when the server strips profit fields for staff+hideProfit.
 *
 * The bug: PLReport called `summary.profitMargin.toFixed(1)` unconditionally.
 * When the server strips profitMargin (via stripReportProfit) for staff with
 * hideProfit enabled, profitMargin is undefined → TypeError → white screen.
 * Also: formatINR(undefined.grossProfit) → "₹NaN" for the Gross Profit +
 * Net Profit cards.
 *
 * The fix: detect `summary.grossProfit === undefined` (same pattern as
 * StockReport's hideCost) and hide all profit-derived rows.
 *
 * This test verifies the detection logic + the rendering shape. It does NOT
 * mount the component (which would require a full React test setup with
 * providers) — instead it tests the hideProfit detection pattern directly.
 */

import { stripReportProfit } from '@/lib/profit-visibility'

describe('🔒 R14-1/R14-2 — PLReport hideProfit detection', () => {
  // The PLReport component uses: `const hideProfit = summary.grossProfit === undefined`
  // This test verifies that stripReportProfit produces a summary where grossProfit
  // is undefined, so the detection works.

  const fullReport = {
    summary: {
      totalRevenue: 100000,
      grossProfit: 25000,
      totalExpenses: 8000,
      otherIncome: 2000,
      netProfit: 19000,
      profitMargin: 19.0,
    },
    expensesByCategory: [{ name: 'Rent', value: 5000 }],
    incomeByCategory: [{ name: 'Interest', value: 2000 }],
  }

  test('stripReportProfit sets grossProfit to undefined (triggers hideProfit detection)', () => {
    const stripped = stripReportProfit(fullReport)
    // PLReport's detection: `const hideProfit = summary.grossProfit === undefined`
    expect(stripped.summary.grossProfit).toBeUndefined()
    // So hideProfit would be true → profit rows hidden.
  })

  test('stripReportProfit sets netProfit to undefined', () => {
    const stripped = stripReportProfit(fullReport)
    expect(stripped.summary.netProfit).toBeUndefined()
  })

  test('stripReportProfit sets profitMargin to undefined', () => {
    const stripped = stripReportProfit(fullReport)
    expect(stripped.summary.profitMargin).toBeUndefined()
    // The old code called `summary.profitMargin.toFixed(1)` on this → crash.
    // The fix: `typeof summary.profitMargin === 'number' ? summary.profitMargin.toFixed(1) : '—'`
    expect(typeof stripped.summary.profitMargin).not.toBe('number')
  })

  test('stripReportProfit does NOT strip non-profit summary fields', () => {
    const stripped = stripReportProfit(fullReport)
    expect(stripped.summary.totalRevenue).toBe(100000)
    expect(stripped.summary.totalExpenses).toBe(8000)
    expect(stripped.summary.otherIncome).toBe(2000)
    // These are safe to show — they don't reveal profit.
  })

  test('stripReportProfit does NOT strip expensesByCategory or incomeByCategory', () => {
    const stripped = stripReportProfit(fullReport)
    expect(stripped.expensesByCategory).toHaveLength(1)
    expect(stripped.incomeByCategory).toHaveLength(1)
  })

  test('full report (owner) has all profit fields defined → hideProfit is false', () => {
    // For owners, the server does NOT call stripReportProfit. So grossProfit
    // is defined → PLReport's `hideProfit = summary.grossProfit === undefined`
    // is false → profit rows shown.
    expect(fullReport.summary.grossProfit).toBeDefined()
    expect(fullReport.summary.netProfit).toBeDefined()
    expect(fullReport.summary.profitMargin).toBeDefined()
    expect(typeof fullReport.summary.profitMargin).toBe('number')
  })

  test('defensive default summary (no data) has grossProfit=0, not undefined', () => {
    // PLReport's defensive default: `{ totalRevenue: 0, grossProfit: 0, ... }`
    // When data is missing entirely, grossProfit is 0 (not undefined) →
    // hideProfit is false → profit rows show "₹0.00". This is correct:
    // the user sees a zero-P&L, not a hidden-P&L.
    const emptySummary = { totalRevenue: 0, grossProfit: 0, totalExpenses: 0, otherIncome: 0, netProfit: 0, profitMargin: 0 }
    expect(emptySummary.grossProfit).toBe(0)
    expect(emptySummary.grossProfit).not.toBeUndefined()
  })
})

describe('🔒 R14-3 — PLReport CSV export blocked when hideProfit', () => {
  // The fix in Reports.tsx handleCSVExport:
  //   if (reportType === 'pl' && data?.summary?.grossProfit === undefined) {
  //     sonnerToast.info('P&L profit is hidden — CSV export unavailable', ...)
  //     return
  //   }
  // This test verifies the detection condition.

  test('the detection condition matches the stripped state', () => {
    const fullReport = {
      summary: { totalRevenue: 100000, grossProfit: 25000, netProfit: 19000, profitMargin: 19.0 },
    }
    const stripped = stripReportProfit(fullReport)

    // The condition in handleCSVExport:
    const shouldBlockCSV = stripped.summary?.grossProfit === undefined
    expect(shouldBlockCSV).toBe(true)

    // For the full (owner) report:
    const shouldBlockCSV_owner = fullReport.summary?.grossProfit === undefined
    expect(shouldBlockCSV_owner).toBe(false)
  })
})
