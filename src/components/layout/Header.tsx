'use client'

import { useState } from 'react'
import { useAppStore, type ViewType } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { Menu, Plus, Sparkles, ScanLine, ArrowLeft, Search, Sun, Moon, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'
import { useSession, signOut } from 'next-auth/react'
import { clearAllOfflineData } from '@/lib/offline-db'
import { offlineFetch } from '@/lib/offline-fetch'
import { useFeatureFlags } from '@/hooks/use-feature-flags'
import { NotificationCenter } from '@/components/common/NotificationCenter'
import { useShops } from '@/hooks/use-shops'
import { Store, ChevronDown, Check } from 'lucide-react'

const viewTitleKeys: Record<string, { titleKey: string; subtitleKey: string }> = {
  dashboard: { titleKey: 'nav.dashboard', subtitleKey: 'nav.dashboard' },
  inventory: { titleKey: 'nav.inventory', subtitleKey: 'nav.inventory' },
  sales: { titleKey: 'nav.sales', subtitleKey: 'nav.sales' },
  purchases: { titleKey: 'nav.purchases', subtitleKey: 'nav.purchases' },
  'income-expense': { titleKey: 'nav.income', subtitleKey: 'nav.income' },
  parties: { titleKey: 'nav.parties', subtitleKey: 'nav.parties' },
  scanner: { titleKey: 'nav.scanner', subtitleKey: 'nav.scanner' },
  reports: { titleKey: 'nav.reports', subtitleKey: 'nav.reports' },
  settings: { titleKey: 'nav.settings', subtitleKey: 'nav.settings' },
  'transaction-detail': { titleKey: 'nav.sales', subtitleKey: 'nav.sales' },
  'party-profile': { titleKey: 'nav.parties', subtitleKey: 'nav.parties' },
  'new-sale': { titleKey: 'action.new_sale', subtitleKey: 'action.new_sale' },
  'new-purchase': { titleKey: 'action.new_purchase', subtitleKey: 'action.new_purchase' },
}

// Views where "New Entry" should trigger a dialog (not navigate)
const dialogViews: ViewType[] = ['dashboard', 'inventory', 'sales', 'purchases', 'income-expense', 'parties']

export function Header() {
  const { currentView, setSidebarOpen, setView, fireTriggerNewEntry, previousView, setPreviousView, features, setFeature, setSearchOpen, selectedTransactionType } = useAppStore()
  const { isFlagEnabled } = useFeatureFlags()
  const { data: session } = useSession()
  const { t } = useTranslation()
  const { shops, activeShop, switchShop } = useShops()
  const [shopDropdownOpen, setShopDropdownOpen] = useState(false)
  const titleKeys = viewTitleKeys[currentView] || { titleKey: 'nav.dashboard', subtitleKey: 'nav.dashboard' }
  // Override for transaction detail - show Purchase Ledger if it's a purchase
  if (currentView === 'transaction-detail' && selectedTransactionType === 'purchase') {
    titleKeys.titleKey = 'nav.purchases'
    titleKeys.subtitleKey = 'nav.purchases'
  }
  const info = { title: t(titleKeys.titleKey), subtitle: t(titleKeys.subtitleKey) }

  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  const shopName = settingData?.setting?.shopName || 'My Shop'

  const isDetailView = currentView === 'transaction-detail' || currentView === 'party-profile' || currentView === 'new-sale' || currentView === 'new-purchase'
  const isNewEntryView = currentView === 'new-sale' || currentView === 'new-purchase'
  const showNewEntry = dialogViews.includes(currentView) && !isDetailView && !isNewEntryView

  const handleNewEntry = () => {
    if (currentView === 'dashboard') {
      // From dashboard, navigate to full-page new sale
      setPreviousView('dashboard')
      setView('new-sale')
    } else if (currentView === 'sales') {
      setPreviousView('sales')
      setView('new-sale')
    } else if (currentView === 'purchases') {
      setPreviousView('purchases')
      setView('new-purchase')
    } else if (dialogViews.includes(currentView)) {
      // For other dialog views (inventory, parties, income-expense), fire the trigger
      fireTriggerNewEntry()
    }
  }

  const handleBack = () => {
    if (previousView) {
      setView(previousView)
    } else {
      setView('dashboard')
    }
    setPreviousView(null)
  }

  const newEntryLabel = (() => {
    switch (currentView) {
      case 'dashboard': return t('action.new_sale')
      case 'inventory': return t('action.add_product')
      case 'sales': return t('action.new_sale')
      case 'purchases': return t('action.new_purchase')
      case 'income-expense': return t('action.new_entry')
      case 'parties': return t('action.add_party')
      default: return 'New Entry'
    }
  })()

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Hamburger menu hidden on mobile — use "More" tab in bottom nav instead.
              On desktop, sidebar is always visible so no hamburger needed. */}
          {isDetailView && (
            <button
              onClick={handleBack}
              className="p-2.5 -ml-2 rounded-lg hover:bg-muted flex items-center gap-1 text-sm font-medium min-h-[44px]"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-lg lg:text-xl font-bold tracking-tight truncate">{info.title}</h2>
            <p className="text-xs text-muted-foreground truncate hidden sm:block">{info.subtitle}</p>
          </div>

          {/* Mobile shop switcher — shows current shop name, tap to switch */}
          {shops.length > 1 && (
            <div className="relative lg:hidden">
              <button
                onClick={() => setShopDropdownOpen(!shopDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 hover:bg-muted transition"
              >
                <Store className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-xs font-semibold truncate max-w-[80px]">{activeShop?.name || 'Shop'}</span>
                <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${shopDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {shopDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                  {shops.map(shop => (
                    <button
                      key={shop.id}
                      onClick={() => { switchShop(shop.id); setShopDropdownOpen(false) }}
                      className={`w-full flex items-center gap-2 p-2.5 hover:bg-muted transition text-left ${activeShop?.id === shop.id ? 'bg-primary/5' : ''}`}
                    >
                      <Store className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-medium flex-1 truncate">{shop.name}</span>
                      {activeShop?.id === shop.id && <Check className="w-3.5 h-3.5 text-primary" />}
                    </button>
                  ))}
                  <button
                    onClick={() => { setView('settings'); setShopDropdownOpen(false) }}
                    className="w-full flex items-center gap-2 p-2.5 hover:bg-muted transition text-left border-t border-border"
                  >
                    <Plus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span className="text-xs font-medium">Add New Shop</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Global Search / Command Palette button */}
          {features?.globalSearch && (
            <>
              {/* Desktop: full button with label */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSearchOpen(true)}
                className="hidden sm:flex gap-2"
                title="Search & Commands (Ctrl+K)"
              >
                <Search className="w-4 h-4" />
                <span className="hidden lg:inline text-xs text-muted-foreground">Ctrl+K</span>
              </Button>
              {/* Mobile: icon-only button */}
              <Button
                size="iconTouch"
                variant="ghost"
                onClick={() => setSearchOpen(true)}
                className="sm:hidden"
                title="Search & Commands"
                aria-label="Search"
              >
                <Search className="w-5 h-5" />
              </Button>
            </>
          )}

          {/* Notification center — bell icon with alerts */}
          <NotificationCenter />

          {/* Dark mode toggle */}
          {features?.darkMode !== undefined && (
            <Button
              size="iconTouch"
              variant="ghost"
              onClick={() => setFeature('darkMode', !features?.darkMode)}
              className="lg:size-9 lg:h-9"
              title={features?.darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {features?.darkMode ? <Sun className="w-5 h-5 lg:w-4 lg:h-4" /> : <Moon className="w-5 h-5 lg:w-4 lg:h-4" />}
            </Button>
          )}

          {/* Quick action: AI Scan - desktop only (mobile uses dashboard hero button) */}
          {currentView !== 'scanner' && isFlagEnabled('ai_scanner') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setView('scanner')}
              className="hidden lg:flex gap-2 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden xl:inline">{t('action.scan_bill')}</span>
            </Button>
          )}

          {/* New Entry button — context-aware.
              Desktop: full button with label (hidden on mobile, mobile uses bottom nav +).
              Mobile: icon-only button shown on Inventory, Parties, Income/Expense views
              (where there's no other quick-add affordance).
              Hidden on Dashboard (has hero buttons), Sales (has bottom nav +),
              and detail/form views. */}
          {showNewEntry && (
            <>
              {/* Desktop: full button */}
              <Button
                size="sm"
                onClick={handleNewEntry}
                className="hidden lg:flex bg-gradient-saffron gap-2 shadow-md hover:opacity-90"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden xl:inline">{newEntryLabel}</span>
              </Button>

              {/* Mobile: icon-only button for non-Sales/Dashboard views */}
              {currentView !== 'dashboard' && currentView !== 'sales' && (
                <Button
                  size="iconTouch"
                  onClick={handleNewEntry}
                  className="lg:hidden bg-gradient-saffron shadow-md hover:opacity-90"
                  title={newEntryLabel}
                  aria-label={newEntryLabel}
                >
                  <Plus className="w-5 h-5" />
                </Button>
              )}
            </>
          )}

          {/* Shop name badge + user menu */}
          <div className="hidden lg:flex items-center gap-2 pl-3 ml-1 border-l border-border">
            <div className="w-8 h-8 rounded-full bg-gradient-saffron flex items-center justify-center text-white text-xs font-bold">
              {shopName.charAt(0)}
            </div>
            <div className="text-xs">
              <p className="font-semibold leading-tight">{shopName}</p>
              <p className="text-muted-foreground leading-tight">{session?.user?.email || 'Owner'}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 ml-1"
              onClick={async () => { await clearAllOfflineData(); signOut({ callbackUrl: '/' }) }}
              title={t('action.sign_out')}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>

          {/* Mobile logout button */}
          <Button
            variant="ghost"
            size="iconTouch"
            className="lg:hidden"
            onClick={async () => { await clearAllOfflineData(); signOut({ callbackUrl: '/' }) }}
            title={t('action.sign_out')}
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </header>
  )
}
