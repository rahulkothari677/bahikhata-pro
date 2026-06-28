'use client'

/**
 * SmartInsights — AI-powered business insights displayed on the dashboard.
 *
 * Combines 4 smart features:
 * 1. Smart Reorder Suggestions — predicts when stock will run out
 * 2. Profit Margin Alerts — products with low/negative margins
 * 3. Sales Pattern Detection — weekend spikes, trends, gaps
 * 4. Customer Credit Risk — parties with high outstanding + slow payment
 *
 * All computed client-side from existing dashboard data — no extra API calls.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatINR, formatINRCompact } from '@/lib/utils'
import {
  Sparkles, TrendingUp, TrendingDown, AlertTriangle, Package,
  ShoppingCart, Calendar, User, ArrowRight, Percent, Clock,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useState } from 'react'

export function SmartInsights() {
  const { setView, setPreviousView } = useAppStore()
  const { data } = useDashboardData()
  const [expanded, setExpanded] = useState(true)

  if (!data) return null

  const insights = computeInsights(data)

  if (insights.length === 0) return null

  const criticalCount = insights.filter(i => i.severity === 'critical').length
  const warningCount = insights.filter(i => i.severity === 'warning').length

  return (
    <Card className="shadow-card border-border/60 overflow-hidden">
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-4 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <div>
              <h3 className="text-base font-bold">Smart Insights</h3>
              <p className="text-[11px] text-white/80">
                {criticalCount > 0 && `${criticalCount} critical · `}
                {warningCount > 0 && `${warningCount} warnings · `}
                AI-powered business intelligence
              </p>
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-white/80 hover:text-white text-xs"
          >
            {expanded ? 'Hide' : 'Show all'}
          </button>
        </div>
      </div>

      {expanded && (
        <CardContent className="p-3 space-y-2">
          {insights.map((insight, i) => {
            const Icon = insight.icon
            return (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border transition',
                  insight.severity === 'critical' && 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50',
                  insight.severity === 'warning' && 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50',
                  insight.severity === 'info' && 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50',
                  insight.severity === 'positive' && 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50',
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                  insight.severity === 'critical' && 'bg-rose-100 dark:bg-rose-900/40',
                  insight.severity === 'warning' && 'bg-amber-100 dark:bg-amber-900/40',
                  insight.severity === 'info' && 'bg-blue-100 dark:bg-blue-900/40',
                  insight.severity === 'positive' && 'bg-emerald-100 dark:bg-emerald-900/40',
                )}>
                  <Icon className={cn(
                    'w-4 h-4',
                    insight.severity === 'critical' && 'text-rose-600',
                    insight.severity === 'warning' && 'text-amber-600',
                    insight.severity === 'info' && 'text-blue-600',
                    insight.severity === 'positive' && 'text-emerald-600',
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{insight.description}</p>
                  {insight.action && (
                    <button
                      onClick={insight.action.onClick}
                      className="text-[11px] text-primary font-medium mt-1.5 hover:underline flex items-center gap-1"
                    >
                      {insight.action.label}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      )}
    </Card>
  )
}

// ─── Insight computation ───────────────────────────────────────────

type Insight = {
  title: string
  description: string
  icon: any
  severity: 'critical' | 'warning' | 'info' | 'positive'
  action?: { label: string; onClick: () => void }
}

function computeInsights(data: any): Insight[] {
  const insights: Insight[] = []
  const { kpis, lowStockProducts, topProducts, recentTransactions, salesTrend } = data

  // ─── 1. Smart Reorder Suggestions ─────────────────────────────
  if (lowStockProducts && lowStockProducts.length > 0) {
    lowStockProducts.slice(0, 3).forEach((p: any) => {
      // Estimate days until stockout based on sales velocity
      const salesVelocity = topProducts?.find((tp: any) => tp.id === p.id)?.quantity || 0
      const daysLeft = p.currentStock > 0 && salesVelocity > 0
        ? Math.ceil(p.currentStock / (salesVelocity / 30))
        : p.currentStock <= 0 ? 0 : 999

      insights.push({
        title: p.currentStock <= 0
          ? `${p.name} is OUT OF STOCK`
          : daysLeft <= 7
            ? `${p.name} will run out in ~${daysLeft} days`
            : `${p.name} is running low (${p.currentStock} ${p.unit} left)`,
        description: p.currentStock <= 0
          ? `Stock: ${p.currentStock} ${p.unit}. Restock immediately — you're losing sales.`
          : `Stock: ${p.currentStock} ${p.unit} · Threshold: ${p.lowStockThreshold} ${p.unit}. Consider reordering soon.`,
        icon: Package,
        severity: p.currentStock <= 0 ? 'critical' : daysLeft <= 7 ? 'warning' : 'warning',
        action: {
          label: 'Create Purchase',
          onClick: () => {
            const { useAppStore } = require('@/store/app-store')
            useAppStore.getState().setPreviousView('dashboard')
            useAppStore.getState().setView('new-purchase')
          },
        },
      })
    })
  }

  // ─── 2. Profit Margin Alerts ─────────────────────────────────
  if (kpis) {
    const margin = kpis.todayRevenue > 0 ? (kpis.todayProfit / kpis.todayRevenue) * 100 : 0
    if (kpis.todayRevenue > 0 && margin < 10 && margin >= 0) {
      insights.push({
        title: `Profit margin is low (${margin.toFixed(1)}%)`,
        description: `Today's profit margin is below 10%. Revenue: ${formatINR(kpis.todayRevenue)}, Profit: ${formatINR(kpis.todayProfit)}. Consider reviewing your pricing.`,
        icon: Percent,
        severity: 'warning',
      })
    }
    if (kpis.todayProfit < 0 && kpis.todayRevenue > 0) {
      insights.push({
        title: `Selling at a LOSS today!`,
        description: `Today's profit is negative (${formatINR(kpis.todayProfit)}). You're selling below cost price. Review your prices immediately.`,
        icon: TrendingDown,
        severity: 'critical',
      })
    }
    // Margin trend
    if (kpis.profitGrowth < -10) {
      insights.push({
        title: `Profit declining (${kpis.profitGrowth.toFixed(1)}% vs last period)`,
        description: `Your profit has dropped significantly compared to the previous period. Check if costs have increased or if you're discounting too much.`,
        icon: TrendingDown,
        severity: 'warning',
      })
    }
  }

  // ─── 3. Sales Pattern Detection ──────────────────────────────
  if (salesTrend && salesTrend.length >= 7) {
    // Weekend vs weekday analysis
    const weekdaySales = salesTrend.filter((d: any) => {
      const day = new Date(d.date || d.label).getDay()
      return day >= 1 && day <= 5
    })
    const weekendSales = salesTrend.filter((d: any) => {
      const day = new Date(d.date || d.label).getDay()
      return day === 0 || day === 6
    })

    const avgWeekday = weekdaySales.length > 0
      ? weekdaySales.reduce((s: number, d: any) => s + (d.revenue || 0), 0) / weekdaySales.length
      : 0
    const avgWeekend = weekendSales.length > 0
      ? weekendSales.reduce((s: number, d: any) => s + (d.revenue || 0), 0) / weekendSales.length
      : 0

    if (avgWeekend > avgWeekday * 1.3 && avgWeekday > 0) {
      const pct = ((avgWeekend / avgWeekday - 1) * 100).toFixed(0)
      insights.push({
        title: `Weekend sales are ${pct}% higher than weekdays`,
        description: `Your average weekend revenue (${formatINRCompact(avgWeekend)}) is significantly higher than weekdays (${formatINRCompact(avgWeekday)}). Consider stocking up before weekends.`,
        icon: Calendar,
        severity: 'info',
      })
    }

    // No sales in recent days
    const lastSale = recentTransactions?.find((t: any) => t.type === 'sale')
    if (lastSale) {
      const daysSinceLastSale = Math.floor((Date.now() - new Date(lastSale.date).getTime()) / (1000 * 60 * 60 * 24))
      if (daysSinceLastSale >= 3) {
        insights.push({
          title: `No sales in ${daysSinceLastSale} days`,
          description: `It's been ${daysSinceLastSale} days since your last sale. Consider reaching out to regular customers or running a promotion.`,
          icon: ShoppingCart,
          severity: daysSinceLastSale >= 7 ? 'critical' : 'warning',
        })
      }
    }
  }

  // ─── 4. Customer Credit Risk ─────────────────────────────────
  if (kpis && kpis.totalReceivable > 0) {
    const receivablePct = kpis.rangeRevenue > 0 ? (kpis.totalReceivable / kpis.rangeRevenue) * 100 : 0
    if (receivablePct > 30) {
      insights.push({
        title: `High receivable ratio (${receivablePct.toFixed(0)}% of revenue)`,
        description: `Customers owe you ${formatINR(kpis.totalReceivable)} — that's ${receivablePct.toFixed(0)}% of your total revenue. Consider sending payment reminders via WhatsApp.`,
        icon: User,
        severity: receivablePct > 50 ? 'critical' : 'warning',
        action: {
          label: 'Send Reminders',
          onClick: () => {
            const { useAppStore } = require('@/store/app-store')
            useAppStore.getState().setPreviousView('dashboard')
            useAppStore.getState().setView('parties')
          },
        },
      })
    }
  }

  // ─── Positive insight ────────────────────────────────────────
  if (kpis && kpis.revenueGrowth > 20) {
    insights.push({
      title: `Revenue growing ${kpis.revenueGrowth.toFixed(0)}% vs last period`,
      description: `Great job! Your revenue is trending up significantly. Keep up the momentum.`,
      icon: TrendingUp,
      severity: 'positive',
    })
  }

  return insights
}

// ─── Dashboard data hook (reuses existing query) ─────────────────

function useDashboardData() {
  const { refreshKey } = useAppStore()
  const { useQuery } = require('@tanstack/react-query')
  const { offlineFetch } = require('@/lib/offline-fetch')

  return useQuery({
    queryKey: ['dashboard', refreshKey],
    queryFn: async () => {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const r = await offlineFetch(`/api/dashboard?from=${monthStart.toISOString()}&to=${now.toISOString()}`)
      return r.json()
    },
    staleTime: 60 * 1000,
  })
}
