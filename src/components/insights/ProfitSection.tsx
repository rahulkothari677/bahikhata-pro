'use client'

/**
 * Insights → Profit (Phase 5c-4, ledger model v4): profit, margin and what is
 * left after expenses; profit by category (the rows add up to the profit Home
 * shows — any gap is its own row from the engine); the lowest margins; and
 * items whose cost went up on the latest purchase bill. Never shown to staff
 * who may not see profit (the engine refuses, and the chip is not offered).
 */
import { formatINR } from '@/lib/utils'
import { useInsights } from '@/hooks/use-insights'
import { useOpenList } from '@/hooks/use-open-list'
import { changeVsBefore } from '@/lib/insights-view'
import { categoryLabel } from '@/components/insights/SalesSection'
import { InsightCard, InsightsState, RankList, SECTION_GRID, StatRows, TotalsStrip } from '@/components/insights/InsightsKit'
import type { DateRange } from '@/components/common/DateRangePicker'

const pct = (n: number) => `${Math.round(n * 10) / 10}%`

export function ProfitSection({ range, t }: { range: DateRange; t: (k: string) => string }) {
  const { data, isLoading, isError, refetch } = useInsights('profit', range)
  const openList = useOpenList()
  if (isLoading && !data) return <InsightsState kind="loading" t={t} />
  if (isError || !data) return <InsightsState kind="error" onRetry={() => refetch()} t={t} />

  const { totals } = data
  // #254: with sales that have no cost price, the margin is over the rest — the caption says so.
  const hasNoCost = data.byCategory.some((c: { id: string; sales: number }) => c.id === '__typed' && c.sales !== 0)
  const change = changeVsBefore(totals.profit, totals.previous)
  const sub = change
    ? t(change.dir === 'same' ? 'ins.same_as_before' : change.dir === 'up' ? 'ins.up_on_before' : 'ins.down_on_before').replace('{n}', String(change.pct))
    : undefined
  const strip = (
    <TotalsStrip className="lg:col-span-2" cells={[
      { label: t('ins.profit'), value: formatINR(totals.profit), sub, tone: totals.profit < 0 ? 'bad' : 'good' },
      { label: t('ins.margin'), value: totals.margin === null ? '—' : pct(totals.margin), sub: t(hasNoCost ? 'ins.of_costed_sales' : 'ins.of_sales_before_gst') },
      { label: t('ins.after_expenses'), value: formatINR(totals.afterExpenses), sub: t('ins.expenses_amt').replace('{amount}', formatINR(totals.expenses)), tone: totals.afterExpenses < 0 ? 'bad' : undefined },
    ]} />
  )
  if (totals.netSales === 0 && data.byCategory.length === 0) return <div className={SECTION_GRID}>{strip}<InsightsState kind="empty" t={t} /></div>

  return (
    <div className={SECTION_GRID}>
      {strip}

      <InsightCard title={t('ins.profit_by_cat')} info={t('ins.profit_info')}>
        <StatRows rows={data.byCategory.map((c) => ({
          id: c.id || 'none',
          label: categoryLabel(c.id, t),
          sub: t('ins.on_sales').replace('{amount}', formatINR(c.sales)),
          value: formatINR(c.profit),
          small: c.margin !== null ? t('ins.margin_pct').replace('{n}', String(Math.round(c.margin))) : c.id === '__typed' ? t('ins.no_cost') : undefined,
          dot: c.id === '__typed' || c.id === '__unmatched' ? 'bg-muted-foreground/40' : c.profit < 0 ? 'bg-bad' : 'bg-good',
        }))} />
      </InsightCard>

      {data.lowest.length > 0 && (
        <InsightCard title={t('ins.lowest_margins')} note={t('ins.lowest_note')}>
          <RankList rows={data.lowest.map((x) => ({
            key: x.id, name: x.name, line: t('ins.on_sales').replace('{amount}', formatINR(x.sales)),
            value: pct(x.margin), tone: x.margin < 0 ? 'bad' as const : undefined,
          }))} />
        </InsightCard>
      )}

      {data.costUp.length > 0 && (
        <InsightCard title={t('ins.cost_up')} note={t('ins.cost_up_note')} className="lg:col-span-2">
          <RankList rows={data.costUp.map((x) => ({
            key: x.id, name: x.name,
            line: t('ins.cost_line')
              .replace('{from}', formatINR(x.previous)).replace('{to}', formatINR(x.latest))
              .replace('{now}', formatINR(x.earnNow)).replace('{before}', formatINR(x.earnBefore)),
            value: x.previous > 0 ? `+${pct(((x.latest - x.previous) / x.previous) * 100)}` : formatINR(x.latest),
            tone: 'bad' as const,
            // #264: "Price" — that item's form, sale price selected, MRP beside it.
            action: t('ins.price'),
            onClick: () => openList('items', `item:${x.id}`, x.name),
          }))} />
        </InsightCard>
      )}
    </div>
  )
}
