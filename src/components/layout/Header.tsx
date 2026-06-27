'use client'

import { useAppStore, type ViewType } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { Menu, Plus, Sparkles, ScanLine, ArrowLeft, Search, Sun, Moon, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'
import { useSession, signOut } from 'next-auth/react'
import { clearAllOfflineData } from '@/lib/offline-db'
import { offlineFetch } from '@/lib/offline-fetch'
import { useFeatureFlags } from '@/hooks/use-feature-flags'

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
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
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
        </div>

        <div className="flex items-center gap-2">
          {/* Global Search button (Ctrl+K) */}
          {features?.globalSearch && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSearchOpen(true)}
              className="hidden sm:flex gap-2"
              title="Search (Ctrl+K)"
            >
              <Search className="w-4 h-4" />
              <span className="hidden lg:inline text-xs text-muted-foreground">Ctrl+K</span>
            </Button>
          )}

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

          {/* New Entry button - desktop only (mobile uses bottom nav center +) */}
          {showNewEntry && (
            <Button
              size="sm"
              onClick={handleNewEntry}
              className="hidden lg:flex bg-gradient-saffron gap-2 shadow-md hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden xl:inline">{newEntryLabel}</span>
            </Button>
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
