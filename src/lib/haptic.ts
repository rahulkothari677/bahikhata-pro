/**
 * Haptic feedback utility for mobile devices.
 *
 * Uses the Vibration API (supported on Android Chrome, Firefox, Edge).
 * iOS Safari does NOT support the Vibration API — calls are silently ignored.
 *
 * Usage:
 *   import { haptic } from '@/lib/haptic'
 *   haptic.success()    // double vibration on success
 *   haptic.error()      // long vibration on error
 *   haptic.click()      // tiny tap on button press
 *   haptic.tick()       // very subtle tick for selection changes
 *
 * Always wrapped in try/catch — never throws, even if Vibration API
 * is not supported. Safe to call on desktop (no-op).
 */

type Pattern = number | number[]

const vibrate = (pattern: Pattern) => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  } catch {
    // Vibration API not supported — silent no-op
  }
}

export const haptic = {
  /** Light tap (10ms) — for button presses, item selection */
  click: () => vibrate(10),

  /** Very subtle tick (5ms) — for tab switches, scroll snaps */
  tick: () => vibrate(5),

  /** Success pattern (two short taps) — for successful save, sync complete */
  success: () => vibrate([10, 40, 20]),

  /** Error pattern (one long buzz) — for failed save, error toast */
  error: () => vibrate(200),

  /** Warning pattern (medium buzz) — for confirmation dialogs */
  warning: () => vibrate(60),

  /** Medium tap (30ms) — for navigation, opening modals */
  medium: () => vibrate(30),
}
