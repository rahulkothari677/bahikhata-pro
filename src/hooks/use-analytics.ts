'use client'

/**
 * useAnalytics — best sellers, dead stock, top customers and buy-again from
 * /api/analytics. One query for Business Analytics and Home's Top lists
 * (Phase 5b-5), so the two never show different lists.
 */
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'

export interface AnalyticsData {
  bestSellers: Array<{ name: string; quantity: number; revenue: number }>
  deadStock: Array<{ name: string; currentStock: number; unit: string; tiedUpValue: number }>
  /** Last 90 days, by profit; empty when profit is hidden. */
  topCustomers: Array<{ name: string; profit: number; totalSales: number }>
  /** From 180 days of purchases: how often each item is bought, and how long since. */
  reorderSuggestions: Array<{ name: string; avgGapDays: number; daysSinceLastPurchase: number; shouldReorder: boolean }>
}

const EMPTY: AnalyticsData = { bestSellers: [], deadStock: [], topCustomers: [], reorderSuggestions: [] }

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
