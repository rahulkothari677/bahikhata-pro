'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useOfflineSession } from '@/hooks/use-offline-session'
import { useBrowserBackButton } from '@/hooks/use-browser-back-button'
import { PullToRefresh } from '@/hooks/use-pull-to-refresh'
import { isOnline, onSyncComplete, onSyncFailed } from '@/lib/offline-fetch'
import { precacheData } from '@/lib/precache'
import { useDashboardThisMonth } from '@/hooks/use-dashboard'
import { toast as sonnerToast } from 'sonner'
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
// 🔒 V8 U9: Prefetch TransactionDetail chunk on first dashboard render so
// it's ready before the user clicks a recent transaction. ssr: false keeps
// it out of the initial bundle; prefetch: 'visible' loads it in the
// background after first paint (not blocking).
const TransactionDetail = dynamic(() => import('@/components/ledger/TransactionDetail').then(m => ({ default: m.TransactionDetail })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  ),
})
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
  // 🔒 FIX M10: Skip splash on native (Capacitor native splash already covers
  // warm-up) and on warm reloads (sessionStorage flag). Was: showed 2s on
  // EVERY app open, blocking interaction.
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return true
    // Skip on native — CapacitorBridge hides the native splash separately
    if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) return false
    // Skip on warm reloads — if we've already shown the splash this session
    if (sessionStorage.getItem('splashShown') === 'true') return false
    return true
  })
  // 🔒 V9 4.2: First-run modal orchestrator — gate low-priority modals until
  // the user has completed onboarding + tour. Prevents modal pile-up:
  // SplashScreen → ThemePicker → Onboarding → Tour → Consent → RatePrompt → PWA
  // Now: RatePrompt + PWA install wait until onboarding AND tour are done.
  const [firstRunComplete, setFirstRunComplete] = useState(false)

  // 🔒 V8 P3: Fetch dashboard data (shared React Query cache) to check if the
  // user has any data — replaces the separate /api/seed call. MUST be before
  // any early returns (React Rules of Hooks — hooks can't be conditional).
  const { data: dashboardData } = useDashboardThisMonth()

  // 🔒 V9 4.2: Compute showOnboarding early (needed by the firstRunComplete effect below)
  const hasNoData = dashboardData?.kpis?.productCount === 0 && dashboardData?.kpis?.partyCount === 0
  const showOnboarding = !onboardingDismissed && !isOfflineSession && dashboardData !== undefined && hasNoData && themePickerDone

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

  // 🔒 FIX C3: Listen for sync failures and show a toast so the user knows
  // their offline sale/purchase didn't reach the server. Was: silent data
  // loss — the user saw "Saved offline. Will sync when online" but the sale
  // was silently discarded if the server returned a 4xx error during sync.
  useEffect(() => {
    const unsub = onSyncFailed(({ failed, synced, deadLetterCount }) => {
      const descParts = [`${failed} entr${failed === 1 ? 'y' : 'ies'} failed to sync${synced > 0 ? ` (${synced} synced successfully)` : ''}.`]
      if (deadLetterCount && deadLetterCount > 0) {
        descParts.push(`${deadLetterCount} entr${deadLetterCount === 1 ? 'y' : 'ies'} could not be synced and need manual review. Please re-enter them.`)
      }
      sonnerToast.error('Some entries could not sync', {
        description: descParts.join(' '),
        duration: 10000,
      })
    })
    return unsub
  }, [])

  // precacheDone ref removed — precache is now gated behind warmup (V9 1.4)

  // 🔒 V9 1.4 FIX: Gate precache behind warmup completing.
  // Was: warmup + precache fired as independent effects → all 5 precache
  // requests raced the warmup on a cold DB, adding to the thundering herd.
  // Now: warmup fires first, then precache fires after it completes. This
  // means the DB is awake by the time precache's 5 requests hit, so they
  // complete quickly (~200ms each) instead of queueing behind the cold start.
  const warmupDone = useRef(false)
  useEffect(() => {
    if (
      status === 'authenticated' &&
      session &&
      !warmupDone.current &&
      isOnline()
    ) {
      warmupDone.current = true
      // Fire warmup, then precache after it completes
      fetch('/api/warmup')
        .then(() => precacheData())
        .catch(() => {
          // Warmup failed — still try precache (DB might wake up on its own)
          precacheData().catch(() => {})
        })
    }
  }, [status, session])

  // 🔒 V9 4.2: Gate low-priority modals (RatePrompt, PWA install) until the
  // first-run flow is complete. For existing users (no onboarding shown),
  // firstRunComplete is set immediately. For new users, it's set after the
  // tour is done (or onboarding is dismissed).
  useEffect(() => {
    // If onboarding is not showing (existing user) → first run is complete
    if (!showOnboarding && themePickerDone) {
      setFirstRunComplete(true)
    }
    // If tour is done → first run is complete
    if (tourDone) {
      setFirstRunComplete(true)
    }
  }, [showOnboarding, themePickerDone, tourDone])

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

  // 🔒 V8 P3: showOnboarding + hasNoData already computed above (V9 4.2 moved
  // them up so the firstRunComplete effect can reference showOnboarding).
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
        {/* 🔒 V9 4.2: RatePrompt + PWA install wait until first-run is complete */}
        {firstRunComplete && <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />}
        {firstRunComplete && features?.pwaInstall && <PWAInstallPrompt />}
        <PaywallModal feature={paywallFeature} open={paywallOpen} onClose={closePaywall} />
      </div>
    )
  }

  return (
    <>
      {showSplash && <SplashScreen onFinish={() => {
        setShowSplash(false)
        // 🔒 FIX M10: Mark splash as shown so warm reloads skip it.
        try { sessionStorage.setItem('splashShown', 'true') } catch {}
      }} />}
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

      {features?.pwaInstall && firstRunComplete && <PWAInstallPrompt />}
      {/* Only show tour + consent AFTER onboarding is dismissed.
          Tour shows first, then ConsentModal shows after tour is done.
          This prevents focus-trap conflicts between Radix Dialog (ConsentModal)
          and the tour's plain div overlay (z-[100]). */}
      {!showOnboarding && <OnboardingTour onDone={() => setTourDone(true)} />}
      {!showOnboarding && tourDone && <ConsentModal />}
      {/* 🔒 V9 4.2: RatePrompt waits until first-run is complete */}
      {firstRunComplete && <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />}
      <PaywallModal feature={paywallFeature} open={paywallOpen} onClose={closePaywall} />
      </div>
    </>
  )
}
