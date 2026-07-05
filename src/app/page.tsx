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
import { useDashboardThisMonth } from '@/hooks/use-dashboard'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { MoreScreen } from '@/components/layout/MoreScreen'
import { Onboarding } from '@/components/layout/Onboarding'
import { ThemePicker } from '@/components/common/ThemePicker'
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
import { PaywallModal } from '@/components/common/PaywallModal'
import { SplashScreen } from '@/components/common/SplashScreen'
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
const AIComparison = dynamic(() => import('@/components/settings/AIComparison').then(m => ({ default: m.AIComparison })), { ssr: false })
const AIUsage = dynamic(() => import('@/components/settings/AIUsage').then(m => ({ default: m.AIUsage })), { ssr: false })

export default function Home() {
  const { session, status, isOfflineSession } = useOfflineSession()
  const { currentView, features, triggerRefresh, setView } = useAppStore()
  useBrowserBackButton() // Enable browser back button to navigate within app
  const { shouldShowRatePrompt, onRated, onDismiss } = useRatePrompt()
  const { canAccess } = useStaffPermissions()
  const { paywallOpen, paywallFeature, closePaywall } = useAppStore()
  const queryClient = useQueryClient()
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [tourDone, setTourDone] = useState(false)
  const [themePickerDone, setThemePickerDone] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showSplash, setShowSplash] = useState(true)

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

  // Check if theme picker has been completed (first-run only)
  useEffect(() => {
    if (mounted && session) {
      try {
        const done = localStorage.getItem('bahikhata-theme-picker-done') === 'true'
        setThemePickerDone(done)
      } catch {
        setThemePickerDone(true)
      }
    }
  }, [mounted, session])

  // 🔒 PERFORMANCE FIX (auditor P0): Targeted invalidation instead of blanket.
  // Was: invalidateQueries() (no args) → refetches ALL active queries including
  // dashboard → AND triggerRefresh() bumps refreshKey → dashboard refetches AGAIN.
  // This cascade turned 3 dashboard calls into 15.
  // Now: only invalidate specific keys that actually changed, and only
  // trigger refresh if there were actually pending writes that synced.
  useEffect(() => {
    const unsub = onSyncComplete(async () => {
      // Check if there were actually pending writes
      const { getPendingWriteCount } = await import('@/lib/offline-db')
      const pending = await getPendingWriteCount()
      if (pending === 0) return // no writes synced — don't invalidate anything

      // Targeted invalidation — only refetch what might have changed
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['parties'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      // Note: triggerRefresh() is intentionally NOT called here — it bumps
      // refreshKey which changes the dashboard query key → forces a NEW
      // fetch even if the data is fresh. The targeted invalidation above
      // already handles refetching with the SAME key (deduped).
    })
    return unsub
  }, [queryClient])

  // Pre-cache all key data right after login (only once per session, only online)
  // This populates IndexedDB so the user can go offline anytime.
  const precacheDone = useRef(false)

  // 🔒 PERFORMANCE: Warm up Neon DB before any API calls.
  // Neon's free tier auto-pauses after 5 min. This ping wakes it up so the
  // real API calls (dashboard, settings, etc.) don't have to wait 10-20s
  // for the cold start. Fire-and-forget — we don't block on it.
  const warmupDone = useRef(false)
  useEffect(() => {
    if (
      status === 'authenticated' &&
      session &&
      !warmupDone.current &&
      isOnline()
    ) {
      warmupDone.current = true
      fetch('/api/warmup').catch(() => {})
    }
  }, [status, session])

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
  // 🔒 V8 P3: Removed /api/seed from the initial load path. Was: 3 COUNT
  // queries on every app open, on the critical path. Now: the dashboard API
  // already returns productCount + partyCount — if both are 0, the user has
  // no data and we show the onboarding modal. This saves 3 DB queries on
  // every page load, and removes a request from the cold-start thundering
  // herd.
  // The /api/seed GET endpoint still exists for the Onboarding component to
  // call explicitly (if needed), but it's no longer fired automatically on
  // every app open.

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

  // 🔒 V8 P3: Use dashboard data (already fetched by the Dashboard component)
  // to determine if the user has any data. Was: separate /api/seed call with
  // 3 COUNT queries on every app open. Now: reuses the shared React Query
  // cache — no extra DB queries.
  const { data: dashboardData } = useDashboardThisMonth()
  const hasNoData = dashboardData?.kpis?.productCount === 0 && dashboardData?.kpis?.partyCount === 0

  const showOnboarding = !onboardingDismissed && !isOfflineSession && dashboardData !== undefined && hasNoData && themePickerDone
  const showThemePicker = !themePickerDone && !!session

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
        <ThemePicker open={showThemePicker} onDone={() => setThemePickerDone(true)} />
        <Onboarding open={showOnboarding} onDone={() => setOnboardingDismissed(true)} />
        {features?.pwaInstall && <PWAInstallPrompt />}
        {!showOnboarding && <OnboardingTour onDone={() => setTourDone(true)} />}
        {!showOnboarding && tourDone && <ConsentModal />}
        <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />
        <PaywallModal feature={paywallFeature} open={paywallOpen} onClose={closePaywall} />
      </div>
    )
  }

  return (
    <>
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
      <div className="flex min-h-screen bg-background">
      {features?.keyboardShortcuts && <KeyboardShortcuts />}
      {features?.globalSearch && <GlobalSearch />}

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <OfflineIndicator />
        <Header />

        <main className="flex-1 p-4 lg:p-6 w-full min-w-0 pb-28 lg:pb-6">
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
            enabled={!['new-sale', 'new-purchase', 'transaction-detail', 'party-profile', 'scanner', 'pricing', 'reports', 'settings', 'ai-comparison', 'ai-usage'].includes(currentView)}
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
            {currentView === 'ai-comparison' && <AIComparison />}
            {currentView === 'ai-usage' && <AIUsage />}
            {currentView === 'transaction-detail' && <TransactionDetail />}
            {currentView === 'party-profile' && <PartyProfile />}
            {currentView === 'new-sale' && <TransactionEntry type="sale" />}
            {currentView === 'new-purchase' && <TransactionEntry type="purchase" />}
          </PullToRefresh>
        </main>

        <footer className="mt-auto border-t border-border py-3 px-4 lg:px-6 text-center text-[11px] text-muted-foreground no-print hidden lg:block">
          <p>EkBook — Made with love for Bharat</p>
        </footer>
      </div>

      <MobileBottomNav />

      <ThemePicker open={showThemePicker} onDone={() => setThemePickerDone(true)} />
      <Onboarding open={showOnboarding} onDone={() => setOnboardingDismissed(true)} />

      {features?.pwaInstall && <PWAInstallPrompt />}
      {/* Only show tour + consent AFTER onboarding is dismissed.
          Tour shows first, then ConsentModal shows after tour is done.
          This prevents focus-trap conflicts between Radix Dialog (ConsentModal)
          and the tour's plain div overlay (z-[100]). */}
      {!showOnboarding && <OnboardingTour onDone={() => setTourDone(true)} />}
      {!showOnboarding && tourDone && <ConsentModal />}
      <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />
      <PaywallModal feature={paywallFeature} open={paywallOpen} onClose={closePaywall} />
      </div>
    </>
  )
}
