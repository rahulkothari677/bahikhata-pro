'use client'

/**
 * useBillTotals — the Bills list's totals for the whole period, from
 * /api/transactions/summary (Phase 5d, #184): the same filters as the list
 * (period, voided, search), every bill they select — never the rows loaded
 * so far. Refreshes with the list (refreshKey after a save).
 */
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { offlineFetch, OfflineError } from '@/lib/offline-fetch'
import type { DateRange } from '@/components/common/DateRangePicker'

export interface BillTotals {
  side: 'sale' | 'purchase'
  totals: {
    total: number; received: number; due: number; bills: number; unpaid: number
    returns: { count: number; amount: number }
    estimates: { count: number; amount: number } | null
    profit: number | null; netSales: number; margin: number | null
  }
  /** Naive IST midnight keys (the list groups its rows by the same key). */
  days: { day: string; total: number; bills: number }[]
}

export function useBillTotals(side: 'sale' | 'purchase', opts: { range: DateRange | null; voided: boolean; search: string }) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const qp = new URLSearchParams({ type: side === 'sale' ? 'sale,credit-note,estimate' : 'purchase,debit-note' })
  if (opts.voided) qp.set('voided', 'true')
  if (opts.range) {
    qp.set('from', opts.range.from.toISOString())
    qp.set('to', opts.range.to.toISOString())
  }
  if (opts.search) qp.set('search', opts.search)
  const q = qp.toString()
  return useQuery<BillTotals>({
    queryKey: ['bill-totals', q, refreshKey],
    queryFn: async () => {
      const r = await offlineFetch(`/api/transactions/summary?${q}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    staleTime: 30 * 1000,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === q ? prev : undefined),
    retry: (count, err) => !(err instanceof OfflineError) && !(err instanceof TypeError) && count < 1,
  })
}
