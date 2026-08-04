'use client'

/**
 * useShops — manages multiple shops for a user.
 *
 * - Fetches all shops on mount
 * - Tracks the active shop (stored in localStorage)
 * - Provides createShop() to add new shops
 * - Active shop ID is used by API calls to filter data
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useCallback } from 'react'
import { offlineFetch } from '@/lib/offline-fetch'
import { readError } from '@/lib/read-error'
import { toast as sonnerToast } from 'sonner'
import { useAppStore } from '@/store/app-store'

const ACTIVE_SHOP_KEY = 'bahikhata:active-shop'

export function useShops() {
  const queryClient = useQueryClient()
  const [activeShopId, setActiveShopId] = useState<string | null>(null)
  // 🔒 V21-008: Wait for bootstrap to prime the cache before fetching.
  const bootstrapDone = useAppStore((s) => s.bootstrapDone)

  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await offlineFetch('/api/shops')
      return r.json()
    },
    // 🔒 V21-008: Don't fetch until bootstrap has primed the cache.
    enabled: bootstrapDone,
  })

  const shops: any[] = data?.shops || []

  // Load active shop from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_SHOP_KEY)
      if (saved) {
        setActiveShopId(saved)
      }
    } catch {}
  }, [])

  // When shops load, set active shop if not set
  useEffect(() => {
    if (shops.length > 0 && !activeShopId) {
      const defaultShop = shops.find(s => s.isDefault) || shops[0]
      setActiveShopId(defaultShop.id)
    }
  }, [shops, activeShopId])

  const switchShop = useCallback((shopId: string) => {
    setActiveShopId(shopId)
    try {
      localStorage.setItem(ACTIVE_SHOP_KEY, shopId)
    } catch {}
    // Invalidate all data queries so they refetch for the new shop
    queryClient.invalidateQueries()
    sonnerToast.success(`Switched to ${shops.find(s => s.id === shopId)?.name || 'shop'}`)
  }, [shops, queryClient])

  const createShop = useCallback(async (shopData: { name: string; gstin?: string; address?: string; phone?: string; state?: string }) => {
    try {
      const r = await offlineFetch('/api/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shopData),
        offline: { invalidate: ['/api/shops'] },
      })
      /*
       * 🔒 2026-08-03 (audit): was `throw new Error('Failed')` and a bare
       * "Failed to create shop" toast, which threw away what the server said.
       * The plan cap is a real, reachable answer here — a Pro account is
       * refused a 4th shop with "You've reached the PRO plan limit of 3 shops.
       * Upgrade to Elite for unlimited shops." The owner saw none of it and
       * had no way to tell a plan limit from an outage.
       */
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json()
      queryClient.invalidateQueries({ queryKey: ['shops'] })
      sonnerToast.success(`Shop "${shopData.name}" created!`)
      return data.shop
    } catch (e: any) {
      sonnerToast.error("Couldn't create the shop", { description: e?.message || 'Please try again.' })
      return null
    }
  }, [queryClient])

  /**
   * Rename a shop. Name only — GSTIN/address/state feed GST derivation and
   * appear on filings, so they are not editable from a rename box.
   */
  const renameShop = useCallback(async (shopId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      sonnerToast.error('Shop name cannot be empty')
      return null
    }
    try {
      const r = await offlineFetch('/api/shops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: shopId, name: trimmed }),
        offline: { invalidate: ['/api/shops'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json()
      queryClient.invalidateQueries({ queryKey: ['shops'] })
      // The default shop's name is mirrored from the business profile, so the
      // settings card can be showing the old one until it refetches.
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      sonnerToast.success(`Renamed to "${trimmed}"`)
      return data.shop
    } catch (e: any) {
      sonnerToast.error("Couldn't rename the shop", { description: e?.message || 'Please try again.' })
      return null
    }
  }, [queryClient])

  const activeShop = shops.find(s => s.id === activeShopId) || shops[0] || null

  return {
    shops,
    activeShop,
    activeShopId,
    switchShop,
    createShop,
    renameShop,
    isLoading,
  }
}
