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

export function AppShell({
  children,
  sidebar = 'always',
  header = 'always',
  mobileBottomNav = true,
  features,
  showThemePicker,
  showOnboarding,
  tourDone,
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
  const headerClass = chromeClass(header)
  const showSidebar = sidebar !== 'never'
  const showHeader = header !== 'never'

  return (
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
        {showHeader && (
          <div className={headerClass}>
            <Header />
          </div>
        )}
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
      {!showOnboarding && <OnboardingTour onDone={onTourDone} />}
      {!showOnboarding && tourDone && <ConsentModal />}
      {/* 🔒 V9 4.2: RatePrompt waits until first-run is complete */}
      {firstRunComplete && <RatePromptModal open={shouldShowRatePrompt} onRated={onRated} onDismiss={onDismiss} />}
      <PaywallModal feature={paywallFeature} open={paywallOpen} onClose={closePaywall} />
    </div>
  )
}

/**
 * Helper: get the ViewType → AppShell props mapping.
 *
 * 🔒 AUDIT V25 FIX §2.3 (Batch 2): Account and More now render INSIDE the
 * shell on desktop (sidebar='desktop-only'). On mobile they stay full-screen
 * (sidebar='never' effectively, via the desktop-only class). They have their
 * own top bar with back button, so header='never' for both platforms.
 */
export function getShellPropsForView(view: ViewType): {
  sidebar: ChromeVisibility
  header: ChromeVisibility
  mobileBottomNav: boolean
} {
  if (view === 'more' || view === 'account') {
    // 🔒 §2.3: Sidebar stays visible on desktop (desktop-only), hidden on mobile.
    // Header is 'never' — these screens have their own top bar with back button.
    return { sidebar: 'desktop-only', header: 'never', mobileBottomNav: true }
  }
  // New-entry / detail views: full chrome, no bottom nav (they have own back btn)
  if (['new-sale', 'new-purchase', 'transaction-detail', 'party-profile'].includes(view)) {
    return { sidebar: 'always', header: 'always', mobileBottomNav: false }
  }
  return { sidebar: 'always', header: 'always', mobileBottomNav: true }
}
