'use client'

/**
 * useOfflineSession — bridges NextAuth's useSession with the offline cache.
 *
 * CRITICAL: We never return 'unauthenticated' until we've finished checking
 * IndexedDB for a cached session. This prevents a race condition where
 * NextAuth quickly returns 'unauthenticated' (because /api/auth/session
 * fails offline) before our IndexedDB read completes, causing the login
 * page to flash even when a valid cached session exists.
 */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { getCachedSession, saveSession, clearSession, type CachedSession } from '@/lib/offline-db'
import { isOnline, onOnlineChange } from '@/lib/offline-fetch'

interface OfflineSessionState {
  /** Effective session: real NextAuth session OR cached offline session. */
  session: any
  status: 'loading' | 'authenticated' | 'unauthenticated'
  /** True when the session is being served from the offline cache. */
  isOfflineSession: boolean
}

export function useOfflineSession(): OfflineSessionState {
  const { data: session, status } = useSession()
  const [cached, setCached] = useState<CachedSession | null>(null)
  const [cachedChecked, setCachedChecked] = useState(false) // ← THE FIX
  const [online, setOnline] = useState(true)
  const [loadingTimeout, setLoadingTimeout] = useState(false)

  // Load cached session once on mount — set cachedChecked=true when done
  useEffect(() => {
    let cancelled = false
    getCachedSession()
      .then((s) => {
        if (!cancelled) setCached(s)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCachedChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Listen to online/offline changes
  useEffect(() => {
    setOnline(isOnline())
    const unsub = onOnlineChange(() => setOnline(isOnline()))
    return unsub
  }, [])

  /*
   * 🔒 IS THE SERVER ACTUALLY REACHABLE? `navigator.onLine` does not know.
   *
   * Reported from a real phone, and the screenshot is the proof: the status
   * bar showed 5G while every request died with ERR_NAME_NOT_RESOLVED. The
   * radio was up, so `navigator.onLine` was true — it only ever means "this
   * device has a network interface", never "the server can be reached".
   *
   * That single wrong assumption produced the whole failure. NextAuth reports
   * `unauthenticated` both when the server says you are logged out AND when
   * the session request never completed; we treated the second as the first,
   * decided the shopkeeper was genuinely logged out, and showed the login
   * screen to someone who had been logged in for weeks. Signing in then
   * failed for the same network reason and left them on a dead error page.
   *
   * So when we hold a cached session and NextAuth says unauthenticated, ASK
   * THE SERVER. A rejected fetch means unreachable — keep them logged in. A
   * response means the server really did answer, and if it says no session,
   * they really are logged out and the login screen is correct.
   */
  const [reachable, setReachable] = useState<boolean | null>(null)
  const hasCachedSession = Boolean(cached?.user?.id)
  useEffect(() => {
    if (status !== 'unauthenticated' || !hasCachedSession) {
      setReachable(null)
      return
    }
    let cancelled = false
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(() => { if (!cancelled) setReachable(true) })
      .catch(() => { if (!cancelled) setReachable(false) })
    return () => { cancelled = true }
  }, [status, hasCachedSession])

  // Whenever NextAuth gives us a real session, persist it to IndexedDB
  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      const u = session.user
      // Guard: don't save if user.id is missing (would create a broken session)
      if (!u.id) {
        console.warn('[offline] Skipping session cache — user.id missing')
        return
      }
      saveSession({
        user: {
          id: u.id,
          email: u.email || '',
          name: u.name || null,
          role: (u.role as 'owner' | 'staff') || 'owner',
          ownerId: u.ownerId || null,
        },
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }).catch(() => {})
    }
  }, [status, session])

  // If NextAuth is stuck on 'loading' for too long while offline, fall back
  // to the cached session (after 2 seconds — reduced from 3 for snappier UX).
  useEffect(() => {
    if (status !== 'loading') {
      setLoadingTimeout(false)
      return
    }
    const timer = setTimeout(() => setLoadingTimeout(true), 2000)
    return () => clearTimeout(timer)
  }, [status])

  // Timeout fallback: loading too long + offline + cached session = use it
  if (status === 'loading' && loadingTimeout && (!online || !navigator.onLine) && cached && cached.user?.id) {
    return {
      session: {
        user: cached.user,
        expires: safeToISOString(cached.expiresAt),
      },
      status: 'authenticated',
      isOfflineSession: true,
    }
  }

  // Still loading NextAuth OR haven't checked IndexedDB yet → show loading
  if (status === 'loading' || !cachedChecked) {
    return { session: null, status: 'loading', isOfflineSession: false }
  }

  // Authenticated via NextAuth (online) — use the real session
  if (status === 'authenticated' && session) {
    return { session, status: 'authenticated', isOfflineSession: false }
  }

  // Unauthenticated via NextAuth — check if we have a cached offline session.
  // Use BOTH the React `online` state AND navigator.onLine for redundancy,
  // in case the online state hasn't updated yet.
  if (status === 'unauthenticated') {
    /*
     * Don't decide while the reachability probe is still in flight: showing
     * the login screen and then replacing it a moment later is how someone
     * starts typing a password they did not need to type.
     */
    if (hasCachedSession && reachable === null) {
      return { session: null, status: 'loading', isOfflineSession: false }
    }

    /*
     * `reachable === false` is the case the phone hit: the radio is up, so
     * both onLine checks say we are online, but nothing can actually be
     * reached. Without it, a cached session is discarded and the shopkeeper is
     * asked to log in — over a connection that cannot carry a login.
     */
    const effectivelyOffline = !online || !navigator.onLine || reachable === false
    if (effectivelyOffline && cached && cached.user?.id) {
      // Offline + cached session → use it
      return {
        session: {
          user: cached.user,
          expires: safeToISOString(cached.expiresAt),
        },
        status: 'authenticated',
        isOfflineSession: true,
      }
    }
    // Either online (so they really are logged out) or no cached session
    return { session: null, status: 'unauthenticated', isOfflineSession: false }
  }

  return { session: null, status: 'loading', isOfflineSession: false }
}

/** Safely convert epoch ms to ISO string — never throws. */
function safeToISOString(ts: number): string {
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return new Date().toISOString()
    return d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/** Clear the cached offline session (used on manual logout). */
export async function clearOfflineSession(): Promise<void> {
  await clearSession()
}
