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

export interface TopItem { id: string; name: string; sales: number; qty: number; profit: number | null }
export interface ItemsInsights {
  totals: { sold: number; items: number; stockValue: number; outOfStock: number }
  abc: Group[]
  stock: { out: number; low: number; notSoldPeriod: { count: number; stockValue: number }; notSold90: { count: number; stockValue: number } }
  top: { sales: TopItem[]; qty: TopItem[]; profit: TopItem[] }
}

export interface TopCustomer { id: string; name: string; sales: number; bills: number; profit: number | null }
export interface CustomersInsights {
  totals: { bought: number; customers: number; newCount: number; walkInShare: number }
  groups: Group[]
  namedVsWalkIn: Group[]
  top: { sales: TopCustomer[]; bills: TopCustomer[]; profit: TopCustomer[] }
}

export interface ProfitInsights {
  totals: { profit: number; netSales: number; margin: number | null; previous: number; afterExpenses: number; expenses: number; income: number }
  unmatched: { sales: number; profit: number }
  byCategory: { id: string; sales: number; profit: number; margin: number | null }[]
  lowest: { id: string; name: string; sales: number; profit: number; margin: number }[]
  costUp: { id: string; name: string; previous: number; latest: number; salePrice: number; earnNow: number; earnBefore: number; date: string }[]
}

export interface InsightsBySection { sales: SalesInsights; items: ItemsInsights; customers: CustomersInsights; udhaar: UdhaarInsights; profit: ProfitInsights }

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
