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
 *
 * updateHideProfit: persists the new value to the server AND updates
 * the React Query cache optimistically so all components re-render
 * instantly. No need to click "Save" separately.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { useState, useEffect } from 'react'

export function useSetting() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  const setting = data?.setting || {}
  // Use state to track hideProfit so it updates instantly when toggled
  const [hideProfit, setHideProfitState] = useState(setting.hideProfit === true)

  // Sync with query data when it changes (e.g., after server fetch)
  useEffect(() => {
    setHideProfitState(setting.hideProfit === true)
  }, [setting.hideProfit])

  // Update hideProfit optimistically + persist to server
  const updateHideProfit = async (newValue: boolean) => {
    // Optimistic update — update cache immediately so UI changes instantly
    queryClient.setQueryData(['setting'], (old: any) => ({
      ...old,
      setting: { ...old?.setting, hideProfit: newValue },
    }))
    setHideProfitState(newValue)

    // Persist to server in background
    try {
      const currentSetting = setting || {}
      await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...currentSetting, hideProfit: newValue }),
        offline: { invalidate: ['/api/settings', '/api/dashboard'] },
      })
      // Invalidate so all components get the fresh data from server
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch (err) {
      // Revert on failure
      setHideProfitState(!newValue)
      queryClient.setQueryData(['setting'], (old: any) => ({
        ...old,
        setting: { ...old?.setting, hideProfit: !newValue },
      }))
    }
  }

  return {
    hideProfit,
    setting,
    updateHideProfit,
  }
}
