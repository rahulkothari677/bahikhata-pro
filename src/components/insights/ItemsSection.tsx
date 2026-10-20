'use client'

/**
 * Insights → Items (Phase 5c-3, ledger model v4): how many items sold, where
 * sales come from (A / B / C — every item in exactly one group, items with no
 * sale counted too), stock as of today, and the top 10 by sales, profit or
 * quantity. Profit follows the hide-profit setting (the engine sends none).
 */
import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import { formatINR } from '@/lib/utils'
import { shares } from '@/lib/insights'
import { getById } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { useInsights, type TopItem } from '@/hooks/use-insights'
import { useOpenList } from '@/hooks/use-open-list'
import { SegmentedSwitch } from '@/components/common/SegmentedSwitch'
import { GroupBar, InsightCard, InsightsState, RankList, SECTION_GRID, StatRows, TotalsStrip } from '@/components/insights/InsightsKit'
import type { DateRange } from '@/components/common/DateRangePicker'

/** A brings the most sales: the strongest shade; items with no sale are grey. */
export const ABC_DOT: Record<string, string> = { a: 'bg-primary', b: 'bg-primary/60', c: 'bg-primary/30', none: 'bg-muted-foreground/30' }
type Sort = 'sales' | 'profit' | 'qty'

const qtyText = (q: number) => String(Math.round(q * 100) / 100)

export function ItemsSection({ range, period, hideProfit, t }: { range: DateRange; period: string; hideProfit: boolean; t: (k: string) => string }) {
  const { data, isLoading, isError, refetch } = useInsights('items', range)
  const [sort, setSort] = useState<Sort>('sales')
  const setView = useAppStore((s) => s.setView)
  const setPreviousView = useAppStore((s) => s.setPreviousView)
  const openList = useOpenList()
  if (isLoading && !data) return <InsightsState kind="loading" t={t} />
  if (isError || !data) return <InsightsState kind="error" onRetry={() => refetch()} t={t} />

  const { totals, stock } = data
  const sorts: Sort[] = hideProfit ? ['sales', 'qty'] : ['sales', 'profit', 'qty']
  const shown: Sort = sorts.includes(sort) ? sort : 'sales'
  const itemShare = shares(data.abc.map((g) => g.count))
  const n = (key: string, count: number) => t(count === 1 ? `${key}_1` : `${key}_n`).replace('{n}', String(count))
  const openItems = () => { haptic.click(); setPreviousView('dashboard'); setView('inventory') }
  // The full list behind "not sold in 90 days": Inventory Aging, the same rule (lib/stock-aging.ts).
  const aging = getById('inventory-aging')
  const line = (x: TopItem) => {
    const sold = t('ins.sold_n').replace('{n}', qtyText(x.qty))
    return x.profit !== null && x.sales > 0 ? `${sold} · ${t('ins.margin_pct').replace('{n}', String(Math.round((x.profit / x.sales) * 100)))}` : sold
  }
  const value = (x: TopItem) => (shown === 'qty' ? qtyText(x.qty) : formatINR(shown === 'profit' ? x.profit ?? 0 : x.sales))

  return (
    <div className={SECTION_GRID}>
      <TotalsStrip className="lg:col-span-2" cells={[
        { label: t('ins.items_sold'), value: String(totals.sold), sub: t('ins.of_n').replace('{n}', String(totals.items)) },
        { label: t('ins.stock_value'), value: formatINR(totals.stockValue), sub: t('ins.at_cost') },
        { label: t('ins.out_of_stock'), value: String(totals.outOfStock), tone: totals.outOfStock > 0 ? 'bad' : undefined },
      ]} />

      {totals.items === 0 ? <InsightsState kind="empty" t={(k) => (k === 'ins.empty' ? t('ins.no_items') : t(k))} /> : (<>
        <InsightCard title={t('ins.abc_title')} info={t('ins.abc_info')}>
          <GroupBar
            ariaLabel={t('ins.abc_title')}
            rows={data.abc.map((g, i) => ({
              id: g.id, dot: ABC_DOT[g.id] ?? ABC_DOT.none, amount: g.amount, share: g.share,
              label: `${t(`ins.abc.${g.id}`)} · ${g.count}`,
              sub: t('ins.pct_of_items').replace('{n}', String(itemShare[i])),
              // 5e-4b: the group opens Items with it selected, graded over this same period.
              onClick: g.count > 0 ? () => openList('items', `abc:${g.id}`, `${t(`ins.abc.${g.id}`)} · ${period}`, range) : undefined,
            }))}
          />
        </InsightCard>

        <InsightCard title={t('ins.stock')} note={t('ins.as_of_today')}>
          <StatRows rows={[
            // 5e-4b: Out / Running low / Not sold in 90 days are the Items list's own chips (the same rules);
            // "not sold this period" depends on the period, so it opens as a group with ✕.
            { id: 'out', dot: 'bg-bad', label: t('ins.out_of_stock'), value: String(stock.out), small: n('ins.items', stock.out), onClick: stock.out > 0 ? () => openList('items', 'chip:out', '') : undefined },
            { id: 'low', dot: 'bg-check', label: t('ins.running_low'), value: String(stock.low), small: n('ins.items', stock.low), onClick: stock.low > 0 ? () => openList('items', 'chip:low', '') : undefined },
            { id: 'period', dot: 'bg-muted-foreground/50', label: `${t('ins.not_sold_period')} · ${stock.notSoldPeriod.count}`, value: formatINR(stock.notSoldPeriod.stockValue), small: t('ins.in_stock'), onClick: stock.notSoldPeriod.count > 0 ? () => openList('items', 'unsold', `${t('ins.not_sold_period')} · ${period}`, range) : undefined },
            { id: 'd90', dot: 'bg-muted-foreground/30', label: `${t('ins.not_sold_90')} · ${stock.notSold90.count}`, value: formatINR(stock.notSold90.stockValue), small: t('ins.in_stock'), onClick: stock.notSold90.count > 0 ? () => openList('items', 'chip:dead', '') : undefined },
          ]} />
          {aging && (
            <button type="button" onClick={() => handleNavAction(aging, { previousView: 'dashboard' })} className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted">
              {t('ins.see_aging')}
            </button>
          )}
        </InsightCard>

        <InsightCard title={t('ins.top_items')} className="lg:col-span-2">
          <SegmentedSwitch
            ariaLabel={t('ins.top_items')}
            options={sorts.map((s) => ({ value: s, label: t(`ins.sort.${s}`) }))}
            value={shown}
            onChange={setSort}
          />
          {data.top[shown].length === 0
            ? <p className="py-6 text-center text-sm text-muted-foreground">{t('ins.no_sales_items')}</p>
            : <RankList rows={data.top[shown].map((x) => ({ key: x.id, name: x.name, line: line(x), value: value(x) }))} />}
          <button type="button" onClick={openItems} className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted">
            {t('ins.see_items').replace('{n}', String(totals.items))}
          </button>
        </InsightCard>
      </>)}
    </div>
  )
}
