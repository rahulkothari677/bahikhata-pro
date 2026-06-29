'use client'

/**
 * MobileBottomNav — floating capsule bottom navigation for mobile.
 *
 * Shows on screens < lg (1024px). Hidden on desktop where the sidebar
 * is always visible.
 *
 * Design inspired by PhonePe / BharatPe:
 *   - Floats above content with margin from bottom edge
 *   - Capsule shape (rounded-full) with backdrop blur
 *   - 5 tabs: [Home] [Sales] [ + New ] [Stock] [More]
 *   - Center "+" button is elevated and highlighted
 *   - Active tab: pill highlight behind icon + label
 *   - Inactive tab: just icon + label, muted color
 *
 * "More" opens the More screen (which has all other views: Purchases,
 * Income/Expense, Parties, Scanner, Reports, Settings).
 */

import { useAppStore, type ViewType } from '@/store/app-store'
import { LayoutDashboard, ShoppingCart, Package, Menu, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/use-translation'
import { haptic } from '@/lib/haptic'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'

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
  { view: 'inventory', icon: Package, labelKey: 'nav.inventory', label: 'Stock' },
  // "More" is also separate
]

export function MobileBottomNav() {
  const { currentView, setView } = useAppStore()
  const { t } = useTranslation()
  const { canAccess } = useStaffPermissions()

  // Don't show on auth screen or new entry/detail pages (those have their own back button)
  // The More screen KEEPS the bottom nav so users can switch tabs without going back
  const hideOnViews: ViewType[] = ['new-sale', 'new-purchase', 'transaction-detail', 'party-profile']
  if (hideOnViews.includes(currentView)) return null

  // Filter tabs by staff permissions
  const visibleTabs = TABS.filter(tab => {
    const moduleMap: Record<string, string> = {
      'dashboard': 'dashboard',
      'sales': 'sales',
      'inventory': 'inventory',
    }
    const moduleKey = moduleMap[tab.view]
    if (moduleKey) return canAccess(moduleKey as any)
    return true
  })

  // 'More' tab is active when on the More screen OR any secondary view reached from More
  const isMoreActive = currentView === 'more' || ['purchases', 'income-expense', 'parties', 'scanner', 'reports', 'settings'].includes(currentView)

  return (
    <>
      {/* Spacer to prevent content from being hidden behind the floating nav.
          Extra height: 72px nav + 16px margin + safe area for home indicator. */}
      <div className="lg:hidden" style={{ height: 'calc(5.5rem + env(safe-area-inset-bottom))' }} />

      {/* Floating capsule nav.
          - Fixed to bottom, with margin from edges
          - rounded-full capsule shape
          - backdrop-blur for glass effect
          - shadow-card for premium depth
          - safe-area-inset-bottom padding so it floats above the home indicator */}
      <nav
        className="fixed left-1/2 -translate-x-1/2 z-40 lg:hidden"
        style={{
          bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          width: 'calc(100% - 1.5rem)',
          maxWidth: '32rem',
        }}
      >
        <div
          className="flex items-center justify-around h-14 px-2 rounded-full bg-background/90 backdrop-blur-xl border border-border/60 shadow-card relative"
        >
          {/* Left side: Dashboard + Sales */}
          {visibleTabs.slice(0, 2).map((tab) => {
            const Icon = tab.icon
            const isActive = currentView === tab.view
            return (
              <button
                key={tab.view}
                onClick={() => { haptic.click(); setView(tab.view) }}
                className={cn(
                  'flex items-center justify-center gap-1.5 h-10 px-3 rounded-full transition-all',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-label={t(tab.labelKey) || tab.label}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                {isActive && (
                  <span className="text-xs font-semibold">{t(tab.labelKey) || tab.label}</span>
                )}
              </button>
            )
          })}

          {/* Center: New Sale button (elevated, breaks out of capsule) */}
          <div className="flex-shrink-0">
            <button
              onClick={() => { haptic.medium(); setView('new-sale') }}
              className="w-12 h-12 -mt-7 rounded-full bg-gradient-saffron text-white flex items-center justify-center shadow-lg shadow-primary/40 active:scale-95 transition-transform border-4 border-background"
              aria-label="New Sale"
            >
              <Plus className="w-6 h-6" strokeWidth={2.5} />
            </button>
          </div>

          {/* Right side: Inventory + More */}
          {visibleTabs.slice(2).map((tab) => {
            const Icon = tab.icon
            const isActive = currentView === tab.view
            return (
              <button
                key={tab.view}
                onClick={() => { haptic.click(); setView(tab.view) }}
                className={cn(
                  'flex items-center justify-center gap-1.5 h-10 px-3 rounded-full transition-all',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-label={t(tab.labelKey) || tab.label}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                {isActive && (
                  <span className="text-xs font-semibold">{t(tab.labelKey) || tab.label}</span>
                )}
              </button>
            )
          })}

          <button
            onClick={() => { haptic.click(); setView('more') }}
            className={cn(
              'flex items-center justify-center gap-1.5 h-10 px-3 rounded-full transition-all',
              isMoreActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="More"
          >
            <Menu className="w-5 h-5" strokeWidth={isMoreActive ? 2.5 : 2} />
            {isMoreActive && (
              <span className="text-xs font-semibold">More</span>
            )}
          </button>
        </div>
      </nav>
    </>
  )
}
