'use client'

import { useState } from 'react'
import { useAppStore, type ViewType } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { Plus, Sparkles, ArrowLeft, Search, Check, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { getInitials, cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { useQuery } from '@tanstack/react-query'
import { useSession, signOut } from 'next-auth/react'
import { clearAllOfflineData } from '@/lib/offline-db'
import { offlineFetch } from '@/lib/offline-fetch'
import { useFeatureFlags } from '@/hooks/use-feature-flags'
import { NotificationCenter } from '@/components/common/NotificationCenter'

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
  // 🔒 V26 P6: Added missing title keys (was: fell back to 'nav.dashboard')
  'new-estimate': { titleKey: 'nav.label.estimates', subtitleKey: 'nav.label.estimates' },
  'document-vault': { titleKey: 'nav.label.document-vault', subtitleKey: 'nav.label.document-vault' },
  'ai-usage': { titleKey: 'nav.label.ai-usage', subtitleKey: 'nav.label.ai-usage' },
  'ai-comparison': { titleKey: 'nav.label.ai-comparison', subtitleKey: 'nav.label.ai-comparison' },
  'pricing': { titleKey: 'nav.label.subscription', subtitleKey: 'nav.label.subscription' },
}

// Views where "New Entry" should trigger a dialog (not navigate)
const dialogViews: ViewType[] = ['dashboard', 'inventory', 'sales', 'purchases', 'income-expense', 'parties']

export function Header() {
  const { currentView, setView, fireTriggerNewEntry, previousView, setPreviousView, features, setSearchOpen, selectedTransactionType } = useAppStore()
  // 🔒 V26 N20: Removed `setFeature` from destructure — was unused in Header.
  const { isFlagEnabled } = useFeatureFlags()
  const { data: session } = useSession()
  const { t } = useTranslation()
  // 🔒 V26 FIX N4 follow-up: useShops() call + shopDropdown state/ref/effect
  // removed — the Header switcher UI was deleted (N4) but its dead machinery
  // (and an unnecessary shops query subscription) was left behind.
  // 🔒 V26 N10: Compute titleKeys WITHOUT mutating the module-level viewTitleKeys
  // object. Was: `titleKeys.titleKey = 'nav.purchases'` mutated the shared object,
  // so after viewing one purchase, every subsequent sale detail showed "Purchase Ledger".
  const baseTitleKeys = viewTitleKeys[currentView] || { titleKey: 'nav.dashboard', subtitleKey: 'nav.dashboard' }
  const titleKeys = (currentView === 'transaction-detail' && selectedTransactionType === 'purchase')
    ? { titleKey: 'nav.purchases', subtitleKey: 'nav.purchases' }
    : baseTitleKeys
  const info = { title: t(titleKeys.titleKey), subtitle: t(titleKeys.subtitleKey) }

  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  const shopName = settingData?.setting?.shopName || 'My Shop'
  const ownerName = settingData?.setting?.ownerName || session?.user?.name || 'Shop Owner'

  // 🔒 V21-012 fix: Added 'pricing' and 'ai-comparison' and 'ai-usage' to
  // isDetailView so they show a back button when navigated from Account page.
  // 🔒 V26 FIX N8+N15: pricing / ai-comparison / ai-usage REMOVED from this
  // list — those pages render their own back button, so the Header back was a
  // second, sometimes-disagreeing one (AIUsage's hardcoded 'account' vs this
  // previousView). One back per screen; the in-page ones now use previousView.
  // settings + document-vault ADDED — they previously had NO back affordance
  // on either platform (desktop users had to click an unrelated sidebar item).
  const isDetailView = currentView === 'transaction-detail' || currentView === 'party-profile' || currentView === 'new-sale' || currentView === 'new-purchase' || currentView === 'new-estimate' || currentView === 'settings' || currentView === 'document-vault'
  const isNewEntryView = currentView === 'new-sale' || currentView === 'new-purchase' || currentView === 'new-estimate'
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

  // 🔒 V21-010 (Phase 2d): Click avatar → open Account page
  const handleAccountClick = () => {
    haptic.click()
    setPreviousView(currentView)
    useAppStore.getState().setAccountOriginView(currentView)
    setView('account')
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
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-border" style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 'calc(3.5rem + env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Hamburger menu hidden on mobile — use "More" tab in bottom nav instead.
              On desktop, sidebar is always visible so no hamburger needed. */}
          {isDetailView && (
            <button
              onClick={handleBack}
              aria-label="Go back"
              className="p-2.5 -ml-2 rounded-lg hover:bg-muted flex items-center gap-1 text-sm font-medium min-h-[44px]"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {/* 🔒 V21-010 (Phase 2d): Profile avatar — click opens Account page.
              Replaces the "Dashboard" text title on the left side.
              Inspired by CRED, PhonePe (avatar in top-left).
              🔒 V21-010 fix: Hidden on desktop (lg:hidden) — desktop has the
              avatar on the RIGHT side instead, so it only appears once. */}
          {!isDetailView && (
            <button
              onClick={handleAccountClick}
              className="flex-shrink-0 active:scale-95 transition lg:hidden"
              title="View Account"
              aria-label="View Account"
            >
              <Avatar className="w-9 h-9 border-2 border-primary/20 hover:border-primary/40 transition">
                <AvatarFallback className="bg-gradient-saffron text-white text-sm font-bold">
                  {getInitials(ownerName)}
                </AvatarFallback>
              </Avatar>
            </button>
          )}

          {/* Page title — only show on non-dashboard views (dashboard has the greeting) */}
          {currentView !== 'dashboard' && (
            <div className="min-w-0">
              <h2 className="text-lg lg:text-xl font-bold tracking-tight truncate">{info.title}</h2>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">{info.subtitle}</p>
            </div>
          )}

          {/* 🔒 V26 FIX N4: Mobile shop switcher REMOVED — was cosmetic. */}
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
                <Search className="w-6 h-6" />
              </Button>
            </>
          )}

          {/* 🔒 AUDIT V25 FIX §2.4 (Batch 2): NotificationCenter now persistent
              on ALL views (was gated to currentView === 'dashboard'). The bell
              + its low-stock/receivable alerts disappeared the moment the user
              navigated anywhere — desktop users living in the Sales split-view
              never saw notifications. NotificationCenter uses useDashboardThisMonth
              (React Query cache) so it doesn't make extra API calls per view. */}
          <NotificationCenter />

          {/* 🔒 V8 U7: Language toggle — prominent in header for regional users.
              Cycles through the available languages. Quick access from any screen. */}
          <LanguageToggle />

          {/* Dark mode toggle — removed from header, now in Settings */}

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

          {/* 🔒 V21-011 fix: Removed desktop avatar from top-right — it's now
              at the bottom of the sidebar. Having it in both places was
              redundant. The sidebar avatar opens the same Account page. */}

          {/* Logout button — removed from header, now in Account page */}
        </div>
      </div>
    </header>
  )
}

/**
 * 🔒 V8 U7: LanguageToggle — quick language switcher in the header.
 * 🔒 FIX: Was a cycle button (click through 10 languages one at a time).
 * Now a dropdown popover — user picks their language from a list.
 * Also fixes the toggle bug where display didn't match the language
 * (was saving voiceLang instead of language to the server).
 *
 * 🔒 V26 Phase 6 §1.4: Converted from hand-rolled absolute-positioned menu
 * with outside-click useEffect to Radix DropdownMenu. Gets keyboard nav
 * (arrow keys, typeahead), focus management, Escape-to-close, and focus
 * return for free. Was: no keyboard support, no focus return.
 */
function LanguageToggle() {
  const { language, setLanguage } = useTranslation()
  const [saving, setSaving] = useState(false)

  const LANGS = [
    { code: 'en', label: 'EN', name: 'English' },
    { code: 'hi', label: 'हिं', name: 'हिंदी' },
    { code: 'gu', label: 'ગુ', name: 'ગુજરાતી' },
    { code: 'mr', label: 'मरा', name: 'मराठी' },
    { code: 'ta', label: 'தமி', name: 'தமிழ்' },
    { code: 'te', label: 'తెలు', name: 'తెలుగు' },
  ]

  const currentLang = LANGS.find(l => l.code === language) || LANGS[0]

  const selectLang = async (code: string) => {
    setLanguage(code)
    setSaving(true)
    try {
      await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: code }),
        offline: { invalidate: ['/api/settings'] },
      })
    } catch {
      // Non-critical — language is set locally even if save fails
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          className="px-2 py-1 gap-1"
          title={`Language: ${currentLang.name}`}
          aria-label={`Select language (current: ${currentLang.name})`}
        >
          <Globe className="w-4 h-4" />
          <span className="text-xs font-bold">{currentLang.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {LANGS.map(lang => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => selectLang(lang.code)}
            className={cn(
              'flex items-center justify-between cursor-pointer',
              lang.code === language && 'bg-primary/10 font-semibold text-primary'
            )}
          >
            <span>{lang.name}</span>
            {lang.code === language && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
