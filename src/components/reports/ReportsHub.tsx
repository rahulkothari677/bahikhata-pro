'use client'

/**
 * The one Reports page (Phase 5f-2, ledger model v4 §9).
 *
 * Four sections, each report once, by what the shopkeeper is asking about:
 *   Money   — P&L, bill-wise and item-wise profit, account summary, cashflow, shops together, bank matching
 *   People  — party statement, debt ageing ("udhaar age")
 *   Stock   — stock report, inventory ageing
 *   GST     — the returns and summaries, only for a shop that files them
 * The section comes from the registry (`reportGroup` on each entry), so a new
 * report lands in its section without touching this file, and a report with
 * no section fails the guard instead of vanishing.
 *
 * It was four cards per category ("Financial", "GST & Tax", "Inventory &
 * Stock", "Banking & Reconciliation") with a sentence under the title and a
 * tip at the foot (app, not a notebook).
 */
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'
import { NAV_REGISTRY, REPORT_GROUPS, showsForGstStatus, type NavDestination, type ReportGroup } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '@/hooks/use-translation'
import { gstStatus } from '@/lib/shop-tax'
import { useSetting } from '@/hooks/use-setting'

/** The reports of each section, in the registry's order, after the shop's GST status (Phase 1c-2). */
export function reportSections(all: NavDestination[], shopGst: ReturnType<typeof gstStatus> | undefined): { group: ReportGroup; reports: NavDestination[] }[] {
  const reports = all
    .filter((d) => d.surfaces?.includes('reports-hub'))
    .filter((d) => showsForGstStatus(d, shopGst))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  return REPORT_GROUPS
    .map((group) => ({ group, reports: reports.filter((d) => d.reportGroup === group) }))
    .filter((s) => s.reports.length > 0)
}

export function ReportsHub() {
  const { t } = useTranslation()
  const { setting: shopSetting } = useSetting()
  const shopGst = shopSetting ? gstStatus(shopSetting) : undefined
  const sections = useMemo(() => reportSections(NAV_REGISTRY, shopGst), [shopGst])

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">{t('nav.label.reports')}</h2>
      {sections.map(({ group, reports }) => (
        <section key={group} aria-labelledby={`reports-${group}`} className="space-y-2">
          <h3 id={`reports-${group}`} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`reports.group.${group}`)}</h3>
          <ul className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
            {reports.map((report) => {
              const Icon = report.icon
              return (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => { haptic.click(); handleNavAction(report) }}
                    className="w-full min-h-14 flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 active:bg-muted/60"
                  >
                    <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', report.iconBg || 'bg-muted')}>
                      <Icon className={cn('w-5 h-5', report.iconColor || 'text-muted-foreground')} aria-hidden />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-sm leading-tight">{report.labelKey ? t(report.labelKey) : report.label}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5 truncate">{report.descKey ? t(report.descKey) : report.description}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
