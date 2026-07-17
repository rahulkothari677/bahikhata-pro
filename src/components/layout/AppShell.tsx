'use client'

/**
 * 🔒 AUDIT V25 FIX §4.4: AppShell — single source of truth for the app's
 * modal/overlay stack.
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
 * shared stack into one place. The three branches now render:
 *
 *   <AppShell sidebar={false} mobileBottomNav={true}>
 *     <MoreScreen />
 *   </AppShell>
 *
 *   <AppShell sidebar={false} mobileBottomNav={true}>
 *     <AccountScreen />
 *   </AppShell>
 *
 *   <AppShell sidebar={true} mobileBottomNav={true} header={true}>
 *     {currentView === 'dashboard' && <Dashboard />}
 *     ...
 *   </AppShell>
 *
 * The `sidebar`/`header`/`mobileBottomNav` props let each branch pick
 * which chrome to show. The modal stack is always the same.
 */

import { type ReactNode } from 'react'
import { type ViewType, type PaywallFeature } from '@/store/app-store'
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

interface AppShellProps {
  children: ReactNode
  /** Show the desktop Sidebar (default: true). Set false for full-screen views like More/Account on mobile. */
  sidebar?: boolean
  /** Show the Header bar (default: true). Set false for full-screen views. */
  header?: boolean
  /** Show the MobileBottomNav (default: true). Set false for views that have their own back button. */
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

export function AppShell({
  children,
  sidebar = true,
  header = true,
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
  return (
    <div className="flex min-h-screen bg-background">
      {/* Global overlays — always present regardless of branch */}
      {features?.keyboardShortcuts && <KeyboardShortcuts />}
      {features?.globalSearch && <GlobalSearch />}

      {/* Desktop sidebar — only when this branch wants it */}
      {sidebar && <Sidebar />}

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0">
        <OfflineIndicator />
        {header && <Header />}
        {children}
      </div>

      {/* Mobile bottom nav — only when this branch wants it */}
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
 * Full-screen views (More, Account) get sidebar=false, header=false.
 * Everything else gets the full chrome.
 */
export function getShellPropsForView(view: ViewType): {
  sidebar: boolean
  header: boolean
  mobileBottomNav: boolean
} {
  // 🔒 AUDIT V25 §2.3 (Batch 2 — not yet implemented): On desktop, Account
  // and More should render INSIDE the shell (sidebar stays). For now,
  // keeping the full-screen mobile pattern to avoid changing behavior
  // in this dead-code-cleanup batch.
  if (view === 'more' || view === 'account') {
    return { sidebar: false, header: false, mobileBottomNav: true }
  }
  // New-entry / detail views: full-screen, no bottom nav (they have own back btn)
  if (['new-sale', 'new-purchase', 'transaction-detail', 'party-profile'].includes(view)) {
    return { sidebar: true, header: true, mobileBottomNav: false }
  }
  return { sidebar: true, header: true, mobileBottomNav: true }
}
