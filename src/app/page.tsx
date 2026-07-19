'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useAppStore, type ViewType } from '@/store/app-store'
import { useOfflineSession } from '@/hooks/use-offline-session'
import { useBrowserBackButton } from '@/hooks/use-browser-back-button'
import { PullToRefresh } from '@/hooks/use-pull-to-refresh'
import { isOnline, onSyncComplete, onSyncFailed } from '@/lib/offline-fetch'
import { precacheData } from '@/lib/precache'
import { useDashboardThisMonth } from '@/hooks/use-dashboard'
import { toast as sonnerToast } from 'sonner'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { MoreScreen } from '@/components/layout/MoreScreen'
import { AccountScreen } from '@/components/layout/AccountScreen'
// 🔒 AUDIT V25 FIX §4.4: AppShell replaces the triplicated modal stack.
// Sidebar, Header, MobileBottomNav, Onboarding, ThemePicker,
// KeyboardShortcuts, GlobalSearch, OfflineIndicator, PWAInstallPrompt,
// OnboardingTour, ConsentModal, RatePromptModal, PaywallModal are now
// imported ONCE inside AppShell.tsx — no longer duplicated 3× in page.tsx.
import { AppShell } from '@/components/layout/AppShell'
import { Dashboard } from '@/components/dashboard/Dashboard'
// 🔒 V20-008: Lazy-load non-default views to reduce initial bundle.
// Dashboard is the default view, so it stays static. All other views
// load on demand when the user navigates to them.
const Inventory = dynamic(() => import('@/components/inventory/Inventory').then(m => ({ default: m.Inventory })), { ssr: false })
const Ledger = dynamic(() => import('@/components/ledger/Ledger').then(m => ({ default: m.Ledger })), { ssr: false })
const LedgerSplitView = dynamic(() => import('@/components/ledger/LedgerSplitView').then(m => ({ default: m.LedgerSplitView })), { ssr: false })
const IncomeExpense = dynamic(() => import('@/components/income/IncomeExpense').then(m => ({ default: m.IncomeExpense })), { ssr: false })
const Parties = dynamic(() => import('@/components/parties/Parties').then(m => ({ default: m.Parties })), { ssr: false })
import { SplashScreen } from '@/components/common/SplashScreen'
import { useRatePrompt } from '@/hooks/use-rate-prompt'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import type { ModuleKey } from '@/lib/staff-permissions'
import { track, identifyUser, initAnalytics, EVENTS, hashEmail } from '@/lib/analytics'
import { useBootstrap } from '@/hooks/use-bootstrap'
import { trackSessionStart } from '@/lib/crash-tracker'

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
const ToolsHub = dynamic(() => import('@/components/layout/ToolsHub').then(m => ({ default: m.ToolsHub })), { ssr: false })
const Settings = dynamic(() => import('@/components/settings/Settings').then(m => ({ default: m.Settings })), { ssr: false })
const PricingPlans = dynamic(() => import('@/components/subscription/PricingPlans').then(m => ({ default: m.PricingPlans })), { ssr: false })
const AIComparison = dynamic(() => import('@/components/settings/AIComparison').then(m => ({ default: m.AIComparison })), { ssr: false })
const AIUsage = dynamic(() => import('@/components/settings/AIUsage').then(m => ({ default: m.AIUsage })), { ssr: false })
// 🔒 V22-14 (Batch D, Phase 7g): Document Vault
const DocumentVault = dynamic(() => import('@/components/documents/DocumentVault').then(m => ({ default: m.DocumentVault })), { ssr: false })

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
  // 🔒 V20-019: Splash shows on every full page load — desktop AND mobile.
  // Previously skipped on Capacitor native (which has its own static native
  // splash), but the user wants the premium animated splash everywhere.
  // The CapacitorBridge hides the native splash immediately, and this web
  // splash takes over with the same saffron background (seamless transition).
  //
  // 🔒 AUDIT V23 §13.9h REVERTED (user feedback): The sessionStorage warm-reload
  // skip was added in Batch L but the user reported "splash screen isn't coming."
  // Reverted — splash now shows on every page load (cold + warm). The premium
  // animation is part of the app's identity.
  const [showSplash, setShowSplash] = useState(true)
  // 🔒 V9 4.2: First-run modal orchestrator — gate low-priority modals until
  // the user has completed onboarding + tour. Prevents modal pile-up:
  // SplashScreen → ThemePicker → Onboarding → Tour → Consent → RatePrompt → PWA
  // Now: RatePrompt + PWA install wait until onboarding AND tour are done.
  const [firstRunComplete, setFirstRunComplete] = useState(false)

  // 🔒 V8 P3: Fetch dashboard data (shared React Query cache) to check if the
  // user has any data — replaces the separate /api/seed call. MUST be before
  // any early returns (React Rules of Hooks — hooks can't be conditional).
  const { data: dashboardData } = useDashboardThisMonth()

  // 🔒 V21-007: Bootstrap consolidation — fetch settings + shops + subscription
  // in ONE request after warmup completes. Primes the React Query cache so
  // use-setting, use-shops, and use-subscription read from cache (no extra
  // network requests). Reduces boot fan-out from ~14 to ~11 requests.
  const dbWarmedUp = useAppStore((s) => s.dbWarmedUp)
  useBootstrap(status === 'authenticated' && dbWarmedUp)

  // 🔒 V9 4.2: Compute showOnboarding early (needed by the firstRunComplete effect below)
  const hasNoData = dashboardData?.kpis?.productCount === 0 && dashboardData?.kpis?.partyCount === 0

  // 🔒 AUDIT V25 FIX BUG-029 (Batch 5): Was `showOnboarding = ... && themePickerDone`.
  // When themePickerDone flipped to true, showThemePicker became false AND
  // showOnboarding became true in the SAME render. But Radix Dialog keeps the
  // ThemePicker mounted for ~300ms during its exit animation → both dialogs
  // were in the DOM simultaneously, competing for overlay/click focus.
  // Now: delay showOnboarding by 400ms after themePickerDone becomes true,
  // so ThemePicker's exit animation completes before Onboarding opens.
  const [onboardingReady, setOnboardingReady] = useState(false)
  useEffect(() => {
    if (!themePickerDone) {
      setOnboardingReady(false)
      return
    }
    // ThemePicker is animating out — wait for its exit animation to complete
    // before opening Onboarding. 400ms covers the standard Radix fade/slide.
    const timer = setTimeout(() => setOnboardingReady(true), 400)
    return () => clearTimeout(timer)
  }, [themePickerDone])

  const showOnboarding = !onboardingDismissed && !isOfflineSession && dashboardData !== undefined && hasNoData && onboardingReady

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
    if (moduleKey && !canAccess(moduleKey as ModuleKey)) {
      // Redirect to first allowed view
      // 🔒 V26 N17: Extended fallback list — was only ['sales','purchases','inventory','scanner','dashboard']
      // → staff with only reports/parties/income-expense landed on blocked Sales view.
      const firstAllowed = ['dashboard', 'sales', 'purchases', 'parties', 'inventory', 'reports', 'income-expense', 'scanner', 'settings'].find(
        (v) => canAccess(v as ModuleKey)
      )
      setView((firstAllowed || 'sales') as ViewType)
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
  // 🔒 V26 R7 (Phase 5): Also handle `rejected` (409/422 — server rejected a
  // queued write, e.g. duplicate or validation conflict). Don't retry —
  // surface to the user so they know a queued edit hit a real conflict.
  useEffect(() => {
    const unsub = onSyncFailed(({ failed, synced, rejected, deadLetterCount }) => {
      const descParts = [`${failed} entr${failed === 1 ? 'y' : 'ies'} failed to sync${synced > 0 ? ` (${synced} synced successfully)` : ''}.`]
      if (rejected && rejected > 0) {
        descParts.push(`${rejected} entr${rejected === 1 ? 'y' : 'ies'} were rejected by the server (duplicate or validation conflict) and removed from the queue.`)
      }
      if (deadLetterCount && deadLetterCount > 0) {
        descParts.push(`${deadLetterCount} entr${deadLetterCount === 1 ? 'y' : 'ies'} could not be synced and need manual review. Please re-enter them in Settings → Data → Unsynced Entries.`)
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
      // 🔒 V21-006: Fire warmup FIRST and ALONE, then set dbWarmedUp=true,
      // then precache. This ensures the DB is awake before any data queries
      // hit it. The dashboard query (useDashboardThisMonth) is gated by
      // dbWarmedUp via useAppStore, so it won't fire until warmup completes.
      fetch('/api/warmup')
        .then(() => {
          // DB is awake — release the dashboard query + precache
          useAppStore.getState().setDbWarmedUp(true)
          return precacheData()
        })
        .catch(() => {
          // Warmup failed — still release the queries (DB might wake up on its own)
          useAppStore.getState().setDbWarmedUp(true)
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

  // 🔒 V20-025: Analytics — init on mount, identify user on auth, track app_opened
  // 🔒 Feature Phase 2: Track session start for crash-free metric.
  useEffect(() => {
    initAnalytics()
    trackSessionStart()
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      // 🔒 AUDIT V23 FIX §13.9g: Real SHA-256 email hash (was btoa which is reversible).
      // Fire identify immediately for attribution, then enrich with email_hash
      // when the async hash resolves. The hash is non-blocking so app_opened
      // still tracks on first render.
      identifyUser(session.user.id)
      if (session.user.email) {
        hashEmail(session.user.email).then((h) => {
          if (h) identifyUser(session.user.id, { email_hash: h })
        })
      }
      // Track app_opened once per session (not on every re-render)
      track(EVENTS.APP_OPENED, {
        isOfflineSession,
        plan: (session.user as any)?.plan || 'free',
      })
    }
  }, [status, session, isOfflineSession])

  // 🔒 V20-025: Track view changes for engagement analytics
  const lastTrackedViewRef = useRef<string | null>(null)
  useEffect(() => {
    if (status === 'authenticated' && currentView && lastTrackedViewRef.current !== currentView) {
      lastTrackedViewRef.current = currentView
      track(EVENTS.VIEW_CHANGED, { view: currentView })
    }
  }, [currentView, status])

  // 🔒 V22-11 (Batch A, Phase 5g): Default Landing Page setting.
  // On first authentication, read the user's preferred landing page from
  // localStorage and navigate there. Only fires once per session (guarded
  // by a ref) so it doesn't override user navigation during the session.
  const landingPageAppliedRef = useRef(false)
  useEffect(() => {
    if (status === 'authenticated' && !landingPageAppliedRef.current) {
      landingPageAppliedRef.current = true
      const savedLanding = typeof window !== 'undefined'
        ? localStorage.getItem('bahikhata:default-landing')
        : null
      if (savedLanding) {
        const validViews = ['dashboard', 'sales', 'purchases', 'inventory', 'parties', 'reports', 'scanner', 'tools']
        if (validViews.includes(savedLanding)) {
          // Only apply if the user can access this view (staff permission check)
          const moduleMap: Record<string, string> = {
            'dashboard': 'dashboard',
            'sales': 'sales',
            'purchases': 'purchases',
            'inventory': 'inventory',
            'parties': 'parties',
            'reports': 'reports',
            'scanner': 'scanner',
          }
          const moduleKey = moduleMap[savedLanding]
          if (!moduleKey || canAccess(moduleKey as any)) {
            setView(savedLanding as any)
          }
        }
      }
    }
  }, [status, canAccess, setView])

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

  // During SSR and first client render, show the splash screen (not a plain
  // spinner). The splash is the loading screen — it dismisses when the session
  // resolves + dashboard data is ready (data-driven, per V20-019).
  //
  // 🔒 V20-019 FIX: Previously this block returned a plain spinner div, which
  // meant the SplashScreen (rendered at line ~287 inside the main return)
  // NEVER showed during loading — the early return prevented it. By the time
  // status !== 'loading', the splash would render but immediately dismiss
  // because `ready` was already true. Net result: users never saw the splash.
  // Now: the splash shows DURING loading (ready=false), and dismisses when
  // the session resolves AND dashboard data loads.
  if (!mounted || status === 'loading') {
    return showSplash ? (
      <SplashScreen
        ready={false}
        onFinish={() => {
          setShowSplash(false)
        }}
      />
    ) : (
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

  // 🔒 AUDIT V25 FIX §4.3 + §4.4: Replaced 3 triplicated branches (More,
  // Account, main) with a single <AppShell> wrapper. AppShell owns the
  // modal/overlay stack ONCE (was 3×, with PWAInstallPrompt mounted 2× per
  // branch = 6 competing instances). Each branch now passes its content
  // as children + picks which chrome to show via props.
  const shellProps = {
    features,
    showThemePicker,
    showOnboarding,
    tourDone,
    firstRunComplete,
    onThemePickerDone: () => setThemePickerDone(true),
    onOnboardingDone: () => setOnboardingDismissed(true),
    onTourDone: () => setTourDone(true),
    shouldShowRatePrompt,
    onRated,
    onDismiss,
    paywallFeature,
    paywallOpen,
    closePaywall,
  }

  // More screen renders full-screen on mobile (sidebar hidden, own top bar).
  // On desktop, sidebar stays visible (§2.3 fix) so users don't lose primary nav.
  if (currentView === 'more') {
    return (
      <AppShell {...shellProps} sidebar="desktop-only" header="never" mobileBottomNav={true}>
        <MoreScreen />
      </AppShell>
    )
  }

  // 🔒 V21-010 (Phase 2a): Account screen — same pattern as More.
  // Mobile: full-screen with own top bar. Desktop: sidebar stays visible (§2.3).
  if (currentView === 'account') {
    return (
      <AppShell {...shellProps} sidebar="desktop-only" header="never" mobileBottomNav={true}>
        <AccountScreen />
      </AppShell>
    )
  }

  return (
    <>
      {showSplash && <SplashScreen
        ready={status === 'authenticated' && dashboardData !== undefined}
        onFinish={() => {
        setShowSplash(false)
      }} />}
      <AppShell {...shellProps} sidebar="always" header="always" mobileBottomNav={true}>
        <main className="flex-1 p-3 lg:p-5 w-full min-w-0 pb-28 lg:pb-6">
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
            enabled={!['new-sale', 'new-purchase', 'new-estimate', 'transaction-detail', 'party-profile', 'scanner', 'pricing', 'reports', 'settings', 'ai-comparison', 'ai-usage', 'document-vault', 'tools'].includes(currentView)}
          >
            {currentView === 'dashboard' && <Dashboard />}
            {currentView === 'inventory' && <Inventory />}
            {currentView === 'sales' && <LedgerSplitView type="sale" />}
            {currentView === 'purchases' && <LedgerSplitView type="purchase" />}
            {currentView === 'income-expense' && <IncomeExpense />}
            {currentView === 'parties' && <Parties />}
            {currentView === 'scanner' && <BillScanner />}
            {currentView === 'reports' && <Reports />}
            {currentView === 'tools' && <ToolsHub />}
            {currentView === 'settings' && <Settings />}
            {currentView === 'pricing' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => {
                    // 🔒 V21-014 fix: Was hardcoded setView('more') — now uses
                    // previousView so it goes back to wherever the user came from
                    // (Account page, More section, etc.)
                    // 🔒 AUDIT V25 FIX §2.3 (Batch 2): Fallback was 'more' which
                    // stranded desktop users on the mobile More screen (no sidebar,
                    // no exit). Now fallback is 'dashboard' — always safe, always
                    // has full chrome. If previousView exists, use it (real back nav).
                    const prev = useAppStore.getState().previousView
                    setView(prev || 'dashboard')
                    useAppStore.getState().setPreviousView(null)
                  }} className="p-2 -ml-2 rounded-lg hover:bg-muted">
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
            {currentView === 'document-vault' && <DocumentVault />}
            {currentView === 'transaction-detail' && <TransactionDetail />}
            {currentView === 'party-profile' && <PartyProfile />}
            {currentView === 'new-sale' && <TransactionEntry type="sale" />}
            {currentView === 'new-purchase' && <TransactionEntry type="purchase" />}
            {/* 🔒 Feature Phase 3: Estimates/Quotations — reuses TransactionEntry
                with type="sale" but sets a global flag so the save uses type='estimate'.
                Estimates don't affect stock, party balance, or GST. They can be
                converted to a sale later via the "Convert to Sale" button on the
                transaction detail page. */}
            {currentView === 'new-estimate' && <TransactionEntry type="sale" estimateMode={true} />}
          </PullToRefresh>
        </main>

        <footer className="mt-auto border-t border-border py-3 px-4 lg:px-6 text-center text-[11px] text-muted-foreground no-print hidden lg:block">
          <p>EkBook — Made with love for Bharat</p>
        </footer>
      </AppShell>
    </>
  )
}
