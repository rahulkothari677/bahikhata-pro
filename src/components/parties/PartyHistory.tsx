'use client'

/**
 * A customer's or supplier's history (#327, #328 — 31 Oct 2026).
 *
 * Rahul's June design — a WhatsApp-style chat, sales and payments received on the
 * right — is back as the default view (Phase 5e-6 had replaced it with ledger lines
 * without asking). The ledger lines stay as the second view. Either way: newest first,
 * 30 at a time with "Show older", a search (amount, bill no., note, date) and four
 * filters, so one entry among hundreds is a few letters away. Rules: lib/party-history.ts.
 */
import { Fragment, useEffect, useState } from 'react'
import { Search, HandCoins, Receipt } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ChipRow } from '@/components/common/ChipRow'
import { SegmentedSwitch } from '@/components/common/SegmentedSwitch'
import { cn, formatDate, formatINR, hasRecordedTime } from '@/lib/utils'
import {
  HISTORY_FILTERS, HISTORY_PAGE, filterHistory, historyKind, onRight,
  type HistoryEntry, type HistoryFilter, type HistoryKind,
} from '@/lib/party-history'

type View = 'chat' | 'ledger'
const VIEW_KEY = 'bahikhata:party-history-view'

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'ledger' ? 'ledger' : 'chat' } catch { return 'chat' }
}

export function PartyHistory({ entries, t, balWords, onOpenBill, notice }: {
  entries: HistoryEntry[]
  t: (k: string) => string
  /** The balance after an entry, in words ("they owe ₹1,200"). */
  balWords: (b: number) => string
  onOpenBill: (id: string) => void
  /** The "showing the latest N" note, when the khata holds more than the page loaded. */
  notice?: React.ReactNode
}) {
  const [view, setView] = useState<View>('chat')
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(HISTORY_PAGE)
  useEffect(() => { setView(readView()) }, [])
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* per device only */ } }

  const label = (k: HistoryKind) => t(`bahi.${k}`)
  // At most the 500 bills + 500 payments the page loads: cheap to filter on every render.
  const rows = filterHistory(entries, { filter, q, label })
  // A new search or filter starts from the newest again.
  useEffect(() => { setShown(HISTORY_PAGE) }, [filter, q])
  const page = rows.slice(0, shown)
  const mode = (m?: string | null) => (m && ['cash', 'upi', 'card', 'bank', 'other'].includes(m) ? t(`ins.mode.${m}`) : m || '')

  return (
    <section aria-labelledby="history-title" className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden" data-party-history>
      <div className="px-4 pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 id="history-title" className="text-base font-semibold">{t('bahi.history')}</h3>
          <SegmentedSwitch
            ariaLabel={t('bahi.view')}
            options={[{ value: 'chat', label: t('bahi.view.chat') }, { value: 'ledger', label: t('bahi.view.ledger') }]}
            value={view}
            onChange={(v) => pickView(v as View)}
          />
        </div>
        {entries.length > 0 && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
              <Input
                id="field-history-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('bahi.search_ph')}
                aria-label={t('bahi.search_ph')}
                className="pl-9"
              />
            </div>
            <ChipRow
              ariaLabel={t('bahi.history')}
              chips={HISTORY_FILTERS.map((f) => ({ value: f, label: t(`bahi.f.${f}`) }))}
              value={filter}
              onChange={(f) => setFilter(f as HistoryFilter)}
            />
          </>
        )}
        {notice}
      </div>

      {entries.length === 0 ? (
        <p className="px-4 pt-2 pb-5 text-sm text-muted-foreground">{t('bahi.empty')}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 pt-3 pb-5 text-sm text-muted-foreground">{t('bahi.no_match').replace('{q}', q.trim() || t(`bahi.f.${filter}`))}</p>
      ) : view === 'chat' ? (
        <ol className="px-3 pt-2 pb-2 space-y-1.5 bg-muted/30 mt-3" data-history-view="chat">
          {page.map((e, i) => {
            const kind = historyKind(e)
            const right = onRight(kind)
            const newDay = i === 0 || new Date(page[i - 1].date).toDateString() !== new Date(e.date).toDateString()
            // A time only when one was recorded — a date-only entry is midnight UTC, "05:30 am" in India (utils hasRecordedTime).
            const time = hasRecordedTime(e.date) ? new Date(e.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''
            const bubble = (
              <span className={cn(
                'block max-w-[82%] rounded-2xl px-3 py-2 text-left shadow-sm border',
                right ? 'bg-good-soft border-good/20 rounded-br-md' : 'bg-card border-border rounded-bl-md',
              )}>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  {e.isPayment ? <HandCoins className="w-3.5 h-3.5" aria-hidden /> : <Receipt className="w-3.5 h-3.5" aria-hidden />}
                  <span className="text-foreground">{kind ? label(kind) : e.type}</span>
                  {e.isPayment ? (mode(e.paymentMode) && <span>· {mode(e.paymentMode)}</span>) : (e.invoiceNo && <span>· {e.invoiceNo}</span>)}
                </span>
                <span className="block text-lg font-bold tabular-nums">{formatINR(e.amount)}</span>
                {e.notes && <span className="block text-xs text-muted-foreground break-words">{e.notes}</span>}
                <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>{e.isPayment ? balWords(e.runningBalance) : (e.due ?? 0) > 0.004 ? t('bahi.due').replace('{v}', formatINR(e.due!)) : `✓ ${t('bahi.paid')}`}</span>
                  <span className="tabular-nums">{time}</span>
                </span>
                {!e.isPayment && <span className="block text-xs text-muted-foreground">{balWords(e.runningBalance)}</span>}
              </span>
            )
            return (
              <Fragment key={`${e.isPayment ? 'pay' : 'txn'}-${e.id}`}>
                {newDay && (
                  <li className="flex justify-center pt-2 pb-1" aria-hidden>
                    <span className="text-xs font-medium text-muted-foreground bg-background px-3 py-1 rounded-full border border-border">{formatDate(e.date)}</span>
                  </li>
                )}
                <li className={cn('flex', right ? 'justify-end' : 'justify-start')}>
                  {e.isPayment ? bubble : (
                    <button type="button" onClick={() => onOpenBill(e.id)} className={cn('flex w-full min-h-12', right ? 'justify-end' : 'justify-start')}>
                      {bubble}
                    </button>
                  )}
                </li>
              </Fragment>
            )
          })}
        </ol>
      ) : (
        <ol className="pb-1 mt-2" data-history-view="ledger">
          {page.map((e, i) => {
            const kind = historyKind(e)
            const moneyIn = kind === 'got' || kind === 'return_out'
            const newDay = i === 0 || new Date(page[i - 1].date).toDateString() !== new Date(e.date).toDateString()
            const sub = e.isPayment
              ? [mode(e.paymentMode), e.notes].filter(Boolean).join(' · ')
              : [e.invoiceNo, (e.itemCount === 1 ? t('items.count_1') : t('bahi.items_n')).replace('{n}', String(e.itemCount ?? 0)), (e.due ?? 0) > 0.004 ? t('bahi.due').replace('{v}', formatINR(e.due!)) : t('bahi.paid')].filter(Boolean).join(' · ')
            const body = (
              <>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold">{kind ? label(kind) : e.type}</span>
                  {sub && <span className="block text-xs text-muted-foreground truncate">{sub}</span>}
                </span>
                <span className="text-right shrink-0">
                  <span className={cn('block text-sm font-bold tabular-nums', moneyIn && 'text-good')}>{formatINR(e.amount)}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">{balWords(e.runningBalance)}</span>
                </span>
              </>
            )
            return (
              <Fragment key={`${e.isPayment ? 'pay' : 'txn'}-${e.id}`}>
                {newDay && <li className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground">{formatDate(e.date)}</li>}
                <li className="border-t border-border/60">
                  {e.isPayment ? (
                    <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
                  ) : (
                    <button type="button" onClick={() => onOpenBill(e.id)} className="w-full min-h-12 flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">{body}</button>
                  )}
                </li>
              </Fragment>
            )
          })}
        </ol>
      )}

      {rows.length > shown && (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => setShown((n) => n + HISTORY_PAGE)}
            className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted"
          >
            {t('bahi.older').replace('{n}', String(Math.min(HISTORY_PAGE, rows.length - shown))).replace('{m}', String(rows.length - shown))}
          </button>
        </div>
      )}
    </section>
  )
}
