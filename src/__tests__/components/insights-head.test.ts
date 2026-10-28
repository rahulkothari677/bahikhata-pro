/**
 * Phase 7h — Insights' period sits beside the section chips (#260).
 * It took a row of its own under them (~56 px of a phone's first screen).
 */
import { readCode } from '@/test-support/read-source'

describe('the Insights head is one row', () => {
  const view = readCode('components/insights/InsightsView.tsx')
  it('the section chips and the period picker share one row', () => {
    const at = view.indexOf('<div className="flex items-center gap-2" data-insights-head>')
    expect(at).toBeGreaterThan(-1)
    const head = view.slice(at, view.indexOf("{section === 'sales'", at))
    expect(head).toContain('<ChipRow')
    expect(head).toContain('<DateRangePicker')
  })
  it('no row holds the picker alone', () => {
    expect(view).not.toMatch(/<div className="flex justify-end">\s*<DateRangePicker/)
  })
  it('is not vacuous: the head slice was found and holds the row', () => {
    // (balancedBlock would stop at the `{ range, … }` in the signature — read the slice itself.)
    const at = view.indexOf('data-insights-head')
    expect(at).toBeGreaterThan(-1)
    expect(view.slice(at, view.indexOf("{section === 'sales'", at)).length).toBeGreaterThan(200)
  })
})
