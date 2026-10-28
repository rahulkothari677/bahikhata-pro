'use client'

/**
 * Home → Insights (Phase 5c, ledger model v4 §2–3): the whole shop in totals,
 * groups and ranked lists, one section at a time, under the same period chip
 * as the Overview. Read-only; the engine is /api/insights.
 */
import { useAppStore } from '@/store/app-store'
import { ChipRow } from '@/components/common/ChipRow'
import { DateRangePicker, presetName, type DatePreset, type DateRange } from '@/components/common/DateRangePicker'
import { formatDate } from '@/lib/utils'
import { visibleSections, type InsightSection } from '@/lib/insights-view'
import { SalesSection } from '@/components/insights/SalesSection'
import { UdhaarSection } from '@/components/insights/UdhaarSection'
import { ItemsSection } from '@/components/insights/ItemsSection'
import { CustomersSection } from '@/components/insights/CustomersSection'
import { ProfitSection } from '@/components/insights/ProfitSection'

export function InsightsView({ range, preset, onChange, onPresetChange, hideProfit, t }: {
  range: DateRange
  hideProfit: boolean
  preset: DatePreset
  onChange: (range: DateRange, preset: DatePreset) => void
  onPresetChange: (preset: DatePreset) => void
  t: (k: string) => string
}) {
  const stored = useAppStore((s) => s.insightSection)
  const setSection = useAppStore((s) => s.setInsightSection)
  const sections = visibleSections(hideProfit)
  const section: InsightSection = (sections as readonly string[]).includes(stored) ? (stored as InsightSection) : 'sales'
  // The period's name for a list opened from a group ("A items · This Month"); a custom range says its dates.
  const period = preset === 'custom' ? `${formatDate(range.from)} – ${formatDate(range.to)}` : presetName(preset, t)
  return (
    <div className="space-y-3">
      {/* #260 (7h): the period sits at the end of the section chips — it took a row of its own (~56 px of a phone's first screen). */}
      <div className="flex items-center gap-2" data-insights-head>
        <div className="min-w-0 flex-1">
          <ChipRow
            ariaLabel={t('ins.sections')}
            chips={sections.map((s) => ({ value: s, label: t(`ins.sec.${s}`) }))}
            value={section}
            onChange={(s) => setSection(s)}
          />
        </div>
        <div className="shrink-0">
          <DateRangePicker value={range} onChange={onChange} preset={preset} onPresetChange={onPresetChange} />
        </div>
      </div>
      {section === 'sales' && <SalesSection range={range} t={t} />}
      {section === 'items' && <ItemsSection range={range} period={period} hideProfit={hideProfit} t={t} />}
      {section === 'customers' && <CustomersSection range={range} period={period} hideProfit={hideProfit} t={t} />}
      {section === 'udhaar' && <UdhaarSection range={range} t={t} />}
      {section === 'profit' && <ProfitSection range={range} t={t} />}
    </div>
  )
}
