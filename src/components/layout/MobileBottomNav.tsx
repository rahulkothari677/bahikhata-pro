'use client'

/**
 * MobileBottomNav — bottom navigation bar for mobile devices.
 *
 * Shows on screens < lg (1024px). Hidden on desktop where the sidebar
 * is always visible.
 *
 * 5 tabs:
 *   [Dashboard] [Sales] [ + New ] [Inventory] [More]
 *
 * The center "+" button is elevated and highlighted — it's the most
 * important action (record a new sale). Tapping it goes to the New Sale
 * page directly.
 *
 * "More" opens the sidebar (which has all other views: Purchases,
 * Income/Expense, Parties, Scanner, Reports, Settings).
 */

import { useAppStore, type ViewType } from '@/store/app-store'
import { LayoutDashboard, ShoppingCart, Package, Menu, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/use-translation'
import { haptic } from '@/lib/haptic'

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
  const { currentView, setView, setSidebarOpen, sidebarOpen } = useAppStore()
  const { t } = useTranslation()

  // Toggle sidebar: if open, close; if closed, open. Makes "More" tab a toggle.
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  // Don't show on auth screen or when creating a new entry (those have their own back button)
  const hideOnViews: ViewType[] = ['new-sale', 'new-purchase', 'transaction-detail', 'party-profile']
  if (hideOnViews.includes(currentView)) return null

  const isMoreActive = ['purchases', 'income-expense', 'parties', 'scanner', 'reports', 'settings'].includes(currentView)

  return (
    <>
      {/* Spacer to prevent content from being hidden behind the nav */}
      <div className="h-16 lg:hidden" />

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-background/95 backdrop-blur-md border-t border-border">
        <div className="flex items-center justify-around h-16 px-2 relative">
          {/* Left side: Dashboard + Sales */}
          {TABS.slice(0, 2).map((tab) => {
            const Icon = tab.icon
            const isActive = currentView === tab.view
            return (
              <button
                key={tab.view}
                onClick={() => { haptic.click(); setView(tab.view) }}
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

          {/* Center: New Sale button (elevated) */}
          <div className="flex-1 flex justify-center">
            <button
              onClick={() => { haptic.medium(); setView('new-sale') }}
              className="w-12 h-12 -mt-6 rounded-full bg-gradient-saffron text-white flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform"
              aria-label="New Sale"
            >
              <Plus className="w-6 h-6" strokeWidth={2.5} />
            </button>
          </div>

          {/* Right side: Inventory + More */}
          {TABS.slice(2).map((tab) => {
            const Icon = tab.icon
            const isActive = currentView === tab.view
            return (
              <button
                key={tab.view}
                onClick={() => { haptic.click(); setView(tab.view) }}
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
            onClick={() => { haptic.click(); toggleSidebar() }}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
              isMoreActive || sidebarOpen ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-label="More"
          >
            <Menu className="w-5 h-5" strokeWidth={isMoreActive || sidebarOpen ? 2.5 : 2} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
