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
    const effectivelyOffline = !online || !navigator.onLine
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
