/**
 * 🔒 GUARD: period names in the shop's language (#272, Phase 5f-4). "This
 * Month", "Last Month"… were English literals in the picker, so a Hindi shop
 * read English on Bills, Insights and the list chips opened from Insights.
 */
import { describe, test, expect } from '@jest/globals'
import { translations } from '@/lib/i18n'
import { getPresetLabel, presetName, type DatePreset } from '@/components/common/DateRangePicker'
import { readCode } from '@/test-support/read-source'

const PRESETS: DatePreset[] = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'custom']

describe('every period has a name in English and Hindi', () => {
  const en = translations.en as unknown as Record<string, string>, hi = translations.hi as unknown as Record<string, string>
  test.each(PRESETS)('%s', (p) => {
    expect(en[`period.${p}`]).toBeTruthy()
    expect(hi[`period.${p}`]).toBeTruthy()
    expect(presetName(p, (k) => hi[k] ?? k)).toBe(hi[`period.${p}`])
  })
  test('the English names stay what other screens match on (Ask hands Bills and Reports a period by name)', () => {
    for (const p of PRESETS) expect(presetName(p, (k) => en[k] ?? k)).toBe(getPresetLabel(p))
  })
})

describe('the screens show the translated name', () => {
  test.each([
    ['src/components/common/DateRangePicker.tsx', /presetName\(p\.id, t\)/],
    ['src/components/insights/InsightsView.tsx', /presetName\(preset, t\)/],
    ['src/components/ledger/Ledger.tsx', /presetName\(datePreset, t\)/],
    ['src/components/ledger/LedgerFilterSheet.tsx', /presetName\(id, t\)/],
    ['src/components/dashboard/Dashboard.tsx', /presetName\(datePreset, t\)/],
  ])('%s', (file, re) => {
    expect(readCode(file)).toMatch(re)
  })
  test('the picker no longer prints the English literal', () => {
    expect(readCode('src/components/common/DateRangePicker.tsx')).not.toMatch(/\{p\.label\}/)
  })
})
