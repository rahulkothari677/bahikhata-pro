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
import { toast as sonnerToast } from 'sonner'

const ACTIVE_SHOP_KEY = 'bahikhata:active-shop'

export function useShops() {
  const queryClient = useQueryClient()
  const [activeShopId, setActiveShopId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await offlineFetch('/api/shops')
      return r.json()
    },
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
      if (!r.ok) throw new Error('Failed')
      const data = await r.json()
      queryClient.invalidateQueries({ queryKey: ['shops'] })
      sonnerToast.success(`Shop "${shopData.name}" created!`)
      return data.shop
    } catch {
      sonnerToast.error('Failed to create shop')
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
    isLoading,
  }
}
