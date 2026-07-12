'use client'

/**
 * BusinessHealthScore — a 0-100 score showing overall business health.
 *
 * Computed from:
 * - Revenue trend (is revenue growing?) — 25%
 * - Profit margin (healthy margins?) — 25%
 * - Cash flow (more receivable than payable?) — 20%
 * - Stock health (low stock + dead stock) — 15%
 * - Transaction frequency (active business?) — 15%
 *
 * Color-coded:
 *   80-100: Green (excellent)
 *   60-79:  Blue (good)
 *   40-59:  Amber (needs attention)
 *   0-39:   Red (critical)
 */

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useCountUp } from '@/hooks/use-count-up'

export function BusinessHealthScore({ kpis }: { kpis: any }) {
  // Calculate score components (each 0-100)
  const revenueScore = Math.min(100, Math.max(0,
    kpis.revenueGrowth >= 0
      ? 50 + Math.min(50, kpis.revenueGrowth * 2)
      : Math.max(0, 50 + kpis.revenueGrowth * 2)
  ))

  const marginPct = kpis.todayRevenue > 0
    ? (kpis.todayProfit / kpis.todayRevenue) * 100
    : 0
  const profitScore = Math.min(100, Math.max(0, marginPct * 4))

  const cashFlowScore = Math.min(100, Math.max(0,
    kpis.totalPayable > 0
      ? Math.min(100, (kpis.totalReceivable / kpis.totalPayable) * 50)
      : kpis.totalReceivable > 0 ? 70 : 50
  ))

  const stockScore = Math.min(100, Math.max(0,
    100 - (kpis.lowStockCount || 0) * 5
  ))

  const activityScore = Math.min(100, Math.max(0,
    kpis.rangeTxnCount > 0 ? Math.min(100, kpis.rangeTxnCount * 2) : 0
  ))

  // Weighted total
  const score = Math.round(
    revenueScore * 0.25 +
    profitScore * 0.25 +
    cashFlowScore * 0.20 +
    stockScore * 0.15 +
    activityScore * 0.15
  )

  const getColor = (s: number) => {
    if (s >= 80) return {
      text: 'text-emerald-600 dark:text-emerald-400',
      stroke: '#10b981', // emerald-500
      bg: 'from-emerald-500 to-teal-600',
      label: 'Excellent',
      icon: TrendingUp,
    }
    if (s >= 60) return {
      text: 'text-blue-600',
      stroke: '#3b82f6', // blue-500
      bg: 'from-blue-500 to-indigo-600',
      label: 'Good',
      icon: Activity,
    }
    if (s >= 40) return {
      text: 'text-amber-600 dark:text-amber-400',
      stroke: '#f59e0b', // amber-500
      bg: 'from-amber-500 to-orange-600',
      label: 'Needs Attention',
      icon: Minus,
    }
    return {
      text: 'text-rose-600',
      stroke: '#f43f5e', // rose-500
      bg: 'from-rose-500 to-red-600',
      label: 'Critical',
      icon: TrendingDown,
    }
  }

  const { text, stroke, bg, label, icon: Icon } = getColor(score)

  // Count-up animation for the score number
  const animatedScore = useCountUp(score, 1000)
  const displayScore = Math.round(animatedScore)

  // Circular gauge parameters
  const radius = 45
  const circumference = 2 * Math.PI * radius
  // Animate the gauge fill with the count-up value
  const offset = circumference - (displayScore / 100) * circumference

  const factors = [
    { label: 'Revenue Growth', score: revenueScore, weight: '25%' },
    { label: 'Profit Margin', score: profitScore, weight: '25%' },
    { label: 'Cash Flow', score: cashFlowScore, weight: '20%' },
    { label: 'Stock Health', score: stockScore, weight: '15%' },
    { label: 'Activity', score: activityScore, weight: '15%' },
  ]

  return (
    <div className="rounded-2xl shadow-card border border-border/60 overflow-hidden">
      {/* Gradient header */}
      <div className={cn('bg-gradient-to-r p-3 text-white relative overflow-hidden', bg)}>
        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10 pointer-events-none" />
        <div className="relative flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-bold font-heading tracking-tight">Business Health Score</p>
            <p className="text-[10px] text-white/80">Overall business wellness indicator</p>
          </div>
        </div>
      </div>

      <CardContent className="p-3">
        <div className="flex items-center gap-4">
          {/* Circular gauge — animated */}
          <div className="relative w-24 h-24 flex-shrink-0">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
              <circle
                cx="50" cy="50" r={radius} fill="none" stroke={stroke} strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.1s linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn('text-2xl font-bold tabular-nums', text)}>{displayScore}</span>
              <span className="text-[9px] text-muted-foreground">/ 100</span>
            </div>
          </div>

          {/* Score label + factors */}
          <div className="flex-1 min-w-0">
            <div className={cn('flex items-center gap-1.5 mb-2', text)}>
              <Icon className="w-4 h-4" />
              <span className="text-sm font-bold">{label}</span>
            </div>
            <div className="space-y-1">
              {factors.map(f => (
                <div key={f.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">{f.label}</span>
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', f.score >= 60 ? 'bg-emerald-500' : f.score >= 40 ? 'bg-amber-500' : 'bg-rose-500')}
                      style={{ width: `${f.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </div>
  )
}
