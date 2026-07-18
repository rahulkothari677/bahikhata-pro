/**
 * 🔒 Feature Phase 2: Beta Readiness Kit — Crash-free session tracker.
 *
 * Tracks total sessions + crash count in localStorage. Used by:
 * - The "Report a Problem" form (shows crash-free %)
 * - The About page (shows crash-free metric)
 * - Sentry's beforeSend hook (increments crash count on unhandled errors)
 *
 * How it works:
 * 1. On app mount (page.tsx), call trackSessionStart() — increments total sessions.
 * 2. On unhandled error (Sentry beforeSend), call trackCrash() — increments crash count.
 * 3. getCrashFreeMetric() returns { total, crashed, crashFree, percentage }.
 *
 * The counter is per-device (localStorage) — not a global metric. It tells the
 * user "how stable has EkBook been for YOU" — which is what matters for trust.
 */

const SESSION_KEY = 'bahikhata:session-count'
const CRASH_KEY = 'bahikhata:crash-count'

/** Call on app mount — increments the session counter. */
export function trackSessionStart(): void {
  if (typeof window === 'undefined') return
  try {
    const current = parseInt(localStorage.getItem(SESSION_KEY) || '0')
    localStorage.setItem(SESSION_KEY, String(current + 1))
  } catch {
    // localStorage not available — skip silently
  }
}

/** Call on unhandled error — increments the crash counter. */
export function trackCrash(): void {
  if (typeof window === 'undefined') return
  try {
    const current = parseInt(localStorage.getItem(CRASH_KEY) || '0')
    localStorage.setItem(CRASH_KEY, String(current + 1))
  } catch {
    // localStorage not available — skip silently
  }
}

/** Get the crash-free metric for this device. */
export function getCrashFreeMetric(): {
  total: number
  crashed: number
  crashFree: number
  percentage: number
} {
  if (typeof window === 'undefined') {
    return { total: 0, crashed: 0, crashFree: 0, percentage: 100 }
  }
  try {
    const total = parseInt(localStorage.getItem(SESSION_KEY) || '0')
    const crashed = parseInt(localStorage.getItem(CRASH_KEY) || '0')
    const crashFree = Math.max(0, total - crashed)
    const percentage = total > 0 ? Math.round((crashFree / total) * 100) : 100
    return { total, crashed, crashFree, percentage }
  } catch {
    return { total: 0, crashed: 0, crashFree: 0, percentage: 100 }
  }
}
