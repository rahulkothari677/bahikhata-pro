'use client'

/**
 * 🔒 V26 P10: ToolsHub — card-based tools page for desktop.
 *
 * Replaces the old collapsible "Tools" section at the bottom of the sidebar.
 * "Tools" is now a main-nav entry that opens this page — same pattern as Reports.
 *
 * 🔒 V26 P11: Card styling EXACTLY matches ReportsHub — same button-based
 * layout, same classes (card-hover, p-3, rounded-2xl, gap-2.5), same grid.
 * Was: used Card component with different sizing → inconsistent.
 *
 * Design reference: ReportsHub (identical card layout), Linear, Stripe.
 */

import { useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { useFeatureFlags } from '@/hooks/use-feature-flags'
import { useTranslation } from '@/hooks/use-translation'
import { NAV_REGISTRY, filterByPermissions, groupBySubcategory, type NavDestination, type NavSubcategoryId } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import {
  ChevronRight, ShoppingCart, Users, Package,
  Banknote, FileText, BarChart3, Sparkles, Store,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSession } from 'next-auth/react'

// Same category metadata as ReportsHub — consistent visual language
const TOOLS_CATEGORY_META: Partial<Record<NavSubcategoryId, { title: string; titleIcon: LucideIcon; accentColor: string }>> = {
  'sale-purchase':       { title: 'Transactions',      titleIcon: ShoppingCart, accentColor: 'text-indigo-600 dark:text-indigo-400' },
  'parties':             { title: 'Parties',            titleIcon: Users, accentColor: 'text-cyan-600 dark:text-cyan-400' },
  'items-stock':         { title: 'Stock',              titleIcon: Package, accentColor: 'text-amber-600 dark:text-amber-400' },
  'money-banking':       { title: 'Banking',            titleIcon: Banknote, accentColor: 'text-emerald-600 dark:text-emerald-400' },
  'gst-tax':             { title: 'Controls',           titleIcon: FileText, accentColor: 'text-orange-600 dark:text-orange-400' },
  'financial':           { title: 'Financial',          titleIcon: BarChart3, accentColor: 'text-rose-600 dark:text-rose-400' },
  'gst':                 { title: 'GST',                titleIcon: FileText, accentColor: 'text-blue-600 dark:text-blue-400' },
  'banking':             { title: 'Banking',            titleIcon: Banknote, accentColor: 'text-teal-600 dark:text-teal-400' },
  'inventory-reports':   { title: 'Inventory',          titleIcon: Package, accentColor: 'text-lime-600 dark:text-lime-400' },
  'smart-tools':         { title: 'AI Tools',           titleIcon: Sparkles, accentColor: 'text-violet-600 dark:text-violet-400' },
  'business':            { title: 'Business',           titleIcon: Store, accentColor: 'text-fuchsia-600 dark:text-fuchsia-400' },
}

export function ToolsHub() {
  const { t } = useTranslation()
  const { previousView, setView, setPreviousView } = useAppStore()
  const { canAccess, isCA } = useStaffPermissions()
  const { isFlagEnabled } = useFeatureFlags()
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'owner'

  const toolsItems = useMemo(() => {
    return filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('sidebar-tools')),
      { canAccess, isFlagEnabled: isFlagEnabled as any, isOwner, platform: 'desktop' }
    ).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isFlagEnabled, isOwner])

  const categories = useMemo(() => {
    const grouped = groupBySubcategory(toolsItems)
    const ordered: { subcategory: NavSubcategoryId; title: string; titleIcon: LucideIcon; accentColor: string; tools: NavDestination[] }[] = []
    for (const [subcat, items] of grouped) {
      if (subcat && TOOLS_CATEGORY_META[subcat] && items.length > 0) {
        ordered.push({
          subcategory: subcat,
          ...TOOLS_CATEGORY_META[subcat]!,
          tools: items,
        })
      }
    }
    // Include uncategorized items
    const uncategorized = grouped.get(undefined)
    if (uncategorized && uncategorized.length > 0) {
      ordered.push({
        subcategory: 'other' as NavSubcategoryId,
        title: 'Other',
        titleIcon: ChevronRight,
        accentColor: 'text-muted-foreground',
        tools: uncategorized,
      })
    }
    return ordered
  }, [toolsItems])

  return (
    <div className="space-y-5">
      {/* Page header — same style as ReportsHub */}
      <div className="animate-fade-slide-up">
        <h2 className="text-xl font-bold">Tools</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Quick access to all your business tools — voice entry, scanner, reminders, and more.
        </p>
      </div>

      {/* Categorized sections — EXACT same card layout as ReportsHub */}
      {categories.map((category, catIdx) => {
        const TitleIcon = category.titleIcon
        return (
          <div key={category.subcategory} className="animate-fade-slide-up" style={{ '--stagger-index': catIdx } as any}>
            {/* Category header — same style as ReportsHub */}
            <div className="flex items-center gap-2 px-1 mb-2">
              <TitleIcon className={cn('w-3.5 h-3.5', category.accentColor)} />
              <p className={cn(
                'text-xs font-semibold uppercase tracking-wider',
                category.accentColor,
              )}>
                {category.title}
              </p>
            </div>
            {/* Tool cards — EXACT same grid + classes as ReportsHub */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {category.tools.map((tool: NavDestination, toolIdx: number) => {
                const Icon = tool.icon
                return (
                  <button
                    key={tool.id}
                    onClick={() => {
                      haptic.click()
                      handleNavAction(tool, { previousView: 'tools' })
                    }}
                    className="card-hover group flex items-start gap-3 p-3 bg-card rounded-2xl border border-border/60 shadow-card hover:border-primary/30 text-left active:bg-muted/50"
                    style={{ '--stagger-index': toolIdx } as any}
                  >
                    <div className={cn(
                      'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-105',
                      tool.iconBg || 'bg-muted',
                    )}>
                      <Icon className={cn('w-5 h-5', tool.iconColor || 'text-muted-foreground')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight">{tool.labelKey ? t(tool.labelKey) : tool.label}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {tool.descKey ? t(tool.descKey) : tool.description}
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

      {categories.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No tools available.</p>
        </div>
      )}

      {/* Footer hint — same style as ReportsHub */}
      <div className="pt-2 pb-1 text-center">
        <p className="text-2xs text-muted-foreground">
          Tip: use Ctrl+K (Cmd+K on Mac) to quickly search and jump to any tool.
        </p>
      </div>
    </div>
  )
}
