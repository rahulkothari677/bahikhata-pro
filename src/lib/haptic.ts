/**
 * Haptic feedback utility for mobile devices.
 *
 * On native (Capacitor Android/iOS): uses the Capacitor Haptics plugin
 * for rich, native-quality haptics (ImpactStyle, NotificationType).
 *
 * On web (browser): uses the Vibration API (supported on Android Chrome,
 * Firefox, Edge). iOS Safari does NOT support the Vibration API — calls
 * are silently ignored.
 *
 * Usage:
 *   import { haptic } from '@/lib/haptic'
 *   haptic.success()    // success notification haptic
 *   haptic.error()      // error notification haptic
 *   haptic.warning()    // warning notification haptic
 *   haptic.click()      // light tap — button presses, item selection
 *   haptic.tick()       // very subtle tick — tab switches, scroll snaps
 *   haptic.medium()     // medium tap — navigation, opening modals
 *   haptic.heavy()      // heavy tap — destructive actions, confirmations
 *
 * Always wrapped in try/catch — never throws, even if haptics are not
 * supported. Safe to call on desktop (no-op).
 */

import { Capacitor } from '@capacitor/core'

type Pattern = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'tick'

// Cache the platform check — calling Capacitor.isNativePlatform() on every
// haptic call would be wasteful.
let _isNative: boolean | null = null
function isNative(): boolean {
  if (_isNative === null) {
    try {
      _isNative = Capacitor.isNativePlatform()
    } catch {
      _isNative = false
    }
  }
  return _isNative
}

// Lazy-load the Capacitor Haptics plugin only on native platforms.
// On web, we never import it, so it doesn't bloat the web bundle.
let _hapticsModule: any = null
async function getHapticsModule() {
  if (_hapticsModule) return _hapticsModule
  try {
    const mod = await import('@capacitor/haptics')
    _hapticsModule = mod
    return mod
  } catch {
    return null
  }
}

// Web fallback using Vibration API
const webVibrate = (pattern: number | number[]) => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  } catch {
    // Vibration API not supported — silent no-op
  }
}

// Native haptic using Capacitor Haptics plugin
async function nativeHaptic(type: Pattern) {
  try {
    const mod = await getHapticsModule()
    if (!mod) return
    const { Haptics, ImpactStyle, NotificationType } = mod

    switch (type) {
      case 'light':
        await Haptics.impact({ style: ImpactStyle.Light })
        break
      case 'medium':
        await Haptics.impact({ style: ImpactStyle.Medium })
        break
      case 'heavy':
        await Haptics.impact({ style: ImpactStyle.Heavy })
        break
      case 'success':
        await Haptics.notification({ type: NotificationType.Success })
        break
      case 'error':
        await Haptics.notification({ type: NotificationType.Error })
        break
      case 'warning':
        await Haptics.notification({ type: NotificationType.Warning })
        break
      case 'tick':
        // Very subtle — use light impact with minimal duration
        await Haptics.impact({ style: ImpactStyle.Light })
        break
    }
  } catch {
    // silent
  }
}

// Unified haptic function — picks the right implementation
function fire(type: Pattern, webPattern: number | number[]) {
  if (isNative()) {
    nativeHaptic(type)
  } else {
    webVibrate(webPattern)
  }
}

export const haptic = {
  /** Light tap — for button presses, item selection */
  click: () => fire('light', 10),

  /** Very subtle tick — for tab switches, scroll snaps */
  tick: () => fire('tick', 5),

  /** Medium tap — for navigation, opening modals */
  medium: () => fire('medium', 30),

  /** Heavy tap — for destructive actions, confirmations */
  heavy: () => fire('heavy', 50),

  /** Success pattern — for successful save, sync complete */
  success: () => fire('success', [10, 40, 20]),

  /** Error pattern — for failed save, error toast */
  error: () => fire('error', 200),

  /** Warning pattern — for confirmation dialogs */
  warning: () => fire('warning', 60),
}
