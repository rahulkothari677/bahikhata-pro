'use client'

/**
 * 🔒 V26 R17 (Phase 5): Lazy-loaded dashboard charts — every recharts use on
 * Home lives here, loaded with next/dynamic (ssr: false), so the charting
 * library is never in the first-paint bundle.
 *
 * Phase 5b-5 (ledger model v4 §7): two cards.
 * - Trends: one card, one switch — Sales · Profit · vs Purchases · Payments.
 *   Slide a finger along the chart to read a day (the pinned tooltip). It was
 *   four separate cards (sparkline, donut, trend chart, payment pie).
 * - Top lists: Top items · Customers · Buy again, ranked rows (rank, name,
 *   one line, value on the right), the Business Analytics style extended.
 *   Top items follow the period chip; Customers are the last 90 days by
 *   profit and Buy again comes from purchase patterns (both /api/analytics,
 *   the same query as the Business Analytics card, which stays until 5c).
 */
import { useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ArrowRight } from 'lucide-react'
import { SegmentedSwitch } from '@/components/common/SegmentedSwitch'
import { chartColors } from '@/lib/chart-theme'
import { formatINR, formatINRCompact, cn } from '@/lib/utils'
import { salesVsPurchases } from '@/lib/sales-vs-purchases'
import { useAnalytics } from '@/hooks/use-analytics'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.62 0.16 250)', 'oklch(0.62 0.14 200)', 'oklch(0.62 0.22 15)']
const SALES_COLOUR = 'oklch(0.55 0.19 42)'
const PROFIT_COLOUR = 'oklch(0.55 0.16 155)'

export interface DashboardChartsProps {
  salesTrend: { label: string; revenue: number; profit: number }[]
  kpis: any
  hideProfit: boolean
  topProducts: { name: string; quantity: number; revenue: number }[]
  paymentModeSplit: { name: string; value: number }[]
  periodLabel: string
  t: (key: string) => string
  onSeeAnalytics: () => void
  /** Customise Home (5b-6): either card can be switched off. */
  showTrends?: boolean
  showTop?: boolean
}

type TrendView = 'sales' | 'profit' | 'svp' | 'modes'
type TopView = 'items' | 'customers' | 'buy'

/** Which Trends views a shop sees (profit hidden for staff who may not see it). Exported for the guard. */
export function trendViews(hideProfit: boolean): TrendView[] {
  return hideProfit ? ['sales', 'svp', 'modes'] : ['sales', 'profit', 'svp', 'modes']
}

export function DashboardCharts({ salesTrend, kpis, hideProfit, topProducts, paymentModeSplit, periodLabel, t, onSeeAnalytics, showTrends = true, showTop = true }: DashboardChartsProps) {
  return (
    <>
      {showTrends && <TrendsCard salesTrend={salesTrend} kpis={kpis} hideProfit={hideProfit} paymentModeSplit={paymentModeSplit} periodLabel={periodLabel} t={t} />}
      {showTop && <TopListsCard topProducts={topProducts} hideProfit={hideProfit} periodLabel={periodLabel} t={t} onSeeAnalytics={onSeeAnalytics} />}
    </>
  )
}

function TrendsCard({ salesTrend, kpis, hideProfit, paymentModeSplit, periodLabel, t }: Omit<DashboardChartsProps, 'topProducts' | 'onSeeAnalytics'>) {
  const views = trendViews(hideProfit)
  const [view, setView] = useState<TrendView>('sales')
  const shown = views.includes(view) ? view : 'sales'
  // #237: one set of figures for Sales vs purchases (line, difference, colour).
  const svp = salesVsPurchases(kpis)
  const label: Record<TrendView, string> = { sales: t('trend.sales'), profit: t('trend.profit'), svp: t('trend.svp'), modes: t('trend.modes') }
  const series = shown === 'profit' ? 'profit' : 'revenue'
  const colour = shown === 'profit' ? PROFIT_COLOUR : SALES_COLOUR

  return (
    <section className="rounded-2xl bg-card border border-border/60 shadow-card p-3 lg:p-4 space-y-3" aria-labelledby="trends-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="trends-title" className="text-base font-semibold">{t('trend.title')}</h3>
        <span className="text-xs text-muted-foreground">{periodLabel}</span>
      </div>
      <SegmentedSwitch options={views.map((v) => ({ value: v, label: label[v] }))} value={shown} onChange={setView} ariaLabel={t('trend.title')} />

      {(shown === 'sales' || shown === 'profit') && (
        <div>
          <p className="text-2xl font-bold tabular-nums">{formatINR(shown === 'profit' ? kpis.rangeProfit : kpis.rangeRevenue)}</p>
          {salesTrend.length === 0 ? (
            <p className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">{t('trend.none')}</p>
          ) : (
            <div aria-label={t('trend.slide')} role="img">
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={salesTrend} margin={{ top: 40, right: 4, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colour} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={colour} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: chartColors.tick }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 12, fill: chartColors.tick }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} width={44} />
                  {/* Slide to read: the tooltip is pinned to the top of the chart and follows the finger. */}
                  <Tooltip
                    position={{ y: 0 }}
                    cursor={{ stroke: colour, strokeWidth: 1 }}
                    contentStyle={chartColors.tooltipStyle} itemStyle={chartColors.tooltipItemStyle} labelStyle={chartColors.tooltipLabelStyle}
                    formatter={(v: number) => [formatINR(v), label[shown]]}
                  />
                  <Area type="monotone" dataKey={series} stroke={colour} strokeWidth={2} fill="url(#trendFill)" name={label[shown]} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {shown === 'svp' && (
        <div className="flex items-center gap-4">
          {svp.empty ? (
            <p className="w-24 h-24 flex items-center justify-center text-center text-xs text-muted-foreground">{t('trend.none')}</p>
          ) : (
            <ResponsiveContainer width={96} height={96}>
              <PieChart>
                <Pie
                  data={[{ name: 'Sales', value: svp.sales, fill: PROFIT_COLOUR }, { name: 'Purchases', value: svp.purchases, fill: SALES_COLOUR }]}
                  dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={46} paddingAngle={2}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex-1 min-w-0 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PROFIT_COLOUR }} />
              <span className="text-muted-foreground flex-1">{t('trend.sales')}</span>
              <span className="font-bold tabular-nums">{formatINR(svp.sales)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SALES_COLOUR }} />
              <span className="text-muted-foreground flex-1">{t('proof.t_purchases')}</span>
              <span className="font-bold tabular-nums">{formatINR(svp.purchases)}</span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
              <span className="text-muted-foreground flex-1" title="Not profit: stock bought and not yet sold is still yours">Sales − purchases</span>
              <span className={cn('font-bold tabular-nums', svp.differenceIsPositive ? 'text-good' : 'text-bad')}>{formatINR(svp.difference)}</span>
            </div>
          </div>
        </div>
      )}

      {shown === 'modes' && (
        paymentModeSplit.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('trend.none')}</p>
        ) : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={112} height={112}>
              <PieChart>
                <Pie data={paymentModeSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={34} outerRadius={54} paddingAngle={2}>
                  {paymentModeSplit.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--background)" strokeWidth={2} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 min-w-0 space-y-1.5 text-sm">
              {paymentModeSplit.map((p, i) => (
                <li key={p.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="flex-1 text-muted-foreground">{p.name}</span>
                  <span className="font-semibold tabular-nums">{formatINR(p.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </section>
  )
}

/** One ranked row: rank, name, one line, value on the right (ledger model consistency kit). */
interface RankedRow { name: string; line: string; value: string; strong?: boolean }

/** The rows each Top list shows. Exported for the guard. */
export function topListRows(
  view: TopView,
  data: { topProducts: DashboardChartsProps['topProducts']; topCustomers: { name: string; profit: number; totalSales: number }[]; reorder: { name: string; avgGapDays: number; daysSinceLastPurchase: number; shouldReorder: boolean }[] },
  t: (key: string) => string,
): RankedRow[] {
  if (view === 'items') {
    return data.topProducts.map((p) => ({ name: p.name, line: t('top.sold').replace('{n}', String(Math.round(p.quantity * 100) / 100)), value: formatINR(p.revenue) }))
  }
  if (view === 'customers') {
    return data.topCustomers.map((c) => ({ name: c.name, line: t('top.sales_line').replace('{amount}', formatINR(c.totalSales)), value: formatINR(c.profit) }))
  }
  // Buy again: what is due first (bought every N days, and N or more days have passed).
  return [...data.reorder]
    .sort((a, b) => Number(b.shouldReorder) - Number(a.shouldReorder) || (b.daysSinceLastPurchase - b.avgGapDays) - (a.daysSinceLastPurchase - a.avgGapDays))
    .map((r) => ({
      name: r.name,
      line: t('top.every').replace('{n}', String(Math.round(r.avgGapDays))).replace('{m}', String(r.daysSinceLastPurchase)),
      value: r.shouldReorder ? t('top.due') : t('top.in_days').replace('{n}', String(Math.max(0, Math.round(r.avgGapDays - r.daysSinceLastPurchase)))),
      strong: r.shouldReorder,
    }))
}

function TopListsCard({ topProducts, hideProfit, periodLabel, t, onSeeAnalytics }: Pick<DashboardChartsProps, 'topProducts' | 'hideProfit' | 'periodLabel' | 't' | 'onSeeAnalytics'>) {
  const { data } = useAnalytics()
  const views: TopView[] = hideProfit ? ['items', 'buy'] : ['items', 'customers', 'buy']
  const [view, setView] = useState<TopView>('items')
  const shown = views.includes(view) ? view : 'items'
  const rows = topListRows(shown, { topProducts, topCustomers: data?.topCustomers ?? [], reorder: data?.reorderSuggestions ?? [] }, t)
  const label: Record<TopView, string> = { items: t('top.items'), customers: t('top.customers'), buy: t('top.buy_again') }
  const note: Record<TopView, string> = { items: periodLabel, customers: t('top.customers_note'), buy: t('top.buy_note') }
  const empty: Record<TopView, string> = { items: t('top.none_items'), customers: t('top.none_customers'), buy: t('top.none_buy') }

  return (
    <section className="rounded-2xl bg-card border border-border/60 shadow-card p-3 lg:p-4 space-y-3" aria-labelledby="top-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="top-title" className="text-base font-semibold">{t('top.title')}</h3>
        <span className="text-xs text-muted-foreground">{note[shown]}</span>
      </div>
      <SegmentedSwitch options={views.map((v) => ({ value: v, label: label[v] }))} value={shown} onChange={setView} ariaLabel={t('top.title')} />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{empty[shown]}</p>
      ) : (
        <ol className="divide-y divide-border/60">
          {rows.slice(0, 5).map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center gap-3 py-2.5">
              <span className="w-7 h-7 rounded-full bg-muted text-xs font-bold flex items-center justify-center flex-shrink-0 tabular-nums">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold break-words">{r.name}</span>
                <span className="block text-xs text-muted-foreground">{r.line}</span>
              </span>
              <span className={cn('text-sm font-bold tabular-nums whitespace-nowrap', r.strong && 'text-check')}>{r.value}</span>
            </li>
          ))}
        </ol>
      )}
      <button type="button" onClick={onSeeAnalytics} className="w-full min-h-12 rounded-xl text-sm font-semibold text-primary hover:bg-primary/5 inline-flex items-center justify-center gap-1">
        {t('top.more')} <ArrowRight className="w-4 h-4" />
      </button>
    </section>
  )
}
