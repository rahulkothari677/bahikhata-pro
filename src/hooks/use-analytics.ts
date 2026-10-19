'use client'

/**
 * useAnalytics — top customers and buy-again from /api/analytics, for Home's
 * Top lists (Phase 5b-5). Best sellers and dead stock left with the Business
 * Analytics card in 5c-4 (#240: one engine).
 */
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'

export interface AnalyticsData {
  /** Last 90 days, by profit; empty when profit is hidden. */
  topCustomers: Array<{ name: string; profit: number; totalSales: number }>
  /** From 180 days of purchases: how often each item is bought, and how long since. */
  reorderSuggestions: Array<{ name: string; avgGapDays: number; daysSinceLastPurchase: number; shouldReorder: boolean }>
}

const EMPTY: AnalyticsData = { topCustomers: [], reorderSuggestions: [] }

export function useAnalytics() {
  return useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: async () => {
      const r = await offlineFetch('/api/analytics')
      if (!r.ok) return EMPTY
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}
