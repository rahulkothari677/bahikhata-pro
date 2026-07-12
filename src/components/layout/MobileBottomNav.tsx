'use client'

/**
 * MobileBottomNav — bottom navigation bar for mobile devices.
 *
 * Shows on screens < lg (1024px). Hidden on desktop where the sidebar
 * is always visible.
 *
 * 🔒 V17 Audit Phase 10: Now 6 tabs (Purchases moved from More to bottom nav):
 *   [Dashboard] [Sales] [ + New ] [Purchases] [Stock] [More]
 *
 * The center "+" button is elevated and highlighted. Tapping it goes to
 * New Sale. Long-pressing it opens a quick-action menu (New Sale /
 * New Purchase / Record Payment).
 *
 * "More" opens the MoreScreen (Income/Expense, Parties, Scanner, Reports,
 * Settings, Support).
 */

import { useAppStore, type ViewType } from '@/store/app-store'
import { LayoutDashboard, ShoppingCart, Package, Menu, Plus, Calculator, Truck, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/use-translation'
import { haptic } from '@/lib/haptic'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import type { ModuleKey } from '@/lib/staff-permissions'
import { prefetchView } from '@/lib/prefetch'  // 🔒 V11 §3.3
import { useState, useRef, useEffect } from 'react'

interface Tab {
  view: ViewType
  icon: typeof LayoutDashboard
  labelKey: string
  label: string
}

const TABS: Tab[] = [
  { view: 'dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard', label: 'Home' },
  { view: 'sales', icon: ShoppingCart, labelKey: 'nav.sales', label: 'Sales' },
  // Center "+" button is separate (not in this array)
  // 🔒 V17 Audit Phase 10: Purchases replaces Inventory in bottom nav (more frequently accessed)
  { view: 'purchases', icon: Truck, labelKey: 'nav.purchases', label: 'Buy' },
  // "More" is also separate (Inventory is now in More)
]

export function MobileBottomNav() {
  const { currentView, setView } = useAppStore()
  const { t } = useTranslation()
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

  // Don't show on auth screen or new entry/detail pages (those have their own back button)
  // The More screen KEEPS the bottom nav so users can switch tabs without going back
  const hideOnViews: ViewType[] = ['new-sale', 'new-purchase', 'transaction-detail', 'party-profile']
  if (hideOnViews.includes(currentView)) return null

  // Filter tabs by staff permissions
  const visibleTabs = TABS.filter(tab => {
    const moduleMap: Record<string, string> = {
      'dashboard': 'dashboard',
      'sales': 'sales',
      'purchases': 'purchases',
    }
    const moduleKey = moduleMap[tab.view]
    if (moduleKey) return canAccess(moduleKey as ModuleKey)
    return true
  })

  // 'More' tab is active when on the More screen OR any secondary view reached from More
  const isMoreActive = currentView === 'more' || ['inventory', 'income-expense', 'parties', 'scanner', 'reports', 'settings'].includes(currentView)

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
          {visibleTabs.slice(0, 2).map((tab) => {
            const Icon = tab.icon
            const isActive = currentView === tab.view
            return (
              <button
                key={tab.view}
                onClick={() => { haptic.click(); setView(tab.view) }}
                onTouchStart={() => prefetchView(tab.view)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-label={t(tab.labelKey) || tab.label}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{t(tab.labelKey) || tab.label}</span>
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

          {/* Right side: Inventory + More */}
          {visibleTabs.slice(2).map((tab) => {
            const Icon = tab.icon
            const isActive = currentView === tab.view
            return (
              <button
                key={tab.view}
                onClick={() => { haptic.click(); setView(tab.view) }}
                onTouchStart={() => prefetchView(tab.view)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-label={t(tab.labelKey) || tab.label}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{t(tab.labelKey) || tab.label}</span>
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
