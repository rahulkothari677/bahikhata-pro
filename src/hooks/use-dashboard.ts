'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { offlineFetch, OfflineError } from '@/lib/offline-fetch'
import { getCachedResponse } from '@/lib/offline-db'
import { getPresetRange, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'

/**
 * 🔒 PERFORMANCE FIX (auditor report P0): Single shared dashboard query hook.
 *
 * Was: 3 separate callers (Dashboard.tsx, SmartInsights.tsx, NotificationCenter.tsx)
 * each with different query keys and live `new Date()` timestamps → React Query
 * treated them as separate queries → 3+ API calls per page load.
 *
 * Now: ONE hook, ONE query key, ONE API call. All components consume the same
 * cached data. Date range is canonicalized to day granularity (not millisecond)
 * so identical ranges produce identical cache keys.
 *
 * 🔒 V9 4.1/M8: On subsequent loads, reads from IndexedDB cache (~1ms) and
 * shows it as placeholderData while the network response loads. This makes
 * the dashboard feel instant on repeat visits — the user sees their data
 * immediately, then it refreshes in the background.
 */

// Canonicalize a date to day granularity (strips hours/minutes/seconds/ms)
function canonicalizeDate(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

export function useDashboard(dateRange: DateRange) {
  const { refreshKey } = useAppStore()
  // 🔒 V21-006: Gate the network fetch behind DB warmup. The cached data
  // (placeholderData) still shows instantly from IndexedDB — only the
  // network fetch is deferred until warmup completes. This prevents the
  // dashboard query from racing with warmup for the DB connection.
  const dbWarmedUp = useAppStore((s) => s.dbWarmedUp)

  // Canonicalize dates to day granularity for stable cache keys
  const fromKey = canonicalizeDate(dateRange.from).toISOString()
  const toKey = canonicalizeDate(dateRange.to).toISOString()

  // 🔒 V9 M8: Read from IndexedDB cache on mount for instant first paint.
  // The cache key matches what offlineFetch uses to cache GET responses.
  const cacheKey = `/api/dashboard?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`
  const [cachedData, setCachedData] = useState<any>(undefined)

  useEffect(() => {
    let cancelled = false
    getCachedResponse(cacheKey).then(cached => {
      if (!cancelled && cached?.body) {
        try {
          setCachedData(JSON.parse(cached.body))
        } catch {
          // Cache corrupted — ignore, will fetch from network
        }
      }
    })
    return () => { cancelled = true }
  }, [cacheKey])

  return useQuery({
    queryKey: ['dashboard', refreshKey, fromKey, toKey],
    queryFn: async () => {
      const r = await offlineFetch(
        `/api/dashboard?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`
      )
      if (!r.ok) {
        let errorDetail = `HTTP ${r.status}`
        try {
          const body = await r.json()
          if (body?.message) errorDetail = body.message
          if (body?.errorId) errorDetail += ` (ref: ${body.errorId})`
        } catch {
          // Response wasn't JSON — keep the status code
        }
        throw new Error(errorDetail)
      }
      return r.json()
    },
    // 🔒 V21-006: Don't fetch until DB is warmed up. placeholderData (IndexedDB
    // cache) still shows instantly — only the network fetch is deferred.
    enabled: dbWarmedUp,
    staleTime: 60 * 1000,
    // 🔒 V9 M8: Use IndexedDB cached data as placeholder on first load.
    // Shows cached data instantly (~1ms from IndexedDB) while network loads.
    // Combined with (prev) => prev for date-range changes (keepPreviousData).
    placeholderData: (prev) => prev || cachedData,
    retry: (count, err) => {
      if (err instanceof OfflineError) return false
      if (err instanceof TypeError) return false
      return count < 1
    },
  })
}

/**
 * Convenience hook for "this month" dashboard data (used by SmartInsights,
 * NotificationCenter, and other components that don't have a date picker).
 */
export function useDashboardThisMonth() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return useDashboard({ from: monthStart, to: now })
}
