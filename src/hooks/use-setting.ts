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
import { useAppStore } from '@/store/app-store'

export function useSetting() {
  const queryClient = useQueryClient()
  // 🔒 V21-008: Wait for bootstrap to prime the cache before fetching.
  // Bootstrap consolidates settings + shops + subscription into ONE request.
  // Without this gate, useSetting fires immediately and fetches /api/settings
  // separately, defeating the consolidation.
  const bootstrapDone = useAppStore((s) => s.bootstrapDone)
  const { data } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
    // 🔒 V21-008: Don't fetch until bootstrap has primed the cache.
    // Once primed, this hook reads from cache (no network request).
    enabled: bootstrapDone,
    // 🔒 AUDIT V23 FIX §5: Shared staleTime (5 min, matching bootstrap).
    // Without this, the primed cache is instantly "stale" (default staleTime=0)
    // and refetches on every mount, defeating the bootstrap consolidation.
    staleTime: 5 * 60 * 1000, // 5 minutes
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
      /*
       * 🔒 2026-08-09: send ONLY the field being changed.
       *
       * This used to PUT `{ ...currentSetting, hideProfit: newValue }` — the
       * whole settings row, as this client last read it. /api/settings applies
       * every key present in the body, so that turned a one-field toggle into
       * a full-row overwrite from a possibly stale snapshot: any change made
       * since this tab loaded — on the shopkeeper's desktop, by staff, or on a
       * second phone — was silently reverted.
       *
       * Reproduced in a browser against a real database: with the Preferences
       * page open, setting a UPI ID from elsewhere and then flipping Hide
       * Profit erased it. Nothing warned anyone; the shop would simply stop
       * collecting payments, and the Pay button on every bill link would
       * vanish, because buildUpiLink returns null without a VPA.
       *
       * Every other toggle in Settings already sends a single key, and the
       * route builds its update from `body.X !== undefined`, so partial
       * writes are what it expects. This was the one outlier.
       */
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hideProfit: newValue }),
        offline: { invalidate: ['/api/settings', '/api/dashboard'] },
      })
      // 🔒 2026-07-22: this is the pattern Settings.tsx cited as its model,
      // and it had the same hole. offlineFetch RESOLVES with the Response on a
      // 4xx/5xx, so a rejected save skipped the catch and the revert never ran.
      // Worst case for a shop: the owner turns ON "hide profit" for staff, sees
      // it switch on, and the server never stored it — staff keep seeing the
      // margin on every product. A privacy setting that silently fails open.
      if (!r.ok) throw new Error(`Failed to save (${r.status})`)
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
