'use client'

/**
 * 🔒 V26 P10: ToolsHub — a beautiful card-based tools page for desktop.
 *
 * Replaces the old collapsible "Tools" section at the bottom of the sidebar.
 * Now "Tools" is a main-nav entry that opens this page — same pattern as Reports.
 *
 * Design reference: ReportsHub (categorized cards), Linear (tool grid),
 * Stripe Dashboard (feature cards with hover effects).
 */

import { useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { useFeatureFlags } from '@/hooks/use-feature-flags'
import { useTranslation } from '@/hooks/use-translation'
import { NAV_REGISTRY, filterByPermissions, groupBySubcategory, type NavDestination, type NavSubcategoryId } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { haptic } from '@/lib/haptic'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  ChevronRight, ArrowLeft, ShoppingCart, Users, Package,
  Banknote, FileText, BarChart3, Sparkles, Store,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSession } from 'next-auth/react'

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
      { canAccess, isFlagEnabled: isFlagEnabled as any, isOwner }
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
    return ordered
  }, [toolsItems])

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'dashboard')
    setPreviousView(null)
  }

  const handleToolClick = (dest: NavDestination) => {
    haptic.click()
    handleNavAction(dest, { previousView: 'tools' })
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBack}
          className="p-2 -ml-2 rounded-lg hover:bg-muted transition lg:hidden"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold">Tools</h2>
          <p className="text-sm text-muted-foreground">Quick access to all your business tools</p>
        </div>
      </div>

      {/* Tool categories — card-based layout like ReportsHub */}
      {categories.map((category) => {
        const CategoryIcon = category.titleIcon
        return (
          <div key={category.subcategory}>
            {/* Category header */}
            <div className="flex items-center gap-2 px-2 mb-3">
              {CategoryIcon && <CategoryIcon className={cn('w-4 h-4', category.accentColor)} />}
              <h3 className={cn('text-sm font-semibold', category.accentColor)}>
                {category.title}
              </h3>
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-[10px] text-muted-foreground">{category.tools.length}</span>
            </div>

            {/* Tool cards grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {category.tools.map((tool) => {
                const Icon = tool.icon
                return (
                  <Card
                    key={tool.id}
                    className="cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 border-border/60 group"
                    onClick={() => handleToolClick(tool)}
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className={cn(
                        'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-110',
                        tool.iconBg || 'bg-muted'
                      )}>
                        <Icon className={cn('w-5 h-5', tool.iconColor || 'text-muted-foreground')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">
                            {tool.labelKey ? t(tool.labelKey) : tool.label}
                          </p>
                          {tool.badge && (
                            <span className={cn(
                              'text-[9px] px-1.5 py-0.5 rounded-full font-bold',
                              tool.badgeColor || 'bg-primary text-primary-foreground'
                            )}>
                              {tool.badge}
                            </span>
                          )}
                        </div>
                        {(tool.descKey || tool.description) && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {tool.descKey ? t(tool.descKey) : tool.description}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0" />
                    </CardContent>
                  </Card>
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
    </div>
  )
}
