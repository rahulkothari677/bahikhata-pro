'use client'

/**
 * 🔒 V22-5 (Phase 3) — ReportsHub
 *
 * Vyapar-style categorized grid of all available reports. Replaces the cramped
 * 11-tab horizontal scroll bar that was hard to browse on mobile.
 *
 * 🔒 AUDIT V25 §6.1 (Batch 8 Phase 5): CATEGORIES array removed — now renders
 * from the NavRegistry, filtered by surfaces: ['reports-hub'] + grouped by
 * subcategory. Report card click uses shared handleNavAction().
 *
 * Layout:
 *   1. Page title "Reports" + subtitle
 *   2. Four categorized sections, each with its own accent color:
 *      - Financial Reports (rose)
 *      - GST & Tax (blue)
 *      - Inventory & Stock (amber)
 *      - Banking & Reconciliation (emerald)
 *   3. Each report is a tappable card with icon, name, description
 */

import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'
// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 5): ReportsHub now renders from the NavRegistry.
import { NAV_REGISTRY, groupBySubcategory, type NavDestination, type NavSubcategoryId } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { BarChart3, FileText, Package, Banknote, ChevronRight, type LucideIcon } from 'lucide-react'
import { useTranslation } from '@/hooks/use-translation'

// Section metadata: maps subcategory → { title, titleIcon, accentColor } for ReportsHub.
// Matches the 4 categories from the old CATEGORIES array.
const CATEGORY_META: Partial<Record<NavSubcategoryId, { title: string; titleIcon: LucideIcon; accentColor: string }>> = {
  'financial':         { title: 'Financial Reports', titleIcon: BarChart3, accentColor: 'text-rose-600 dark:text-rose-400' },
  'gst':               { title: 'GST & Tax', titleIcon: FileText, accentColor: 'text-blue-600 dark:text-blue-400' },
  'inventory-reports': { title: 'Inventory & Stock', titleIcon: Package, accentColor: 'text-amber-600 dark:text-amber-400' },
  'banking':           { title: 'Banking Reports', titleIcon: Banknote, accentColor: 'text-emerald-600 dark:text-emerald-400' },
  'money-banking':     { title: 'Bank Reconciliation', titleIcon: Banknote, accentColor: 'text-emerald-600 dark:text-emerald-400' }, // 🔒 V26 P2: added so bank-reconciliation renders in ReportsHub
}

export function ReportsHub() {
  const { t } = useTranslation()
  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 5): Report items from NavRegistry, filtered
  // by surfaces: ['reports-hub'] + grouped by subcategory.
  const { categories } = useMemo(() => {
    const reportItems = NAV_REGISTRY
      .filter(d => d.surfaces?.includes('reports-hub'))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))

    const grouped = groupBySubcategory(reportItems)

    // Build ordered category list based on CATEGORY_META keys
    const cats: { subcategory: NavSubcategoryId; title: string; titleIcon: LucideIcon; accentColor: string; reports: NavDestination[] }[] = []
    for (const [subcat, reports] of grouped) {
      if (subcat && CATEGORY_META[subcat]) {
        cats.push({
          subcategory: subcat,
          ...CATEGORY_META[subcat]!,
          reports,
        })
      }
    }
    return { categories: cats }
  }, [])

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="animate-fade-slide-up">
        <h2 className="text-xl font-bold">Reports</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pick a report — each opens as its own page with filters &amp; export.
        </p>
      </div>

      {/* Categorized sections — rendered from NavRegistry (V25 §6.1 Phase 5) */}
      {categories.map((category, catIdx) => {
        const TitleIcon = category.titleIcon
        return (
          <div key={category.subcategory} className="animate-fade-slide-up" style={{ '--stagger-index': catIdx } as any}>
            <div className="flex items-center gap-2 px-1 mb-2">
              <TitleIcon className={cn('w-3.5 h-3.5', category.accentColor)} />
              <p className={cn(
                'text-xs font-semibold uppercase tracking-wider',
                category.accentColor,
              )}>
                {category.title}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {category.reports.map((report: NavDestination, repIdx: number) => {
                const Icon = report.icon
                return (
                  <button
                    key={report.id}
                    onClick={() => {
                      haptic.click()
                      // 🔒 AUDIT V25 §6.1 (Phase 5): Shared handleNavAction handles
                      // setPendingReportType + setView('reports') via the registry's
                      // actionKind: 'navigate-report'. previousView is set to
                      // currentView ('reports') so the back button returns here.
                      handleNavAction(report)
                    }}
                    className="card-hover group flex items-start gap-3 p-3 bg-card rounded-2xl border border-border/60 shadow-sm hover:border-primary/30 text-left active:bg-muted/50"
                    style={{ '--stagger-index': repIdx } as any}
                  >
                    <div className={cn(
                      'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-105',
                      report.iconBg || 'bg-muted',
                    )}>
                      <Icon className={cn('w-5 h-5', report.iconColor || 'text-muted-foreground')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight">{report.labelKey ? t(report.labelKey) : report.label}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {report.descKey ? t(report.descKey) : report.description}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0 mt-0.5" />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Footer hint */}
      <div className="pt-2 pb-1 text-center">
        <p className="text-[11px] text-muted-foreground">
          Tip: use the date picker at the top of each report to change the period.
        </p>
      </div>
    </div>
  )
}
