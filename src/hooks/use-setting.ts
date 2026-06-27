'use client'

/**
 * useSetting — app-wide access to user settings.
 *
 * Currently provides:
 * - hideProfit: when true, profit figures are hidden from all UI
 *   (dashboard, ledger, transaction detail). Data is still calculated
 *   and stored — only the display is hidden.
 *
 * This hook reads from React Query cache (the same ['setting'] query
 * used by Sidebar, Header, TransactionDetail, etc.) so it's always
 * in sync. No extra API call needed.
 */

import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'

export function useSetting() {
  const { data } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  const setting = data?.setting || {}
  const hideProfit = setting.hideProfit === true

  return {
    hideProfit,
    setting,
  }
}
