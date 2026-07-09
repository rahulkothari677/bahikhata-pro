'use client'

/**
 * V17-Ext 5.5: Business Analytics — surfaces insight, not just tables.
 *
 * Shows 4 analytics on the dashboard:
 * 1. Best-selling items (last 30 days) — what's working
 * 2. Dead stock — money tied up in unsold inventory
 * 3. Most profitable customers — who to prioritize (owner only)
 * 4. Reorder suggestions — "you usually reorder X around now"
 *
 * Defensive coding: all data access uses optional chaining, all hooks
 * called before any early return (Rules of Hooks), empty state handled
 * gracefully (if no data, the section just doesn't render).
 */

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatINR, formatINRCompact, cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import {
  BarChart3, PackageX, Crown, RefreshCw, ArrowRight,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { motion } from 'framer-motion'

interface AnalyticsData {
  bestSellers: Array<{ name: string; quantity: number; revenue: number }>
  deadStock: Array<{ name: string; currentStock: number; unit: string; tiedUpValue: number }>
  topCustomers: Array<{ name: string; profit: number; totalSales: number }>
  reorderSuggestions: Array<{ name: string; avgGapDays: number; daysSinceLastPurchase: number; shouldReorder: boolean }>
}

export function AnalyticsInsights() {
  const { setView, setPreviousView } = useAppStore()

  // 🔒 Hooks first — Rules of Hooks. Query is always called.
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: async () => {
      const r = await offlineFetch('/api/analytics')
      if (!r.ok) return { bestSellers: [], deadStock: [], topCustomers: [], reorderSuggestions: [] }
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 min cache
  })

  // 🔒 Defensive: if no data or all sections empty, don't render the card.
  // This avoids showing an empty analytics section on new accounts.
  if (isLoading || !data) return null

  const hasBestSellers = data.bestSellers?.length > 0
  const hasDeadStock = data.deadStock?.length > 0
  const hasTopCustomers = data.topCustomers?.length > 0
  const hasReorder = data.reorderSuggestions?.length > 0

  if (!hasBestSellers && !hasDeadStock && !hasTopCustomers && !hasReorder) return null

  return (
    <Card className="shadow-card border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-violet-600" />
          Business Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 1. Best-selling items */}
        {hasBestSellers && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Crown className="w-3.5 h-3.5 text-amber-500" />
              Top Sellers (30 days)
            </p>
            <div className="space-y-1">
              {data.bestSellers.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}.</span>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">{item.quantity} sold</span>
                    <span className="font-semibold tabular-nums text-emerald-600">{formatINRCompact(item.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. Dead stock */}
        {hasDeadStock && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <PackageX className="w-3.5 h-3.5 text-rose-500" />
              Dead Stock (no sales in 90 days)
            </p>
            <div className="space-y-1">
              {data.deadStock.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}.</span>
                    <span className="truncate">{item.name}</span>
                    <span className="text-xs text-muted-foreground">{item.currentStock} {item.unit}</span>
                  </div>
                  <span className="text-xs font-medium text-rose-600 tabular-nums">
                    {formatINRCompact(item.tiedUpValue)} tied up
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Most profitable customers */}
        {hasTopCustomers && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Crown className="w-3.5 h-3.5 text-emerald-500" />
              Most Profitable Customers (90 days)
            </p>
            <div className="space-y-1">
              {data.topCustomers.map((customer, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}.</span>
                    <span className="truncate">{customer.name}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">{formatINRCompact(customer.totalSales)} sales</span>
                    <span className="font-semibold tabular-nums text-emerald-600">{formatINRCompact(customer.profit)} profit</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Reorder suggestions */}
        {hasReorder && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
              Time to Reorder
            </p>
            <div className="space-y-1">
              {data.reorderSuggestions.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}.</span>
                    <span className="truncate">{item.name}</span>
                  </div>
                  <span className="text-xs text-blue-600 tabular-nums">
                    ~{item.avgGapDays}d cycle · {item.daysSinceLastPurchase}d ago
                  </span>
                </div>
              ))}
              <button
                onClick={() => {
                  setPreviousView('dashboard')
                  setView('new-purchase')
                }}
                className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1 mt-1"
              >
                Create Purchase <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
