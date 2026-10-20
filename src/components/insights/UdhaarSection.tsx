'use client'

/**
 * Insights → Udhaar (Phase 5c-2, ledger model v4): the whole receivable by
 * age — every customer who owes you in exactly one group, placed by their
 * oldest unpaid bill — what was given and collected in the period, the
 * biggest balances, and what you owe suppliers. Balances are the same ones
 * Khata shows (getReceivablePayable on the server).
 */
import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import { formatINR } from '@/lib/utils'
import { handleNavAction } from '@/lib/handle-nav-action'
import { getById } from '@/lib/nav-registry'
import { useOpenList } from '@/hooks/use-open-list'
import { useInsights } from '@/hooks/use-insights'
import { daysOld } from '@/lib/insights-view'
import { GroupBar, InsightCard, InsightsState, RankList, SECTION_GRID, TotalsStrip } from '@/components/insights/InsightsKit'
import type { DateRange } from '@/components/common/DateRangePicker'

/** Young udhaar is fine; the older it gets, the more it needs a look. */
export const AGE_DOT: Record<string, string> = {
  d15: 'bg-good', d30: 'bg-check', d60: 'bg-bad/60', over: 'bg-bad', opening: 'bg-muted-foreground/40',
}

export function UdhaarSection({ range, t }: { range: DateRange; t: (k: string) => string }) {
  const { data, isLoading, isError, refetch } = useInsights('udhaar', range)
  const setSelectedPartyId = useAppStore((s) => s.setSelectedPartyId)
  const setPreviousView = useAppStore((s) => s.setPreviousView)
  const setView = useAppStore((s) => s.setView)
  const setKhataSide = useAppStore((s) => s.setKhataSide)
  const openList = useOpenList()
  if (isLoading && !data) return <InsightsState kind="loading" t={t} />
  if (isError || !data) return <InsightsState kind="error" onRetry={() => refetch()} t={t} />

  const now = new Date()
  const openParty = (id: string) => { haptic.click(); setSelectedPartyId(id); setPreviousView('dashboard'); setView('party-profile') }
  const openKhata = (side: 'customer' | 'supplier') => { haptic.click(); setKhataSide(side); setPreviousView('dashboard'); setView('parties') }
  const reminders = getById('whatsapp-reminders')
  const { totals } = data
  const given = totals.given, collected = totals.collected, top = Math.max(given, collected)
  const custN = (n: number) => t(n === 1 ? 'ins.customer_1' : 'ins.customers_n').replace('{n}', String(n))

  return (
    <div className={SECTION_GRID}>
      <TotalsStrip className="lg:col-span-2" cells={[
        { label: t('ins.to_collect'), value: formatINR(totals.toCollect), sub: custN(totals.customers), tone: totals.toCollect > 0 ? 'good' : undefined },
        { label: t('ins.collected'), value: formatINR(collected), sub: t('ins.this_period') },
        { label: t('ins.given'), value: formatINR(given), sub: t('ins.this_period') },
      ]} />

      {totals.customers === 0 ? <InsightsState kind="empty" t={(k) => (k === 'ins.empty' ? t('ins.no_udhaar') : t(k))} /> : (
        <InsightCard title={t('ins.age_title')} note={t('ins.as_of_today')} info={t('ins.age_info')}>
          <GroupBar
            ariaLabel={t('ins.age_title')}
            rows={data.age.map((g) => ({
              id: g.id, label: t(`ins.age.${g.id}`), sub: custN(g.count), amount: g.amount, share: g.share, dot: AGE_DOT[g.id] ?? AGE_DOT.opening,
              // 5e-4b: the age band opens Khata with exactly these customers (as of today, so no period).
              onClick: g.count > 0 ? () => openList('khata', `age:${g.id}`, t(`ins.age.${g.id}`)) : undefined,
            }))}
          />
        </InsightCard>
      )}

      <InsightCard title={t('ins.in_period')}>
        <ul className="space-y-2.5">
          {[{ k: 'ins.given', v: given, bar: 'bg-bad' }, { k: 'ins.collected', v: collected, bar: 'bg-good' }].map((r) => (
            <li key={r.k} className="space-y-1">
              <div className="flex justify-between gap-2 text-sm"><span>{t(r.k)}</span><b className="tabular-nums">{formatINR(r.v)}</b></div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${r.bar}`} style={{ width: `${top > 0 ? (r.v / top) * 100 : 0}%` }} /></div>
            </li>
          ))}
        </ul>
        {reminders && totals.customers > 0 && (
          <button type="button" onClick={() => handleNavAction(reminders, { previousView: 'dashboard' })} className="w-full min-h-12 rounded-xl bg-good text-white text-sm font-semibold hover:opacity-90">
            {t('ins.plan_reminders')}
          </button>
        )}
      </InsightCard>

      {data.biggest.length > 0 && (
        <InsightCard title={t('ins.biggest')}>
          <RankList rows={data.biggest.map((b) => {
            const d = daysOld(b.oldestUnpaid, now)
            return {
              key: b.id, name: b.name, value: formatINR(b.balance), tone: 'good' as const, onClick: () => openParty(b.id),
              line: d === null ? t('ins.opening_only') : d === 0 ? t('ins.oldest_today') : t('ins.oldest_days').replace('{n}', String(d)),
            }
          })} />
          <button type="button" onClick={() => openKhata('customer')} className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted">
            {t('ins.see_khata').replace('{n}', String(totals.customers))}
          </button>
        </InsightCard>
      )}

      {data.toPay.suppliers > 0 && (
        <InsightCard title={t('today.to_pay')} note={formatINR(data.toPay.total)}>
          <RankList rows={data.toPay.biggest.map((b) => ({ key: b.id, name: b.name, value: formatINR(b.balance), tone: 'bad' as const, onClick: () => openParty(b.id) }))} />
          {data.toPay.suppliers > data.toPay.biggest.length && (
            <button type="button" onClick={() => openKhata('supplier')} className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted">
              {t('ins.see_suppliers').replace('{n}', String(data.toPay.suppliers))}
            </button>
          )}
        </InsightCard>
      )}
    </div>
  )
}
