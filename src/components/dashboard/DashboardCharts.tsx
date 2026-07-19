'use client'

/**
 * 🔒 V26 R17 (Phase 5): Lazy-loaded dashboard charts.
 *
 * Phase 5 audit (R17 🔵): recharts was statically imported by Dashboard.tsx
 * → the charting library was in the first-paint bundle of every load,
 * including login. Open since V21; DayEndSummary/AnalyticsInsights were split,
 * the main dashboard charts were not.
 *
 * This file contains ALL recharts usage for the Dashboard. It's loaded via
 * `next/dynamic` with `ssr: false` in Dashboard.tsx, so recharts only loads
 * when the Dashboard actually renders (not on the login page).
 *
 * The component receives all chart data as props from the parent Dashboard.
 */

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Pie, PieChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, TrendingUp, TrendingDown, IndianRupee } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { chartColors } from '@/lib/chart-theme'
import { formatINR, formatINRCompact, cn } from '@/lib/utils'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.62 0.16 250)', 'oklch(0.62 0.14 200)', 'oklch(0.62 0.22 15)']

export interface DashboardChartsProps {
  salesTrend: any[]
  kpis: any
  hideProfit: boolean
  topProducts: any[]
  paymentModeSplit: any[]
  t: (key: string) => string
  setView: (view: any) => void
}

export function DashboardCharts({
  salesTrend,
  kpis,
  hideProfit,
  topProducts,
  paymentModeSplit,
  t,
  setView,
}: DashboardChartsProps) {
  return (
    <>
      {/* Mini-charts row — quick visual insights at a glance.
          Sparkline: last 7 days sales trend (no axes, just the line)
          Donut: sales vs purchases split for the selected range */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
        {/* Sparkline card — 7-day sales trend */}
        <Card className="shadow-card border-border/60 overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Sales Trend</p>
                <p className="text-lg font-bold tabular-nums mt-0.5">{formatINR(kpis.rangeRevenue)}</p>
              </div>
              {kpis.revenueGrowth !== 0 && (
                <div className={cn(
                  'flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5',
                  kpis.revenueGrowth > 0 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40' : 'text-rose-600 bg-rose-100 dark:bg-rose-950/40'
                )}>
                  {kpis.revenueGrowth > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(kpis.revenueGrowth).toFixed(0)}%
                </div>
              )}
            </div>
            {/* Sparkline — no axes, just the line with gradient fill */}
            <ResponsiveContainer width="100%" height={56}>
              <AreaChart data={salesTrend.slice(-14)} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <defs>
                  <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.62 0.18 42)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.62 0.18 42)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="oklch(0.62 0.18 42)"
                  strokeWidth={2}
                  fill="url(#sparklineGrad)"
                  isAnimationActive={true}
                  animationDuration={600}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Donut card — sales vs purchases split */}
        <Card className="shadow-card border-border/60 overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              {/* Donut chart */}
              <ResponsiveContainer width={80} height={80}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Sales', value: kpis.rangeRevenue || 0, fill: 'oklch(0.62 0.15 155)' },
                      { name: 'Purchases', value: kpis.rangePurchases || 0, fill: 'oklch(0.62 0.18 42)' },
                    ]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={26}
                    outerRadius={38}
                    paddingAngle={2}
                    isAnimationActive={true}
                    animationDuration={600}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Legend + values */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'oklch(0.62 0.15 155)' }} />
                  <span className="text-xs text-muted-foreground flex-1">Sales</span>
                  <span className="text-sm font-bold tabular-nums">{formatINRCompact(kpis.rangeRevenue || 0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'oklch(0.62 0.18 42)' }} />
                  <span className="text-xs text-muted-foreground flex-1">Purchases</span>
                  <span className="text-sm font-bold tabular-nums">{formatINRCompact(kpis.totalPayable || 0)}</span>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                  <span className="text-xs text-muted-foreground flex-1">Net</span>
                  <span className={cn(
                    'text-sm font-bold tabular-nums',
                    (kpis.rangeRevenue - (kpis.totalPayable || 0)) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                  )}>
                    {formatINRCompact(kpis.rangeRevenue - (kpis.rangePurchases || 0))}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales trend chart - full width */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">{t('dash.sales_trend')}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">For selected date range</p>
            </div>
            <Badge variant="secondary" className="gap-1">
              <TrendingUp className="w-3 h-3" />
              {salesTrend.length} points
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={salesTrend} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.55 0.19 42)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="oklch(0.55 0.19 42)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.55 0.16 155)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="oklch(0.55 0.16 155)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: chartColors.tick }} axisLine={false} tickLine={false} minTickGap={20} />
              <YAxis tick={{ fontSize: 10, fill: chartColors.tick }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} width={45} />
              <Tooltip
                cursor={{ stroke: chartColors.grid, strokeWidth: 1, strokeDasharray: '3 3' }}
                contentStyle={chartColors.tooltipStyle} itemStyle={chartColors.tooltipItemStyle} labelStyle={chartColors.tooltipLabelStyle}
                formatter={(v: number) => formatINR(v)}
              />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.55 0.19 42)" strokeWidth={2} fill="url(#colorRev)" name="Revenue" />
              {!hideProfit && (
                <Area type="monotone" dataKey="profit" stroke="oklch(0.55 0.16 155)" strokeWidth={2} fill="url(#colorProfit)" name={t('common.profit')} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 3-column row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top products */}
        <Card className="shadow-card border-border/60 lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">{t('dash.top_products')}</CardTitle>
                <p className="text-xs text-muted-foreground">For selected date range</p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setView('inventory')}>
                {t('dash.view_all')} <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No {t('dash.sales_word')} in selected range</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topProducts} layout="vertical" margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: chartColors.tick }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: chartColors.tick }} axisLine={false} tickLine={false} width={90}
                    tickFormatter={(v) => v.length > 12 ? v.slice(0, 12) + '…' : v}
                  />
                  <Tooltip
                    cursor={{ fill: 'oklch(0.55 0.19 42 / 0.05)' }}
                    contentStyle={chartColors.tooltipStyle} itemStyle={chartColors.tooltipItemStyle} labelStyle={chartColors.tooltipLabelStyle}
                    formatter={(v: number, name: string) => name === 'revenue' ? [formatINR(v), 'Revenue'] : [formatINR(v), 'Profit']}
                  />
                  <Bar dataKey="revenue" fill="oklch(0.55 0.19 42)" radius={[0, 6, 6, 0]} name="revenue"
                    activeBar={{ fill: 'oklch(0.65 0.22 42)' }}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Payment mode pie */}
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('dash.payment_modes')}</CardTitle>
            <p className="text-xs text-muted-foreground">For selected date range</p>
          </CardHeader>
          <CardContent>
            {paymentModeSplit.length === 0 ? (
              <EmptyState
                icon={IndianRupee}
                title="No payment data"
                description="Sales will appear here once you record them."
                color="amber"
                compact
              />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={paymentModeSplit}
                      dataKey="value"
                      nameKey="name"
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={70}
                      paddingAngle={2}
                      isAnimationActive
                      animationDuration={300}
                    >
                      {paymentModeSplit.map((_, i) => (
                        <Cell
                          key={i}
                          fill={COLORS[i % COLORS.length]}
                          stroke="var(--background)"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      cursor={{ stroke: 'transparent', strokeWidth: 0 }}
                      formatter={(v: number) => formatINR(v)}
                      contentStyle={chartColors.tooltipStyle} itemStyle={chartColors.tooltipItemStyle} labelStyle={chartColors.tooltipLabelStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {paymentModeSplit.map((p, i) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <div className="text-xs">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground ml-1">{formatINRCompact(p.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
