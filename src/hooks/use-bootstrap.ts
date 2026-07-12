'use client'

/**
 * useBootstrap — fetches consolidated boot data in ONE request.
 *
 * 🔒 V21-007: Consolidates settings + shops + subscription into a single
 * /api/bootstrap call. This reduces the boot fan-out from ~14 requests to
 * ~11 (3 become 1), which is critical when connection_limit=1 on Neon.
 *
 * After fetching, primes the React Query cache for:
 *   - ['setting'] (used by use-setting.ts)
 *   - ['shops'] (used by use-shops.ts)
 *   - ['subscription'] (used by use-subscription.ts)
 *
 * So when those hooks mount, they read from cache instantly — no extra
 * network request.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { offlineFetch } from '@/lib/offline-fetch'

export function useBootstrap(enabled: boolean) {
  const queryClient = useQueryClient()

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

  // Prime the individual query caches so use-setting, use-shops, and
  // use-subscription read from cache instead of fetching separately.
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
  }, [data, queryClient])

  return { data, isLoading, error }
}
