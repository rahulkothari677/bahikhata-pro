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

export function BusinessHealthScore({ kpis }: { kpis: any }) {
  // Calculate score components (each 0-100)
  const revenueScore = Math.min(100, Math.max(0,
    kpis.revenueGrowth >= 0
      ? 50 + Math.min(50, kpis.revenueGrowth * 2) // growth adds points
      : Math.max(0, 50 + kpis.revenueGrowth * 2)  // decline subtracts
  ))

  const marginPct = kpis.todayRevenue > 0
    ? (kpis.todayProfit / kpis.todayRevenue) * 100
    : 0
  const profitScore = Math.min(100, Math.max(0, marginPct * 4)) // 25% margin = 100

  const cashFlowScore = Math.min(100, Math.max(0,
    kpis.totalPayable > 0
      ? Math.min(100, (kpis.totalReceivable / kpis.totalPayable) * 50)
      : kpis.totalReceivable > 0 ? 70 : 50
  ))

  const stockScore = Math.min(100, Math.max(0,
    100 - (kpis.lowStockCount || 0) * 5 // each low stock item reduces score
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
    if (s >= 80) return { text: 'text-emerald-600', bg: 'bg-emerald-500', label: 'Excellent', icon: TrendingUp }
    if (s >= 60) return { text: 'text-blue-600', bg: 'bg-blue-500', label: 'Good', icon: Activity }
    if (s >= 40) return { text: 'text-amber-600', bg: 'bg-amber-500', label: 'Needs Attention', icon: Minus }
    return { text: 'text-rose-600', bg: 'bg-rose-500', label: 'Critical', icon: TrendingDown }
  }

  const { text, bg, label, icon: Icon } = getColor(score)
  const circumference = 2 * Math.PI * 45
  const offset = circumference - (score / 100) * circumference

  const factors = [
    { label: 'Revenue Growth', score: revenueScore, weight: '25%' },
    { label: 'Profit Margin', score: profitScore, weight: '25%' },
    { label: 'Cash Flow', score: cashFlowScore, weight: '20%' },
    { label: 'Stock Health', score: stockScore, weight: '15%' },
    { label: 'Activity', score: activityScore, weight: '15%' },
  ]

  return (
    <Card className="shadow-card border-border/60 overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Business Health Score</p>
              <p className="text-[10px] text-muted-foreground">Overall business wellness indicator</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Circular gauge */}
          <div className="relative w-24 h-24 flex-shrink-0">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
              <circle
                cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8"
                className={text}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn('text-2xl font-bold', text)}>{score}</span>
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
    </Card>
  )
}
