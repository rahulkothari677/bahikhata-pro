'use client'

/**
 * MoreScreen — full-screen menu page for mobile.
 *
 * 🔒 V26 P9: Redesigned with collapsible accordion sections.
 * Each section is collapsed by default — user taps to expand.
 * Sections ordered by user priority (most-used first).
 * Colorful section headers matching top fintech app patterns.
 *
 * Design reference: WhatsApp Settings (collapsible groups),
 * Google Pay (categorized cards), CRED (colorful sections).
 */

import { useSession } from 'next-auth/react'
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/app-store'
// 🔒 V26 N20: Removed unused imports — useQuery, offlineFetch, sonnerToast,
// signOut, clearAllOfflineData. They were left behind when logout moved
// to AccountScreen and the AI Usage toast was removed.
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { haptic } from '@/lib/haptic'
import { prefetchView } from '@/lib/prefetch'
import { cn } from '@/lib/utils'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { NAV_REGISTRY, filterByPermissions, groupBySubcategory, type NavDestination, type NavSubcategoryId } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import {
  ChevronRight, ChevronDown, BarChart3, Users,
  Sparkles, ArrowLeft,
  FileText, Banknote, Package,
  Store, ShoppingCart,
} from 'lucide-react'
import type { ViewType } from '@/store/app-store'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from '@/hooks/use-translation'

// 🔒 V26 P9: Section metadata with accentColor + display order.
// Ordered by USER PRIORITY (what a shopkeeper uses most):
// 1. Sale & Purchase (daily transactions)
// 2. Customers & Suppliers (daily — who they sell to)
// 3. Items & Stock (daily — what they sell)
// 4. Money & Banking (daily — cash, payments)
// 5. Accounting Controls (monthly — reconciliation, period lock)
// 6. Financial Reports (monthly — P&L, profit)
// 7. GST Reports (monthly/quarterly — filing)
// 8. Banking Reports (monthly — cashflow)
// 9. Inventory Reports (weekly/monthly — stock analysis)
// 10. Smart Tools (as needed — AI features)
// 11. Business (occasional — settings)
const SECTION_ORDER: NavSubcategoryId[] = [
  'sale-purchase',
  'parties',
  'items-stock',
  'money-banking',
  'gst-tax',
  'financial',
  'gst',
  'banking',
  'inventory-reports',
  'smart-tools',
  'business',
]

const SECTION_META: Partial<Record<NavSubcategoryId, { title: string; titleIcon: LucideIcon; accentColor: string; bgGradient: string }>> = {
  // 🔒 V26 P10: Each section has a UNIQUE color — no adjacent repeats.
  // Color palette chosen for visual distinction and semantic meaning:
  'sale-purchase':       { title: 'Sale & Purchase',         titleIcon: ShoppingCart, accentColor: 'text-indigo-600 dark:text-indigo-400', bgGradient: 'from-indigo-500/10 to-indigo-600/5' },
  'parties':             { title: 'Customers & Suppliers',   titleIcon: Users, accentColor: 'text-cyan-600 dark:text-cyan-400', bgGradient: 'from-cyan-500/10 to-cyan-600/5' },
  'items-stock':         { title: 'Items & Stock',           titleIcon: Package, accentColor: 'text-amber-600 dark:text-amber-400', bgGradient: 'from-amber-500/10 to-amber-600/5' },
  'money-banking':       { title: 'Money & Banking',         titleIcon: Banknote, accentColor: 'text-emerald-600 dark:text-emerald-400', bgGradient: 'from-emerald-500/10 to-emerald-600/5' },
  'gst-tax':             { title: 'Accounting Controls',     titleIcon: FileText, accentColor: 'text-orange-600 dark:text-orange-400', bgGradient: 'from-orange-500/10 to-orange-600/5' },
  'financial':           { title: 'Financial Reports',       titleIcon: BarChart3, accentColor: 'text-rose-600 dark:text-rose-400', bgGradient: 'from-rose-500/10 to-rose-600/5' },
  'gst':                 { title: 'GST Reports',             titleIcon: FileText, accentColor: 'text-blue-600 dark:text-blue-400', bgGradient: 'from-blue-500/10 to-blue-600/5' },
  'banking':             { title: 'Banking Reports',         titleIcon: Banknote, accentColor: 'text-teal-600 dark:text-teal-400', bgGradient: 'from-teal-500/10 to-teal-600/5' },
  'inventory-reports':   { title: 'Inventory Reports',       titleIcon: Package, accentColor: 'text-lime-600 dark:text-lime-400', bgGradient: 'from-lime-500/10 to-lime-600/5' },
  'smart-tools':         { title: 'Smart Tools',             titleIcon: Sparkles, accentColor: 'text-violet-600 dark:text-violet-400', bgGradient: 'from-violet-500/10 to-violet-600/5' },
  'business':            { title: 'Business',                titleIcon: Store, accentColor: 'text-fuchsia-600 dark:text-fuchsia-400', bgGradient: 'from-fuchsia-500/10 to-fuchsia-600/5' },
}

export function MoreScreen() {
  const { t } = useTranslation()
  const { setView, previousView, setPreviousView } = useAppStore()
  const { data: session } = useSession()
  const { canAccess } = useStaffPermissions()
  // 🔒 V26 N20: Removed `isCA` from destructure — was unused after the
  // V26 P9 accordion rewrite. Confirm dialog also moved to AccountScreen.
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()

  // 🔒 V26 P10: All sections collapsed by default. User taps to expand.
  const [expandedSection, setExpandedSection] = useState<NavSubcategoryId | null>(null)

  useEffect(() => {
    prefetchView('reports')
  }, [])

  const isOwner = session?.user?.role === 'owner'
  const moreItems = useMemo(() => {
    const filtered = filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('more')),
      { canAccess, isFlagEnabled: (flag: string) => {
        const features = useAppStore.getState().features
        return features?.[flag as keyof typeof features] ?? false
      }, isOwner, platform: 'mobile' }
    )
    return filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isOwner])

  // 🔒 V26 P9: Build sections in SECTION_ORDER (user priority), not Map insertion order
  const sections = useMemo(() => {
    const grouped = groupBySubcategory(moreItems)
    const orderedSections: { subcategory: NavSubcategoryId; title: string; titleIcon: LucideIcon; accentColor: string; bgGradient: string; items: NavDestination[] }[] = []
    for (const subcat of SECTION_ORDER) {
      const items = grouped.get(subcat)
      if (items && items.length > 0 && SECTION_META[subcat]) {
        orderedSections.push({
          subcategory: subcat,
          ...SECTION_META[subcat]!,
          items,
        })
      }
    }
    // Also include any sections that exist in grouped but not in SECTION_ORDER (shouldn't happen, but defensive)
    for (const [subcat, items] of grouped) {
      if (subcat && SECTION_META[subcat] && !SECTION_ORDER.includes(subcat) && items.length > 0) {
        orderedSections.push({
          subcategory: subcat,
          ...SECTION_META[subcat]!,
          items,
        })
      }
    }
    return orderedSections
  }, [moreItems])

  const handleItemClick = (dest: NavDestination) => {
    haptic.click()
    handleNavAction(dest, { previousView: 'more' })
  }

  const toggleSection = (subcat: NavSubcategoryId) => {
    haptic.click()
    setExpandedSection(expandedSection === subcat ? null : subcat)
  }

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'dashboard')
    setPreviousView(null)
  }

  // 🔒 V26 N20: handleLogout REMOVED — was dead code. Logout moved to
  // AccountScreen in V26 N8; this function was defined but never called
  // from JSX (only referenced in its own definition).

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={handleBack} className="p-2 -ml-2 rounded-lg hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">More</h2>
        </div>
      </div>

      <div
        className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-24"
        style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
      >
        {/* 🔒 V26 P9: Collapsible accordion sections.
            Each section is a tappable header that expands/collapses its items.
            Only one section expanded at a time (classic accordion pattern).
            First section (Sale & Purchase) expanded by default. */}
        {sections.map((section) => {
          const isExpanded = expandedSection === section.subcategory
          const SectionIcon = section.titleIcon
          const accentColor = section.accentColor || 'text-muted-foreground'
          const bgGradient = section.bgGradient || ''
          const itemCount = section.items.length

          return (
            <div
              key={section.subcategory}
              className={cn(
                'rounded-2xl overflow-hidden border border-border/60 shadow-sm',
                'bg-gradient-to-br',
                bgGradient,
              )}
            >
              {/* Section header — tappable to expand/collapse */}
              <button
                onClick={() => toggleSection(section.subcategory)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-card/60 backdrop-blur-sm hover:bg-card transition"
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                  'bg-background/80',
                )}>
                  {SectionIcon && <SectionIcon className={cn('w-4 h-4', accentColor)} />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className={cn('text-sm font-semibold', accentColor)}>
                    {section.title}
                  </p>
                  <p className="text-3xs text-muted-foreground">
                    {itemCount} {itemCount === 1 ? 'item' : 'items'}
                  </p>
                </div>
                <ChevronDown className={cn(
                  'w-4 h-4 text-muted-foreground transition-transform flex-shrink-0',
                  isExpanded && 'rotate-180',
                )} />
              </button>

              {/* Section items — animated expand/collapse */}
              {isExpanded && (
                <div className="bg-card border-t border-border/30">
                  {section.items.map((item: NavDestination, i: number) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleItemClick(item)}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left active:bg-muted group',
                          i > 0 && 'border-t border-border/20',
                        )}
                      >
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-105',
                          item.iconBg || 'bg-muted'
                        )}>
                          <Icon className={cn('w-5 h-5', item.iconColor || 'text-muted-foreground')} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{item.labelKey ? t(item.labelKey) : item.label}</p>
                            {item.badge && (
                              <span className={cn(
                                'text-3xs px-1.5 py-0.5 rounded-full font-bold',
                                item.badgeColor || 'bg-primary text-primary-foreground'
                              )}>
                                {item.badge}
                              </span>
                            )}
                          </div>
                          {(item.descKey || item.description) && (
                            <p className="text-xs text-muted-foreground truncate">
                              {item.descKey ? t(item.descKey) : item.description}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {confirmDialogEl}
    </div>
  )
}
