'use client'

/**
 * useInsights — one Insights section from /api/insights (Phase 5c), for the
 * period Home's chip shows. Refreshes with Home's figures (the same
 * refreshKey bump after a save), and a failure is an error state on screen,
 * never an empty section that reads as "nothing sold".
 */
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { offlineFetch, OfflineError } from '@/lib/offline-fetch'
import type { DateRange } from '@/components/common/DateRangePicker'
import type { InsightSection } from '@/lib/insights-view'

export interface Group { id: string; count: number; amount: number; share: number }

export interface SalesInsights {
  totals: { sales: number; bills: number; averageBill: number; returns: number; previous: number }
  payments: Group[]
  billsValue: number
  calendar: { day: string; label: string; amount: number }[]
  hours: { hour: number; perDay: number; bills: number }[]
  categories: Group[]
  beforeGst: number
  unmatched: number
}

export interface UdhaarInsights {
  totals: { toCollect: number; customers: number; collected: number; given: number }
  age: Group[]
  biggest: { id: string; name: string; balance: number; oldestUnpaid: string | null }[]
  toPay: { total: number; suppliers: number; biggest: { id: string; name: string; balance: number }[] }
}

export interface InsightsBySection { sales: SalesInsights; udhaar: UdhaarInsights }

export function useInsights<S extends InsightSection>(section: S, range: DateRange) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const from = range.from.toISOString(), to = range.to.toISOString()
  return useQuery<InsightsBySection[S]>({
    queryKey: ['insights', section, refreshKey, from, to],
    queryFn: async () => {
      const r = await offlineFetch(`/api/insights?section=${section}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 60 * 1000,
    // Keep the last answer on screen while a new period loads — the same section's only, never another's shape.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === section ? prev : undefined),
    retry: (count, err) => !(err instanceof OfflineError) && !(err instanceof TypeError) && count < 1,
  })
}
