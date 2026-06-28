'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useOfflineSession } from '@/hooks/use-offline-session'
import { useBrowserBackButton } from '@/hooks/use-browser-back-button'
import { PullToRefresh } from '@/hooks/use-pull-to-refresh'
import { isOnline, onSyncComplete } from '@/lib/offline-fetch'
import { precacheData } from '@/lib/precache'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { MoreScreen } from '@/components/layout/MoreScreen'
import { Onboarding } from '@/components/layout/Onboarding'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { Inventory } from '@/components/inventory/Inventory'
import { Ledger } from '@/components/ledger/Ledger'
import { LedgerSplitView } from '@/components/ledger/LedgerSplitView'
import { IncomeExpense } from '@/components/income/IncomeExpense'
import { Parties } from '@/components/parties/Parties'
import { KeyboardShortcuts } from '@/components/common/KeyboardShortcuts'
import { GlobalSearch } from '@/components/common/GlobalSearch'
import { OfflineIndicator } from '@/components/common/OfflineIndicator'
import { PWAInstallPrompt } from '@/components/common/PWAInstallPrompt'
import { OnboardingTour } from '@/components/common/OnboardingTour'
import { ConsentModal } from '@/components/common/ConsentModal'
import { RatePromptModal } from '@/components/common/RatePromptModal'
import { useRatePrompt } from '@/hooks/use-rate-prompt'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'

// Lazy-load heavy components that are only used occasionally.
// This splits them into separate JS chunks, loaded on-demand when the user
// navigates to that view. Reduces initial JS bundle by ~40-60%.
const TransactionDetail = dynamic(() => import('@/components/ledger/TransactionDetail').then(m => ({ default: m.TransactionDetail })), { ssr: false })
const TransactionEntry = dynamic(() => import('@/components/ledger/TransactionEntry').then(m => ({ default: m.TransactionEntry })), { ssr: false })
const PartyProfile = dynamic(() => import('@/components/parties/PartyProfile').then(m => ({ default: m.PartyProfile })), { ssr: false })
const BillScanner = dynamic(() => import('@/components/scanner/BillScanner').then(m => ({ default: m.BillScanner })), { ssr: false })
const Reports = dynamic(() => import('@/components/reports/Reports').then(m => ({ default: m.Reports })), { ssr: false })
const Settings = dynamic(() => import('@/components/settings/Settings').then(m => ({ default: m.Settings })), { ssr: false })
const PricingPlans = dynamic(() => import('@/components/subscription/PricingPlans').then(m => ({ default: m.PricingPlans })), { ssr: false })

export default function Home() {
  const { session, status, isOfflineSession } = useOfflineSession()
  const { currentView, features, triggerRefresh, setView } = useAppStore()
  useBrowserBackButton() // Enable browser back button to navigate within app
  const { shouldShowRatePrompt, onRated, onDismiss } = useRatePrompt()
  const { canAccess } = useStaffPermissions()
  const queryClient = useQueryClient()
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [tourDone, setTourDone] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Redirect staff to their first allowed view if they try to access a blocked module
  useEffect(() => {
    if (status !== 'authenticated' || !session) return
    const moduleMap: Record<string, string> = {
      'dashboard': 'dashboard',
      'sales': 'sales',
      'purchases': 'purchases',
      'inventory': 'inventory',
      'scanner': 'scanner',
      'reports': 'reports',
      'income-expense': 'incomeExpense',
      'parties': 'parties',
      'settings': 'settings',
    }
    const moduleKey = moduleMap[currentView]
    if (moduleKey && !canAccess(moduleKey as any)) {
      // Redirect to first allowed view
      const firstAllowed = ['sales', 'purchases', 'inventory', 'scanner', 'dashboard'].find(
        (v) => canAccess(v as any)
      )
      setView((firstAllowed || 'sales') as any)
    }
  }, [currentView, session, status, canAccess, setView])

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true))
  }, [])

  // When sync completes (after coming back online), invalidate all queries
  // so components refetch fresh data from the server.
  useEffect(() => {
    const unsub = onSyncComplete(() => {
      queryClient.invalidateQueries()
      triggerRefresh()
    })
    return unsub
  }, [queryClient, triggerRefresh])

  // Pre-cache all key data right after login (only once per session, only online)
  // This populates IndexedDB so the user can go offline anytime.
  const precacheDone = useRef(false)
  useEffect(() => {
    if (
      status === 'authenticated' &&
      session &&
      !precacheDone.current &&
      isOnline()
    ) {
      precacheDone.current = true
      precacheData().catch(() => {})
    }
  }, [status, session])

  // Skip the seed check entirely when offline (we can't reach the server, and
  // returning undefined would incorrectly trigger onboarding).
  const online = typeof window !== 'undefined' ? isOnline() : true
  const { data: seedStatus } = useQuery({
    queryKey: ['seed-status'],
    enabled: status === 'authenticated' && !!session && online,
    queryFn: async () => {
      const r = await fetch('/api/seed')
      return r.json()
    },
  })

  // During SSR and first client render, show loading
  // This prevents hydration mismatch
  if (!mounted || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!session) {
    return <AuthScreen />
  }

  const showOnboarding = !onboardingDismissed && !isOfflineSession && seedStatus !== undefined && !seedStatus.seeded

  // More screen renders full-screen (no sidebar, no regular header)
  if (currentView === 'more') {
    return (
      <div className="flex min-h-screen bg-background">
        {features?.keyboardShortcuts && <KeyboardShortcuts />}
        {features?.globalSearch && <GlobalSearch />}
        <div className="flex-1 flex flex-col min-w-0">
          <OfflineIndicator />
          <MoreScreen />
        </div>
        <MobileBottomNav />
        <Onboarding open={showOnboarding} onDone={() => setOnboardingDismissed(true)} />
        {features?.pwaInstall && <PWAInstallPrompt />}
        {!showOnboarding && <OnboardingTour onDone={() => setTourDone(true)} />}
        {!showOnboarding && tourDone && <ConsentModal />}
        <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      {features?.keyboardShortcuts && <KeyboardShortcuts />}
      {features?.globalSearch && <GlobalSearch />}

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <OfflineIndicator />
        <Header />

        <main className="flex-1 p-4 lg:p-6 w-full min-w-0">
          {/* PullToRefresh wraps all main content views. Disabled on form/detail
              views where pull-down might interfere with scrolling. */}
          <PullToRefresh
            onRefresh={async () => {
              // Use refetchQueries with 'active' type — waits for active
              // queries to refetch and resolves when done. No fixed timeout.
              // Cap with a 3s timeout in case a query hangs.
              await Promise.race([
                queryClient.refetchQueries({ type: 'active' }),
                new Promise((r) => setTimeout(r, 3000)),
              ])
            }}
            enabled={!['new-sale', 'new-purchase', 'transaction-detail', 'party-profile', 'scanner', 'pricing'].includes(currentView)}
          >
            {currentView === 'dashboard' && <Dashboard />}
            {currentView === 'inventory' && <Inventory />}
            {currentView === 'sales' && <LedgerSplitView type="sale" />}
            {currentView === 'purchases' && <LedgerSplitView type="purchase" />}
            {currentView === 'income-expense' && <IncomeExpense />}
            {currentView === 'parties' && <Parties />}
            {currentView === 'scanner' && <BillScanner />}
            {currentView === 'reports' && <Reports />}
            {currentView === 'settings' && <Settings />}
            {currentView === 'pricing' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setView('more')} className="p-2 -ml-2 rounded-lg hover:bg-muted">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h2 className="text-xl font-bold">Plans &amp; Pricing</h2>
                    <p className="text-xs text-muted-foreground">Choose the plan that fits your business</p>
                  </div>
                </div>
                <PricingPlans />
              </div>
            )}
            {currentView === 'transaction-detail' && <TransactionDetail />}
            {currentView === 'party-profile' && <PartyProfile />}
            {currentView === 'new-sale' && <TransactionEntry type="sale" />}
            {currentView === 'new-purchase' && <TransactionEntry type="purchase" />}
          </PullToRefresh>
        </main>

        <footer className="mt-auto border-t border-border py-3 px-4 lg:px-6 text-center text-[11px] text-muted-foreground no-print hidden lg:block">
          <p>BahiKhata Pro — Made with love for Bharat</p>
        </footer>
      </div>

      <MobileBottomNav />

      <Onboarding open={showOnboarding} onDone={() => setOnboardingDismissed(true)} />

      {features?.pwaInstall && <PWAInstallPrompt />}
      {/* Only show tour + consent AFTER onboarding is dismissed.
          Tour shows first, then ConsentModal shows after tour is done.
          This prevents focus-trap conflicts between Radix Dialog (ConsentModal)
          and the tour's plain div overlay (z-[100]). */}
      {!showOnboarding && <OnboardingTour onDone={() => setTourDone(true)} />}
      {!showOnboarding && tourDone && <ConsentModal />}
      <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />
    </div>
  )
}
