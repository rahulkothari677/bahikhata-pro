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

const SAFFRON = '#c2410c'

async function applySaffronStatusBar() {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Make sure status bar does NOT overlay the webview (otherwise the page
    // background shows through and we lose our saffron color)
    await StatusBar.setOverlaysWebView({ overlay: false })
    // Style.Light = white text/icons (readable on saffron)
    await StatusBar.setStyle({ style: Style.Light })
    // Always saffron background, in both light and dark mode
    await StatusBar.setBackgroundColor({ color: SAFFRON })
    console.log('[Capacitor] StatusBar applied: saffron bg, white text')
  } catch (err) {
    console.warn('[Capacitor] StatusBar apply failed:', err)
  }
}

export function CapacitorBridge() {
  // Effect 1: Status bar — apply once on mount, and re-apply on app foreground
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      console.log('[Capacitor] Not a native platform, skipping status bar')
      return
    }

    console.log('[Capacitor] Native platform detected, applying status bar')
    // Small delay to ensure WebView is fully ready before we set the color.
    // Without this, Android sometimes overrides our color after app launch.
    const initialTimer = setTimeout(applySaffronStatusBar, 300)

    let cleanupListener: (() => void) | undefined

    // Re-apply on app state change (Android sometimes resets status bar when
    // app goes to background and comes back to foreground)
    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        const listener = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            console.log('[Capacitor] App foregrounded, re-applying status bar')
            applySaffronStatusBar()
          }
        })
        cleanupListener = () => listener.remove()
      } catch {
        // App plugin not available
      }
    })()

    return () => {
      clearTimeout(initialTimer)
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
        const listener = await App.addListener('backButton', ({ canGoBack }) => {
          if (!canGoBack) {
            App.exitApp()
          } else {
            window.history.back()
          }
        })

        cleanup = () => {
          listener.remove()
        }
      } catch (err) {
        console.log('[Capacitor] Running on web, native plugins skipped')
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
