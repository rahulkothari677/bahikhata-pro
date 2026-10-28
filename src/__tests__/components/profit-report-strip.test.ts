/**
 * Phase 7h — the profit reports open on the figures (#280).
 *
 * Bill-wise and Item-wise Profit opened with a period box and four icon stat cards
 * (2 × 2 on a phone, ~250 px) before the first row. The totals are now one strip,
 * Insights' own TotalsStrip — revenue (with the bill / product count), cost, profit.
 */
import { readCode } from '@/test-support/read-source'

describe.each(['BillWiseProfit', 'ItemWiseProfit'])('%s', (name) => {
  const code = readCode(`components/reports/${name}.tsx`)
  it('shows its totals in the one strip', () => {
    expect(code).toContain("import { TotalsStrip } from '@/components/insights/InsightsKit'")
    expect(code).toMatch(/<TotalsStrip cells=\{\[[\s\S]*label: 'Revenue \(excl\. GST\)'[\s\S]*label: 'Cost'[\s\S]*label: 'Profit'/)
  })
  it('has no grid of stat cards', () => {
    expect(code).not.toMatch(/function StatCard\(/)
    expect(code).not.toMatch(/grid-cols-2 lg:grid-cols-4/)
  })
})
