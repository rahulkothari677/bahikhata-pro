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

  /**
   * Put a shop away, or remove one that holds nothing.
   *
   * 🔒 #30 (2026-08-13). The API for this shipped with #21 and had no caller,
   * so a shopkeeper still could not do either — the same shape as the bank
   * statement, where the endpoint existed a day before its button.
   *
   * ONE function for both, because the server decides which is allowed and its
   * refusal is the useful part. Asking to delete a shop that traded comes back
   * with "holds 12 bill(s), 3 customer(s)… you can put it away instead", and
   * that sentence is worth far more than a client-side guess at the counts.
   *
   * The active shop is cleared if it was the one that left, so the app does not
   * keep pointing at a shop that is gone.
   */
  const removeShop = useCallback(async (shopId: string, mode: 'archive' | 'delete') => {
    const shop = shops.find(s => s.id === shopId)
    try {
      const qs = mode === 'archive' ? `?id=${shopId}&archive=1` : `?id=${shopId}`
      const r = await offlineFetch(`/api/shops${qs}`, {
        method: 'DELETE',
        offline: { invalidate: ['/api/shops'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json().catch(() => null)

      if (activeShopId === shopId) {
        setActiveShopId(null)
        try { localStorage.removeItem(ACTIVE_SHOP_KEY) } catch {}
      }
      queryClient.invalidateQueries()

      sonnerToast.success(
        mode === 'archive' ? 'Shop put away' : 'Shop removed',
        // The server's own sentence — it is the one that says the books are
        // still there, which is the part a shopkeeper needs to hear.
        { description: data?.message, duration: 8000 },
      )
      return true
    } catch (e: any) {
      sonnerToast.error(
        mode === 'archive' ? "Couldn't put the shop away" : "Couldn't remove the shop",
        {
          // The refusal explains what the shop holds and what to do instead.
          // Long, because it is an instruction rather than a notification.
          description: e?.message || `"${shop?.name ?? 'That shop'}" could not be changed. Please try again.`,
          duration: 12000,
        },
      )
      return false
    }
  }, [shops, activeShopId, queryClient])

  const activeShop = shops.find(s => s.id === activeShopId) || shops[0] || null

  return {
    shops,
    activeShop,
    activeShopId,
    switchShop,
    createShop,
    renameShop,
    removeShop,
    isLoading,
  }
}
