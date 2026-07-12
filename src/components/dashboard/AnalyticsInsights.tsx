'use client'

/**
 * V17-Ext 5.5: Business Analytics — surfaces insight, not just tables.
 *
 * Matches SmartInsights design: gradient banner header with toggle,
 * color-coded sections, motion-animated entries.
 *
 * Shows 4 analytics:
 * 1. Best-selling items (last 30 days) — what's working
 * 2. Dead stock — money tied up in unsold inventory
 * 3. Most profitable customers — who to prioritize (owner only)
 * 4. Reorder suggestions — "you usually reorder X around now"
 *
 * Defensive: all hooks before early return, optional chaining everywhere.
 */

import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { formatINR, formatINRCompact, cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import { useAppStore } from '@/store/app-store'
import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3, Crown, PackageX, RefreshCw, ArrowRight,
  TrendingUp, Package, Users, ChevronDown,
} from 'lucide-react'

interface AnalyticsData {
  bestSellers: Array<{ name: string; quantity: number; revenue: number }>
  deadStock: Array<{ name: string; currentStock: number; unit: string; tiedUpValue: number }>
  topCustomers: Array<{ name: string; profit: number; totalSales: number }>
  reorderSuggestions: Array<{ name: string; avgGapDays: number; daysSinceLastPurchase: number; shouldReorder: boolean }>
}

export function AnalyticsInsights() {
  const { setView, setPreviousView } = useAppStore()
  const [expanded, setExpanded] = useState(true)

  // 🔒 Hooks first — Rules of Hooks
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: async () => {
      const r = await offlineFetch('/api/analytics')
      if (!r.ok) return { bestSellers: [], deadStock: [], topCustomers: [], reorderSuggestions: [] }
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading || !data) return null

  const hasBestSellers = data.bestSellers?.length > 0
  const hasDeadStock = data.deadStock?.length > 0
  const hasTopCustomers = data.topCustomers?.length > 0
  const hasReorder = data.reorderSuggestions?.length > 0

  if (!hasBestSellers && !hasDeadStock && !hasTopCustomers && !hasReorder) return null

  // Count active sections for the header badge
  const activeSections = [hasBestSellers, hasDeadStock, hasTopCustomers, hasReorder].filter(Boolean).length
  const criticalCount = (hasDeadStock ? 1 : 0) + (hasReorder ? 1 : 0) // actionable items

  return (
    <div className="rounded-2xl shadow-card border border-border/60 overflow-hidden">
      {/* Header — gradient banner matching SmartInsights style */}
      <div className="bg-gradient-to-r from-indigo-500 to-blue-600 p-3 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 pointer-events-none" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-heading tracking-tight">Business Analytics</h3>
              <p className="text-[10px] text-white/80">
                {criticalCount > 0 && `${criticalCount} action items · `}
                {activeSections} insights · Updated 5 min ago
              </p>
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-white/80 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition flex items-center gap-1"
          >
            {expanded ? 'Hide' : 'Show'}
            <ChevronDown className={cn('w-3 h-3 transition-transform', !expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-2 space-y-2">
          {/* 1. Top Sellers */}
          {hasBestSellers && (
            <AnalyticsSection
              icon={<Crown className="w-3.5 h-3.5" />}
              iconColor="text-amber-600 dark:text-amber-400"
              iconBg="bg-amber-100 dark:bg-amber-900/40"
              title="Top Sellers"
              subtitle="Last 30 days"
              entries={data.bestSellers.map((item, i) => ({
                rank: i + 1,
                label: item.name,
                right: (
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">{item.quantity} sold</span>
                    <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatINRCompact(item.revenue)}</span>
                  </div>
                ),
              }))}
            />
          )}

          {/* 2. Dead Stock */}
          {hasDeadStock && (
            <AnalyticsSection
              icon={<PackageX className="w-3.5 h-3.5" />}
              iconColor="text-rose-600"
              iconBg="bg-rose-100 dark:bg-rose-900/40"
              title="Dead Stock"
              subtitle="No sales in 90 days"
              entries={data.deadStock.map((item, i) => ({
                rank: i + 1,
                label: item.name,
                sublabel: `${item.currentStock} ${item.unit} in stock`,
                right: (
                  <span className="text-xs font-medium text-rose-600 tabular-nums">
                    {formatINR(item.tiedUpValue)} tied up
                  </span>
                ),
              }))}
            />
          )}

          {/* 3. Most Profitable Customers */}
          {hasTopCustomers && (
            <AnalyticsSection
              icon={<Users className="w-3.5 h-3.5" />}
              iconColor="text-emerald-600 dark:text-emerald-400"
              iconBg="bg-emerald-100 dark:bg-emerald-900/40"
              title="Most Profitable Customers"
              subtitle="Last 90 days"
              entries={data.topCustomers.map((customer, i) => ({
                rank: i + 1,
                label: customer.name,
                right: (
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">{formatINRCompact(customer.totalSales)} sales</span>
                    <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatINRCompact(customer.profit)}</span>
                  </div>
                ),
              }))}
            />
          )}

          {/* 4. Reorder Suggestions */}
          {hasReorder && (
            <AnalyticsSection
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              iconColor="text-blue-600"
              iconBg="bg-blue-100 dark:bg-blue-900/40"
              title="Time to Reorder"
              subtitle="Based on your purchase patterns"
              entries={data.reorderSuggestions.map((item, i) => ({
                rank: i + 1,
                label: item.name,
                sublabel: `~${item.avgGapDays} day cycle · last ordered ${item.daysSinceLastPurchase} days ago`,
                right: (
                  <Badge className="bg-blue-600 text-white hover:bg-blue-700">Overdue</Badge>
                ),
              }))}
              action={{
                label: 'Create Purchase',
                onClick: () => {
                  setPreviousView('dashboard')
                  setView('new-purchase')
                },
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Reusable section component ───────────────────────────────────

function AnalyticsSection({
  icon, iconColor, iconBg, title, subtitle, entries, action,
}: {
  icon: React.ReactNode
  iconColor: string
  iconBg: string
  title: string
  subtitle: string
  entries: Array<{ rank: number; label: string; sublabel?: string; right: React.ReactNode }>
  action?: { label: string; onClick: () => void }
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/40 bg-background/50 p-2.5"
    >
      {/* Section header */}
      <div className="flex items-center gap-2 mb-2">
        <div className={cn('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0', iconBg)}>
          <span className={iconColor}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-foreground">{title}</p>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {/* Entries */}
      <div className="space-y-1">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-sm py-0.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[10px] font-bold text-muted-foreground w-4 flex-shrink-0">{entry.rank}</span>
              <div className="min-w-0">
                <p className="truncate">{entry.label}</p>
                {entry.sublabel && (
                  <p className="text-[10px] text-muted-foreground truncate">{entry.sublabel}</p>
                )}
              </div>
            </div>
            {entry.right}
          </div>
        ))}
      </div>

      {/* Action button */}
      {action && (
        <button
          onClick={action.onClick}
          className="text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1 mt-2"
        >
          {action.label}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </motion.div>
  )
}
