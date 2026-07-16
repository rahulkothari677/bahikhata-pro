'use client'

/**
 * useBootstrap — fetches consolidated boot data in ONE request.
 *
 * 🔒 V21-007: Consolidates settings + shops + subscription into a single
 * /api/bootstrap call. This reduces the boot fan-out from ~14 requests to
 * ~11 (3 become 1), which is critical when connection_limit=1 on Neon.
 *
 * 🔒 V21-008: Sets bootstrapDone=true when complete, which gates the
 * individual hooks (use-setting, use-shops, use-subscription). They read
 * from the primed cache instead of fetching separately.
 *
 * After fetching, primes the React Query cache for:
 *   - ['setting'] (used by use-setting.ts)
 *   - ['shops'] (used by use-shops.ts)
 *   - ['subscription-status'] (used by use-subscription.ts)
 *
 * So when those hooks mount, they read from cache instantly — no extra
 * network request.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { offlineFetch } from '@/lib/offline-fetch'
import { useAppStore } from '@/store/app-store'

export function useBootstrap(enabled: boolean) {
  const queryClient = useQueryClient()
  const setBootstrapDone = useAppStore((s) => s.setBootstrapDone)

  const { data, isLoading, error } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => {
      const r = await offlineFetch('/api/bootstrap')
      if (!r.ok) throw new Error(`Bootstrap failed: HTTP ${r.status}`)
      return r.json()
    },
    enabled,
    staleTime: 5 * 60 * 1000,  // 5 min — boot data doesn't change often
    retry: 1,
  })

  // Prime the individual query caches + set bootstrapDone flag
  useEffect(() => {
    if (!data) return

    // Prime settings cache
    if (data.settings) {
      queryClient.setQueryData(['setting'], data.settings)
    }

    // Prime shops cache
    if (data.shops) {
      queryClient.setQueryData(['shops'], data.shops)
    }

    // Prime subscription cache
    if (data.subscription) {
      queryClient.setQueryData(['subscription-status'], data.subscription)
    }

    // 🔒 V21-008: Signal that bootstrap is done — the individual hooks can
    // now read from the primed cache instead of fetching separately.
    setBootstrapDone(true)
  }, [data, queryClient, setBootstrapDone])

  // 🔒 AUDIT V23 FIX §5: Also set bootstrapDone=true on error.
  // If bootstrap fails (403 for staff/CA, or network error), the gated hooks
  // (useSetting, useShops, useSubscription) stay disabled all session —
  // Switch Shop breaks for staff, settings may not load. By setting
  // bootstrapDone=true on error, the individual hooks will fetch on their own
  // (graceful degradation). The primed cache won't exist, but the hooks will
  // query the API directly.
  useEffect(() => {
    if (error) {
      setBootstrapDone(true)
    }
  }, [error, setBootstrapDone])

  return { data, isLoading, error }
}

