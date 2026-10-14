'use client'

/**
 * useDaySummary — today's cash and sales split from /api/day-summary.
 *
 * One query for the three places that read it: Home's "Cash in drawer"
 * figure, its "how it is worked out" sheet, and the Close-the-day dialog
 * (Phase 5b-2). One key, so the three always show the same figure, and the
 * shared refreshKey in the key, so a sale saved anywhere refreshes it like
 * the rest of Home.
 */
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { offlineFetch } from '@/lib/offline-fetch'
import { readError } from '@/lib/read-error'

export function useDaySummary(enabled = true) {
  const refreshKey = useAppStore((s) => s.refreshKey)
  return useQuery({
    queryKey: ['day-summary', refreshKey],
    queryFn: async () => {
      const r = await offlineFetch('/api/day-summary')
      if (!r.ok) throw new Error(await readError(r))
      return r.json()
    },
    enabled,
  })
}
