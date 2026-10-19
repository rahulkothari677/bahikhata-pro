'use client'

/**
 * Insights → Customers (Phase 5c-3, ledger model v4): who bought, every
 * customer in exactly one group (new, regular, occasional, gone quiet,
 * inactive), named against walk-in sales, and the top 10 by sales, profit or
 * bills. The reserved "Walk-in Customer" khata (counter returns) is walk-in,
 * not a named customer — the engine leaves it out.
 */
import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import { formatINR } from '@/lib/utils'
import { useInsights, type TopCustomer } from '@/hooks/use-insights'
import { SegmentedSwitch } from '@/components/common/SegmentedSwitch'
import { GroupBar, InsightCard, InsightsState, RankList, SECTION_GRID, TotalsStrip } from '@/components/insights/InsightsKit'
import type { DateRange } from '@/components/common/DateRangePicker'

/** Buying now in the money-in shades; gone quiet needs a look; inactive is grey. */
export const SEG_DOT: Record<string, string> = {
  new: 'bg-good/50', regular: 'bg-good', occasional: 'bg-good/25', quiet: 'bg-check', inactive: 'bg-muted-foreground/30',
}
const SPLIT_DOT: Record<string, string> = { named: 'bg-good', walkin: 'bg-muted-foreground/40' }
type Sort = 'sales' | 'profit' | 'bills'

export function CustomersSection({ range, hideProfit, t }: { range: DateRange; hideProfit: boolean; t: (k: string) => string }) {
  const { data, isLoading, isError, refetch } = useInsights('customers', range)
  const [sort, setSort] = useState<Sort>('sales')
  const setSelectedPartyId = useAppStore((s) => s.setSelectedPartyId)
  const setPreviousView = useAppStore((s) => s.setPreviousView)
  const setView = useAppStore((s) => s.setView)
  const setKhataSide = useAppStore((s) => s.setKhataSide)
  if (isLoading && !data) return <InsightsState kind="loading" t={t} />
  if (isError || !data) return <InsightsState kind="error" onRetry={() => refetch()} t={t} />

  const { totals } = data
  const sorts: Sort[] = hideProfit ? ['sales', 'bills'] : ['sales', 'profit', 'bills']
  const shown: Sort = sorts.includes(sort) ? sort : 'sales'
  const bills = (n: number) => t(n === 1 ? 'ins.bill_1' : 'ins.bills_n').replace('{n}', String(n))
  const openParty = (id: string) => { haptic.click(); setSelectedPartyId(id); setPreviousView('dashboard'); setView('party-profile') }
  const openKhata = () => { haptic.click(); setKhataSide('customer'); setPreviousView('dashboard'); setView('parties') }
  const value = (c: TopCustomer) => (shown === 'bills' ? String(c.bills) : formatINR(shown === 'profit' ? c.profit ?? 0 : c.sales))
  // Gone quiet shows what they bought in the period before; inactive bought in neither.
  const groupValue = (id: string, amount: number) => (id === 'inactive' ? '—' : formatINR(amount))
  const groupSmall = (id: string, share: number) => (id === 'quiet' ? t('ins.period_before') : id === 'inactive' ? '' : `${share}%`)

  return (
    <div className={SECTION_GRID}>
      <TotalsStrip className="lg:col-span-2" cells={[
        { label: t('ins.bought'), value: String(totals.bought), sub: t('ins.of_customers').replace('{n}', String(totals.customers)) },
        { label: t('ins.new'), value: String(totals.newCount), sub: t('ins.this_period') },
        { label: t('ins.walkin_share'), value: `${totals.walkInShare}%`, sub: t('ins.of_sales') },
      ]} />

      {totals.customers === 0 ? <InsightsState kind="empty" t={(k) => (k === 'ins.empty' ? t('ins.no_customers') : t(k))} /> : (
        <InsightCard title={t('ins.your_customers').replace('{n}', String(totals.customers))} info={t('ins.groups_info')}>
          <GroupBar
            ariaLabel={t('ins.your_customers').replace('{n}', String(totals.customers))}
            rows={data.groups.map((g) => ({
              id: g.id, dot: SEG_DOT[g.id] ?? SEG_DOT.inactive, amount: g.amount, share: g.share, weight: g.count,
              label: `${t(`ins.seg.${g.id}`)} · ${g.count}`, sub: t(`ins.seg_d.${g.id}`),
              value: groupValue(g.id, g.amount), small: groupSmall(g.id, g.share),
            }))}
          />
        </InsightCard>
      )}

      {data.namedVsWalkIn.length > 0 && (
        <InsightCard title={t('ins.named_walkin')}>
          <GroupBar
            ariaLabel={t('ins.named_walkin')}
            rows={data.namedVsWalkIn.map((g) => ({ id: g.id, dot: SPLIT_DOT[g.id] ?? SPLIT_DOT.walkin, amount: g.amount, share: g.share, label: t(`ins.split.${g.id}`) }))}
          />
        </InsightCard>
      )}

      <InsightCard title={t('ins.top_customers')} className="lg:col-span-2">
        <SegmentedSwitch
          ariaLabel={t('ins.top_customers')}
          options={sorts.map((s) => ({ value: s, label: t(`ins.sort.${s}`) }))}
          value={shown}
          onChange={setSort}
        />
        {data.top[shown].length === 0
          ? <p className="py-6 text-center text-sm text-muted-foreground">{t('ins.no_sales_customers')}</p>
          : <RankList rows={data.top[shown].map((c) => ({ key: c.id, name: c.name, line: `${bills(c.bills)} · ${formatINR(c.sales)}`, value: value(c), onClick: () => openParty(c.id) }))} />}
        <button type="button" onClick={openKhata} className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted">
          {t('ins.see_khata').replace('{n}', String(totals.customers))}
        </button>
      </InsightCard>
    </div>
  )
}
