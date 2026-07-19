'use client'

/**
 * MobileBottomNav — bottom navigation bar for mobile devices.
 *
 * Shows on screens < lg (1024px). Hidden on desktop where the sidebar
 * is always visible.
 *
 * 🔒 V26 P7: Updated — 4 tabs + center + button (was: stale comment claimed 6 tabs with "Stock"):
 *   [Dashboard] [Sales] [ + New ] [Purchases] [More]
 * Inventory/Parties/Reports are reachable via the More screen (V26 P1 fix
 * added missing subcategories so they render in MoreScreen sections).
 *
 * The center "+" button is elevated and highlighted. Tapping it goes to
 * New Sale. Long-pressing it opens a quick-action menu (New Sale /
 * New Purchase / Record Payment).
 *
 * "More" opens the MoreScreen (Income/Expense, Parties, Scanner, Reports,
 * Settings, Support).
 *
 * 🔒 AUDIT V25 §6.1 (Batch 8 Phase 3): TABS array removed — now renders
 * from the NavRegistry, filtered by surfaces: ['bottom-nav'].
 */

import { useAppStore, type ViewType } from '@/store/app-store'
import { Menu, Plus, Calculator, ShoppingCart, Truck, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { prefetchView } from '@/lib/prefetch'  // 🔒 V11 §3.3
import { useState, useRef, useEffect, useMemo } from 'react'
// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 3): BottomNav now renders from the NavRegistry.
import { NAV_REGISTRY, filterByPermissions, type NavDestination } from '@/lib/nav-registry'
import { useTranslation } from '@/hooks/use-translation'

export function MobileBottomNav() {
  const { t } = useTranslation()
  const { currentView, setView, previousView } = useAppStore()
  const { canAccess, isCA } = useStaffPermissions()

  // 🔒 V17 Audit Phase 10: Long-press quick-action menu state
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quickMenuRef = useRef<HTMLDivElement>(null)

  // Close quick menu on outside click
  useEffect(() => {
    if (!showQuickMenu) return
    const handleClick = (e: MouseEvent) => {
      if (quickMenuRef.current && !quickMenuRef.current.contains(e.target as Node)) {
        setShowQuickMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showQuickMenu])

  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 3): Tabs from NavRegistry, filtered by
  // surfaces: ['bottom-nav'] + permissions. Was: hardcoded TABS array with
  // inline moduleMap permission check.
  // NOTE: useMemo must be called BEFORE any conditional return (Rules of Hooks).
  const visibleTabs = useMemo(() => {
    return filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('bottom-nav')),
      { canAccess, isFlagEnabled: () => true, isOwner: true, platform: 'mobile' }
    ).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess])

  // Don't show on auth screen or new entry/detail pages (those have their own back button)
  // The More screen KEEPS the bottom nav so users can switch tabs without going back
  const hideOnViews: ViewType[] = ['new-sale', 'new-purchase', 'new-estimate', 'transaction-detail', 'party-profile']
  if (hideOnViews.includes(currentView)) return null

  // 🔒 AUDIT V25 FIX §4.6: isMoreActive was highlighting the "More" tab for
  // 10 secondary views (inventory, income-expense, parties, scanner, reports,
  // settings, pricing, ai-comparison, ai-usage, document-vault) — even when
  // the user navigated to them from the Sidebar or from a dashboard quick
  // action. Opening Reports from the dashboard highlighted "More" even
  // though the user never touched More.
  //
  // Fix: More highlights ONLY when:
  //   (a) currentView IS 'more' (user is on the More screen itself), OR
  //   (b) currentView IS 'account' (Account is reached from More on mobile), OR
  //   (c) previousView === 'more' (user actually came FROM More).
  //
  // This way, if the user opens Inventory from the Sidebar, Home tab stays
  // active (or no tab highlights — visually honest). If they open Inventory
  // from More, More stays highlighted until they navigate elsewhere.
  //
  // Without the §6.1 registry (deferred), we can't know which tab "owns"
  // each view — previousView is the best proxy.
  const isMoreActive =
    currentView === 'more' ||
    currentView === 'account' ||
    previousView === 'more'

  // 🔒 V17 Audit Phase 10: Long-press handlers for the + button
  const handlePlusTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      haptic.medium()
      setShowQuickMenu(true)
    }, 500) // 500ms long-press
  }
  const handlePlusTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }
  const handlePlusClick = () => {
    // If the menu is showing, don't also navigate (the long-press already fired)
    if (showQuickMenu) return
    haptic.medium()
    setView('new-sale')
  }

  // Quick menu actions
  const quickActions = [
    { label: 'New Sale', icon: ShoppingCart, view: 'new-sale' as ViewType, color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'New Purchase', icon: Truck, view: 'new-purchase' as ViewType, color: 'text-amber-600 dark:text-amber-400' },
    { label: 'Income/Expense', icon: Wallet, view: 'income-expense' as ViewType, color: 'text-blue-600' },
  ]

  return (
    <>
      {/* Spacer to prevent content from being hidden behind the nav.
          Extra height: 80px nav + safe area for home indicator. */}
      <div className="lg:hidden" style={{ height: 'calc(5rem + env(safe-area-inset-bottom))' }} />

      {/* Bottom nav bar.
          safe-area-inset-bottom prevents the nav from being hidden behind
          the iPhone home indicator or Android gesture bar. */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-background/95 backdrop-blur-md border-t border-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-around h-16 px-2 relative">
          {/* Left side: Dashboard + Sales */}
          {visibleTabs.slice(0, 2).map((tab: NavDestination) => {
            const Icon = tab.icon
            const tabView = tab.view || 'dashboard'
            const isActive = currentView === tabView
            return (
              <button
                key={tab.id}
                onClick={() => { haptic.click(); setView(tabView) }}
                onTouchStart={() => prefetchView(tabView)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-label={tab.labelKey ? t(tab.labelKey) : tab.label}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{tab.labelKey ? t(tab.labelKey) : tab.label}</span>
              </button>
            )
          })}

          {/* Center: New button (elevated) — long-press for quick menu */}
          <div className="flex-1 flex justify-center relative">
            {isCA ? (
              <div
                className="flex flex-col items-center justify-center gap-0.5"
                title="CA Mode — Read-only access"
              >
                <div className="w-12 h-12 -mt-6 rounded-full bg-violet-600 text-white flex items-center justify-center shadow-lg shadow-violet-600/30">
                  <Calculator className="w-6 h-6" strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">CA Mode</span>
              </div>
            ) : (
              <>
                <button
                  onClick={handlePlusClick}
                  onTouchStart={handlePlusTouchStart}
                  onTouchEnd={handlePlusTouchEnd}
                  onTouchMove={handlePlusTouchEnd}
                  className="w-12 h-12 -mt-6 rounded-full bg-gradient-saffron text-white flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform"
                  aria-label="New Sale (long-press for more options)"
                >
                  <Plus className="w-6 h-6" strokeWidth={2.5} />
                </button>
                {/* 🔒 V17 Audit Phase 10: Long-press quick-action menu */}
                {showQuickMenu && (
                  <div
                    ref={quickMenuRef}
                    className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-xl shadow-xl py-1 min-w-[160px] z-50"
                  >
                    {quickActions.map((action) => {
                      const ActionIcon = action.icon
                      return (
                        <button
                          key={action.view}
                          onClick={() => {
                            haptic.click()
                            setShowQuickMenu(false)
                            setView(action.view)
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition text-left"
                        >
                          <ActionIcon className={cn('w-4 h-4', action.color)} />
                          <span className="text-sm font-medium">{action.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right side: Purchases + More */}
          {visibleTabs.slice(2).map((tab: NavDestination) => {
            const Icon = tab.icon
            const tabView = tab.view || 'dashboard'
            const isActive = currentView === tabView
            return (
              <button
                key={tab.id}
                onClick={() => { haptic.click(); setView(tabView) }}
                onTouchStart={() => prefetchView(tabView)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-label={tab.labelKey ? t(tab.labelKey) : tab.label}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{tab.labelKey ? t(tab.labelKey) : tab.label}</span>
              </button>
            )
          })}

          <button
            onClick={() => { haptic.click(); setView('more') }}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
              isMoreActive ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-label="More"
          >
            <Menu className="w-5 h-5" strokeWidth={isMoreActive ? 2.5 : 2} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
