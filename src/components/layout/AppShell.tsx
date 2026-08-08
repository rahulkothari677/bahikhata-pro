'use client'

/**
 * 🔒 AUDIT V25 FIX §4.4 + §2.3 (Batch 2): AppShell — single source of truth
 * for the app's modal/overlay stack + platform-aware chrome.
 *
 * Before this, page.tsx had THREE branches (More / Account / main) that
 * each duplicated the same 10-component stack:
 *   - KeyboardShortcuts
 *   - GlobalSearch
 *   - ThemePicker
 *   - Onboarding
 *   - PWAInstallPrompt (×2 — see §4.3)
 *   - OnboardingTour
 *   - ConsentModal
 *   - RatePromptModal
 *   - PaywallModal
 *
 * Every shell change had to be made 3× and one copy drifted (e.g., the
 * duplicate PWAInstallPrompt mount — §4.3). This component extracts the
 * shared stack into one place.
 *
 * 🔒 AUDIT V25 FIX §2.3 (Batch 2): chrome props are now platform-aware.
 *   sidebar:    'always' (default) | 'desktop-only' | 'never'
 *   header:     'always' (default) | 'desktop-only' | 'never'
 *   mobileBottomNav: boolean (default true)
 *
 * Account + More pass sidebar='desktop-only' so the Sidebar stays visible
 * on desktop (users don't lose primary nav when opening their profile)
 * but hides on mobile (where they have their own top bar + bottom nav).
 * Main views pass sidebar='always'.
 *
 * Account + More pass header='never' because they have their own top bar
 * with a back button. Main views pass header='always'.
 */

import { type ReactNode } from 'react'
import { type ViewType, type PaywallFeature } from '@/store/app-store'
import { cn } from '@/lib/utils'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MobileBottomNav } from './MobileBottomNav'
import { OfflineIndicator } from '@/components/common/OfflineIndicator'
import { KeyboardShortcuts } from '@/components/common/KeyboardShortcuts'
import { GlobalSearch } from '@/components/common/GlobalSearch'
import { ThemePicker } from '@/components/common/ThemePicker'
import { Onboarding } from '@/components/layout/Onboarding'
import { OnboardingTour } from '@/components/common/OnboardingTour'
import { ConsentModal } from '@/components/common/ConsentModal'
import { RatePromptModal } from '@/components/common/RatePromptModal'
import { PWAInstallPrompt } from '@/components/common/PWAInstallPrompt'
import { PaywallModal } from '@/components/common/PaywallModal'
/*
 * 🔒 2026-08-08: App Lock. Mounted here rather than in Providers because
 * Providers also wraps /login and the public bill page at /b/[token] — a
 * customer opening a shopkeeper's bill link must never meet the shopkeeper's
 * PIN pad. Every authenticated branch in page.tsx renders through AppShell,
 * so this is the one place that covers the app and nothing else.
 *
 * Renders children untouched when no PIN is set, which is every user by
 * default. See src/lib/app-lock.ts.
 */
import { AppLockGate } from '@/components/security/AppLockGate'


/** When to show a chrome element (Sidebar / Header). */
type ChromeVisibility = 'always' | 'desktop-only' | 'never'

interface AppShellProps {
  children: ReactNode
  /** When to show the desktop Sidebar. Default: 'always'. */
  sidebar?: ChromeVisibility
  /** When to show the Header bar. Default: 'always'. */
  header?: ChromeVisibility
  /** Show the MobileBottomNav (mobile only via lg:hidden). Default: true. */
  mobileBottomNav?: boolean
  /** Feature flags from useFeatureFlags (passed in by parent to avoid double-fetch). */
  features: Record<string, boolean> | undefined
  /** Onboarding state (passed in by parent). */
  showThemePicker: boolean
  showOnboarding: boolean
  tourDone: boolean
  /** Account has genuinely just started — gates first-run-only guidance. */
  isFirstRun?: boolean
  firstRunComplete: boolean
  /** Theme picker callbacks. */
  onThemePickerDone: () => void
  onOnboardingDone: () => void
  onTourDone: () => void
  /** Rate prompt state. */
  shouldShowRatePrompt: boolean
  onRated: () => void
  onDismiss: () => void
  /** Paywall state. */
  paywallFeature: PaywallFeature | null
  paywallOpen: boolean
  closePaywall: () => void
}

/** Map ChromeVisibility → CSS classes that control when the element shows. */
function chromeClass(v: ChromeVisibility): string {
  switch (v) {
    case 'always': return ''  // no extra class — visible on all viewports
    case 'desktop-only': return 'hidden lg:flex'  // hidden on mobile, flex on desktop
    case 'never': return 'hidden'  // never visible
  }
}

/**
 * The same rule, for classes that land on <header> itself rather than on a
 * wrapper. `lg:flex` would make the header a flex container, and its single
 * child carries the `justify-between` that lays the bar out — as a flex item
 * that child would shrink to its content and the layout would collapse. The
 * header must stay a block, so this maps to `lg:block`.
 *
 * ('never' never reaches here — showHeader gates it out before render.)
 */
function headerChromeClass(v: ChromeVisibility): string {
  return v === 'desktop-only' ? 'hidden lg:block' : ''
}

export function AppShell({
  children,
  sidebar = 'always',
  header = 'always',
  mobileBottomNav = true,
  features,
  showThemePicker,
  showOnboarding,
  tourDone,
  isFirstRun = true,
  firstRunComplete,
  onThemePickerDone,
  onOnboardingDone,
  onTourDone,
  shouldShowRatePrompt,
  onRated,
  onDismiss,
  paywallFeature,
  paywallOpen,
  closePaywall,
}: AppShellProps) {
  // 🔒 AUDIT V25 FIX §2.3: For 'desktop-only' sidebar, we still render the
  // <Sidebar/> element (so it hydrates and is ready when the user resizes
  // to desktop), but wrap it in a div with `hidden lg:block` so it doesn't
  // take space on mobile. For 'never', we skip rendering entirely.
  const sidebarWrapperClass = chromeClass(sidebar)
  const headerClass = headerChromeClass(header)
  const showSidebar = sidebar !== 'never'
  const showHeader = header !== 'never'

  return (
    <AppLockGate>
    <div className="flex min-h-screen bg-background">
      {/* Global overlays — always present regardless of branch */}
      {features?.keyboardShortcuts && <KeyboardShortcuts />}
      {features?.globalSearch && <GlobalSearch />}

      {/* Desktop sidebar — wrapped so 'desktop-only' hides it on mobile */}
      {showSidebar && (
        <div className={sidebarWrapperClass}>
          <Sidebar />
        </div>
      )}

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0">
        <OfflineIndicator />
        {/* No wrapper div here, deliberately.
         *
         * The Header is `sticky top-0`, and a sticky element can only travel
         * within its containing block. Wrapping it in a plain <div> made that
         * containing block exactly one header tall — zero room to travel — so
         * the header scrolled away with the page instead of sticking. On
         * Android, where the WebView now runs edge-to-edge, that left the
         * dashboard cards sliding up underneath the system clock.
         *
         * As a direct child of this flex column the containing block is the
         * full 6000-odd px of content, and it sticks. The visibility rules
         * ride on the <header> itself. */}
        {showHeader && <Header className={headerClass} />}
        {children}
      </div>

      {/* Mobile bottom nav — only when this branch wants it.
          MobileBottomNav itself is lg:hidden, so it only shows on mobile. */}
      {mobileBottomNav && <MobileBottomNav />}

      {/* 🔒 AUDIT V25 FIX §4.3: PWAInstallPrompt mounted ONCE (was 2× per branch).
          The old code had:
            {features?.pwaInstall && <PWAInstallPrompt />}
            ...
            {firstRunComplete && features?.pwaInstall && <PWAInstallPrompt />}
          Two instances competing for the same beforeinstallprompt event.
          Now: one mount, gated by firstRunComplete so it doesn't show
          during onboarding. */}
      {features?.pwaInstall && firstRunComplete && <PWAInstallPrompt />}

      {/* First-run wizard stack — always present, gates itself on internal state */}
      <ThemePicker open={showThemePicker} onDone={onThemePickerDone} />
      <Onboarding open={showOnboarding} onDone={onOnboardingDone} />
      {/* Only show tour + consent AFTER onboarding is dismissed.
          Tour shows first, then ConsentModal shows after tour is done.
          This prevents focus-trap conflicts between Radix Dialog (ConsentModal)
          and the tour's plain div overlay (z-[100]). */}
      {!showOnboarding && <OnboardingTour onDone={onTourDone} isFirstRun={isFirstRun} />}
      {!showOnboarding && tourDone && <ConsentModal />}
      {/* 🔒 V9 4.2: RatePrompt waits until first-run is complete */}
      {firstRunComplete && <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />}
      <PaywallModal feature={paywallFeature} open={paywallOpen} onClose={closePaywall} />
    </div>
    </AppLockGate>
  )
}

// 🔒 V26 N20: getShellPropsForView REMOVED — was dead code.
// Was exported but never imported or invoked (verified by repo-wide grep).
// The actual chrome decisions are made inline in src/app/page.tsx via
// literal sidebar=/header=/mobileBottomNav= props. Two sources of truth
// for the same rule = drift risk; deleted to keep one canonical source.
