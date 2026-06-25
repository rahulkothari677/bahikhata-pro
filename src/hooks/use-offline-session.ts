'use client'

/**
 * useOfflineSession — bridges NextAuth's useSession with the offline cache.
 *
 * Logic:
 *  - If useSession returns 'authenticated' → save session to IndexedDB.
 *  - If useSession returns 'unauthenticated' AND we are offline AND there is
 *    a valid cached session → return that cached session (so user can keep
 *    working offline).
 *  - If useSession returns 'unauthenticated' AND we are online → return null
 *    (force login screen).
 *  - If useSession is stuck on 'loading' for >3 seconds AND we are offline
 *    AND have a cached session → return the cached session (don't make the
 *    user stare at a spinner forever when there's no network).
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
  const [online, setOnline] = useState(true)
  const [loadingTimeout, setLoadingTimeout] = useState(false)

  // Load cached session once on mount
  useEffect(() => {
    getCachedSession().then(setCached)
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
      const u = session.user as any
      saveSession({
        user: {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role || 'owner',
          ownerId: u.ownerId || null,
        },
        // NextAuth JWT maxAge is 30 days — match it
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }).catch(() => {})
    }
  }, [status, session])

  // If NextAuth is stuck on 'loading' for too long while offline, fall back
  // to the cached session (after 3 seconds).
  useEffect(() => {
    if (status !== 'loading') {
      setLoadingTimeout(false)
      return
    }
    const timer = setTimeout(() => setLoadingTimeout(true), 3000)
    return () => clearTimeout(timer)
  }, [status])

  // If we've timed out loading AND we're offline AND we have a cached session,
  // return the cached session instead of staying stuck.
  if (status === 'loading' && loadingTimeout && !online && cached && cached.user?.id && cached.expiresAt) {
    return {
      session: {
        user: cached.user,
        expires: safeToISOString(cached.expiresAt),
      },
      status: 'authenticated',
      isOfflineSession: true,
    }
  }

  // Loading state — wait for both NextAuth and cached session check
  if (status === 'loading') {
    return { session: null, status: 'loading', isOfflineSession: false }
  }

  // Authenticated via NextAuth (online) — use the real session
  if (status === 'authenticated' && session) {
    return { session, status: 'authenticated', isOfflineSession: false }
  }

  // Unauthenticated via NextAuth — check if we have a cached offline session
  if (status === 'unauthenticated') {
    if (!online && cached && cached.user?.id && cached.expiresAt) {
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
