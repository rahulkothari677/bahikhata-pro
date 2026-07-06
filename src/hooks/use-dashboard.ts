'use client'

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { offlineFetch, OfflineError } from '@/lib/offline-fetch'
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
 * Usage:
 *   const { data, isLoading, error } = useDashboard(dateRange)
 */

// Canonicalize a date to day granularity (strips hours/minutes/seconds/ms)
// This ensures the same logical date range always produces the same cache key
function canonicalizeDate(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

export function useDashboard(dateRange: DateRange) {
  const { refreshKey } = useAppStore()

  // Canonicalize dates to day granularity for stable cache keys
  const fromKey = canonicalizeDate(dateRange.from).toISOString()
  const toKey = canonicalizeDate(dateRange.to).toISOString()

  return useQuery({
    queryKey: ['dashboard', refreshKey, fromKey, toKey],
    queryFn: async () => {
      // Use the actual (non-canonicalized) dates for the API call
      const r = await offlineFetch(
        `/api/dashboard?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`
      )
      if (!r.ok) {
        // 🔒 V9 2.5: Don't leak DB internals. Extract only the generic message
        // + errorId (if provided) so the user can report it to support.
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
    staleTime: 60 * 1000, // 1 min — don't refetch within 1 min
    // 🔒 V8 U8: Show cached data instantly while fresh data loads.
    // When date range changes, old data stays visible until new data arrives.
    placeholderData: (prev) => prev,  // keepPreviousData equivalent
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
