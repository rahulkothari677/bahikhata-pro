'use client'

/**
 * Capacitor native bridge — initializes native plugins on mobile.
 *
 * This file is imported by the Providers component and runs on app mount.
 * On web (browser), all Capacitor calls are no-ops.
 * On mobile (Android/iOS), it:
 * - Sets status bar color to saffron (#d97706) with white text, always
 * - Shows splash screen on launch
 * - Enables native haptic feedback
 * - Handles back button (Android)
 * - Handles app state changes (background/foreground)
 */

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { canGoBackInApp } from '@/hooks/use-browser-back-button'
import { confirmExit, hasExitGuard } from '@/lib/exit-guard'

const SAFFRON = '#c2410c'

/** The top inset currently in effect, in CSS px. 0 means "not overlaid". */
function currentTopInset(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--safe-area-inset-top')
    .trim()
  return raw ? parseFloat(raw) || 0 : 0
}

/**
 * Status bar setup.
 *
 * Two Android worlds exist and this has to serve both, so it reads the world
 * it is in rather than sniffing the OS version:
 *
 *  - Android ≤ 14: setOverlaysWebView(false) genuinely works. The WebView
 *    starts BELOW a saffron status bar, and the injected top inset is 0.
 *    Saffron is dark, so the clock must be light.
 *
 *  - Android 15+ (we target SDK 36): edge-to-edge is mandatory. Both
 *    setOverlaysWebView and setBackgroundColor are documented no-ops — see
 *    Capacitor's own StatusBar.java#shouldSetStatusBarColor. The WebView
 *    fills the screen, the inset is a real number, and the clock now sits on
 *    whatever our header paints — so it must follow the APP's theme, not the
 *    device's, because the app has its own dark-mode toggle.
 *
 * `overlaid ? follow the app theme : light on saffron` covers both without
 * asking what version of Android this is.
 */
async function syncStatusBar() {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')

    // Harmless where it is a no-op, correct where it is not.
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setBackgroundColor({ color: SAFFRON })

    // Older shells (Capacitor Android < 8.3) never inject the CSS variables,
    // so nothing would pad. getInfo() reports the height on every version,
    // which lets a phone running an old build of the APK pick up this fix
    // from the web layer alone, with no reinstall.
    if (currentTopInset() === 0) {
      const info = await StatusBar.getInfo()
      if (info.height > 0 && info.overlays) {
        document.documentElement.style.setProperty('--safe-area-inset-top', `${info.height}px`)
      }
    }

    const overlaid = currentTopInset() > 0
    const appIsDark = document.documentElement.classList.contains('dark')
    // Style.Dark means LIGHT text (for a dark background) — the enum is named
    // after the background it sits on, not the text it produces.
    const style = overlaid ? (appIsDark ? Style.Dark : Style.Light) : Style.Dark
    await StatusBar.setStyle({ style })
  } catch (err) {
    console.warn('[Capacitor] StatusBar apply failed:', err)
  }
}

export function CapacitorBridge() {
  // Effect 1: Status bar — apply once on mount, and re-apply on app foreground
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      // Not a native platform, skipping status bar
      return
    }

    // Native platform detected, applying status bar
    // Small delay to ensure WebView is fully ready before we set the color.
    // Without this, Android sometimes overrides our color after app launch.
    const initialTimer = setTimeout(syncStatusBar, 300)

    let cleanupListener: (() => void) | undefined

    // Re-apply on app state change (Android sometimes resets status bar when
    // app goes to background and comes back to foreground)
    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        const listener = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            // App foregrounded, re-applying status bar
            syncStatusBar()
          }
        })
        cleanupListener = () => listener.remove()
      } catch {
        // App plugin not available
      }
    })()

    // The clock now sits on the header, so its colour is a function of the
    // theme. next-themes swaps the `dark` class on <html>; without this the
    // icons keep the previous theme's colour until the next app resume, which
    // in light mode means a white clock on a white header — invisible.
    const themeObserver = new MutationObserver(() => { syncStatusBar() })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      clearTimeout(initialTimer)
      themeObserver.disconnect()
      if (cleanupListener) cleanupListener()
    }
  }, [])

  // Effect 2: App lifecycle — mount-only (back button + splash)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let cleanup: (() => void) | undefined

    async function initNative() {
      try {
        // Splash Screen
        const { SplashScreen } = await import('@capacitor/splash-screen')
        await SplashScreen.hide()

        // App lifecycle — handle Android back button
        const { App } = await import('@capacitor/app')
        const listener = await App.addListener('backButton', async ({ canGoBack }) => {
          /*
           * The hardware back button is an exit like any other, so the mounted
           * screen gets the same say the header's arrow gives it.
           *
           * But ONLY when a screen has actually registered a guard. Making this
           * handler unconditionally async put an await in front of the
           * navigation on EVERY screen, so the whole back path — including
           * App.exitApp() at the root — started running a microtask later than
           * Capacitor delivered the event. Nothing else on this screen needed
           * that, and a back button is the last place to add a suspension point
           * for a question nobody is asking.
           *
           * hasExitGuard() is synchronous, so screens without a guard keep the
           * exact code path they had before the guard existed.
           */
          if (hasExitGuard() && !(await confirmExit())) return
          // 🔒 V11 FIX: Don't trust Capacitor's `canGoBack` — it checks Android
          // WebView's URL-based history. This app uses pushState with the SAME
          // URL (no URL change), so canGoBack always returned false →
          // App.exitApp() was called on every back press → app "restarted."
          //
          // Instead, check the app's own JS navigation stack via
          // canGoBackInApp(). If the app has >1 view in its stack, go back
          // within the app. Only exit if we're at the root (dashboard).
          if (canGoBackInApp()) {
            window.history.back()
          } else if (!canGoBack) {
            // Fallback: if neither the app stack nor the WebView has back
            // history, exit the app. This handles the case where the user
            // is at the dashboard with no app history.
            App.exitApp()
          } else {
            // Edge case: app stack is empty but WebView has history (e.g.,
            // user arrived from an external page). Let the WebView go back.
            window.history.back()
          }
        })

        cleanup = () => {
          listener.remove()
        }
      } catch (err) {
        // Running on web, native plugins skipped
      }
    }

    initNative()

    return () => {
      if (cleanup) cleanup()
    }
  }, [])

  return null
}

/**
 * Native haptic feedback — uses Capacitor Haptics on mobile,
 * falls back to navigator.vibrate on web.
 */
export async function nativeHaptic(pattern: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning') {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
      const impactMap = {
        light: ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy: ImpactStyle.Heavy,
      }
      const notifMap = {
        success: NotificationType.Success,
        error: NotificationType.Error,
        warning: NotificationType.Warning,
      }
      if (pattern in impactMap) {
        await Haptics.impact({ style: impactMap[pattern as keyof typeof impactMap] })
      } else if (pattern in notifMap) {
        await Haptics.notification({ type: notifMap[pattern as keyof typeof notifMap] })
      }
    } else {
      // Web fallback
      const webPatterns: Record<string, number | number[]> = {
        light: 10,
        medium: 30,
        heavy: 60,
        success: [10, 40, 20],
        error: 200,
        warning: 60,
      }
      navigator.vibrate?.(webPatterns[pattern])
    }
  } catch {
    // silent
  }
}
