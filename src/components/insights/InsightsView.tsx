'use client'

/**
 * Home → Insights (Phase 5c, ledger model v4 §2–3): the whole shop in totals,
 * groups and ranked lists, one section at a time, under the same period chip
 * as the Overview. Read-only; the engine is /api/insights.
 */
import { useAppStore } from '@/store/app-store'
import { ChipRow } from '@/components/common/ChipRow'
import { DateRangePicker, type DatePreset, type DateRange } from '@/components/common/DateRangePicker'
import { LIVE_SECTIONS, type InsightSection } from '@/lib/insights-view'
import { SalesSection } from '@/components/insights/SalesSection'
import { UdhaarSection } from '@/components/insights/UdhaarSection'

export function InsightsView({ range, preset, onChange, onPresetChange, t }: {
  range: DateRange
  preset: DatePreset
  onChange: (range: DateRange, preset: DatePreset) => void
  onPresetChange: (preset: DatePreset) => void
  t: (k: string) => string
}) {
  const stored = useAppStore((s) => s.insightSection)
  const setSection = useAppStore((s) => s.setInsightSection)
  const section: InsightSection = (LIVE_SECTIONS as readonly string[]).includes(stored) ? (stored as InsightSection) : 'sales'
  return (
    <div className="space-y-3">
      <ChipRow
        ariaLabel={t('ins.sections')}
        chips={LIVE_SECTIONS.map((s) => ({ value: s, label: t(`ins.sec.${s}`) }))}
        value={section}
        onChange={(s) => setSection(s)}
      />
      <div className="flex justify-end">
        <DateRangePicker value={range} onChange={onChange} preset={preset} onPresetChange={onPresetChange} />
      </div>
      {section === 'sales' && <SalesSection range={range} t={t} />}
      {section === 'udhaar' && <UdhaarSection range={range} t={t} />}
    </div>
  )
}
