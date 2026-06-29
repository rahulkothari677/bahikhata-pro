'use client'

/**
 * Capacitor native bridge — initializes native plugins on mobile.
 *
 * This file is imported by the Providers component and runs on app mount.
 * On web (browser), all Capacitor calls are no-ops.
 * On mobile (Android/iOS), it:
 * - Sets status bar color to match app theme
 * - Shows splash screen on launch
 * - Enables native haptic feedback
 * - Handles back button (Android)
 * - Handles app state changes (background/foreground)
 */

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { useAppStore } from '@/store/app-store'

export function CapacitorBridge() {
  const darkMode = useAppStore((s) => s.features?.darkMode ?? false)

  // Effect 1: Status bar — reactive to dark mode changes
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    async function applyStatusBar() {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar')
        await StatusBar.setOverlaysWebView({ overlay: false })
        // Style.Light = white text/icons (visible on both saffron and dark backgrounds)
        await StatusBar.setStyle({ style: Style.Light })
        // Background matches app theme so there's no harsh color seam
        await StatusBar.setBackgroundColor({
          color: darkMode ? '#1a1815' : '#d97706'
        })
      } catch (err) {
        console.log('[Capacitor] Status bar plugin not available')
      }
    }

    applyStatusBar()
  }, [darkMode])

  // Effect 2: App lifecycle — mount-only
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

        // App state change — refresh data when coming back from background
        const stateListener = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            // App came to foreground — trigger refresh
            window.dispatchEvent(new Event('online'))
          }
        })

        cleanup = () => {
          listener.remove()
          stateListener.remove()
        }
      } catch (err) {
        // Capacitor plugins not available — running on web
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
