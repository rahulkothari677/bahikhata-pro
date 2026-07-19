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

// ────────────────────────────────────────────────────────────────────────────
// 🔒 V26 R16 (Phase 5): ChunkLoadError auto-reload.
//
// After a deploy, a stale client's lazy view import can fail (the chunk URL
// no longer exists on the CDN). The default Next error surface is unstyled,
// English, and offers no recovery. The route-level error.tsx catches it
// inside the app shell, but if the root layout itself fails to load, only
// global-error.tsx catches it — and even then, the user has to manually
// click "Reload".
//
// This listener auto-reloads ONCE on ChunkLoadError, guarded by a
// sessionStorage flag to prevent infinite reload loops (if the new deploy
// also has a broken chunk, we don't want to reload forever).
//
// Call registerChunkLoadErrorHandler() once on app mount (page.tsx).
// ────────────────────────────────────────────────────────────────────────────

const CHUNK_RELOAD_FLAG = 'bahikhata:chunk-reloaded'

/**
 * Register a window error listener that auto-reloads on ChunkLoadError.
 * Idempotent — safe to call multiple times (the listener is only added once).
 *
 * The reload is guarded by a sessionStorage flag:
 *   - First ChunkLoadError → set flag → reload.
 *   - If the reloaded page ALSO throws ChunkLoadError → flag is set → don't
 *     reload again (let the error boundary show the manual "Reload" button).
 *   - On a successful load after the reload, clear the flag (the next deploy
 *     cycle can auto-reload again).
 */
export function registerChunkLoadErrorHandler(): void {
  if (typeof window === 'undefined') return

  // If the previous reload succeeded, clear the flag so the next deploy can
  // auto-reload. We check this on registration (app mount) — if we got here,
  // the app loaded successfully.
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG) === 'pending') {
      // We reloaded, and the app made it to mount → success. Clear the flag.
      sessionStorage.removeItem(CHUNK_RELOAD_FLAG)
    }
  } catch {
    // sessionStorage not available — skip
  }

  // Avoid double-registration in React Strict Mode (dev).
  if ((window as any).__bahikhataChunkHandlerRegistered) return
  ;(window as any).__bahikhataChunkHandlerRegistered = true

  window.addEventListener('error', (event) => {
    const err = event.error
    const isChunkError =
      err?.name === 'ChunkLoadError' ||
      err?.message?.includes('Loading chunk') ||
      err?.message?.includes('Loading CSS chunk') ||
      (typeof event.message === 'string' && event.message.includes('Loading chunk'))

    if (!isChunkError) return

    // Check the guard — only auto-reload once per session.
    let alreadyReloaded = false
    try {
      alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === 'pending'
    } catch {
      // sessionStorage not available — don't auto-reload (can't guard against loops)
      return
    }

    if (alreadyReloaded) {
      // We already reloaded once and still got a chunk error → let the error
      // boundary show the manual "Reload" button. Don't loop.
      console.warn('[chunk-load] Auto-reload already attempted this session — showing manual recovery.')
      return
    }

    // Set the flag BEFORE reloading so we can detect if the reload also fails.
    try {
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, 'pending')
    } catch {
      return
    }

    console.warn('[chunk-load] ChunkLoadError detected — auto-reloading once to fetch new deploy.')
    // Small delay so the console.warn lands before the reload.
    setTimeout(() => {
      window.location.reload()
    }, 100)
  })

  // Also listen for unhandledrejection — dynamic imports reject as promises.
  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason
    const isChunkError =
      err?.name === 'ChunkLoadError' ||
      err?.message?.includes('Loading chunk') ||
      err?.message?.includes('Loading CSS chunk')

    if (!isChunkError) return

    let alreadyReloaded = false
    try {
      alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === 'pending'
    } catch {
      return
    }

    if (alreadyReloaded) {
      console.warn('[chunk-load] Auto-reload already attempted this session — showing manual recovery.')
      return
    }

    try {
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, 'pending')
    } catch {
      return
    }

    console.warn('[chunk-load] ChunkLoadError (unhandledrejection) — auto-reloading once.')
    event.preventDefault()  // suppress the console error
    setTimeout(() => {
      window.location.reload()
    }, 100)
  })
}
