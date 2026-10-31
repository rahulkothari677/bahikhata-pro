'use client'

/**
 * A customer's or supplier's history (#327, #328 — 31 Oct 2026; redesigned the same day
 * after Rahul: "less colour … can't differentiate between sale and payment, no symbol for
 * inward or outwards … date is mentioned in a way that doesn't easy to look").
 *
 * Every entry says which way it went: YOU GAVE (goods or money left the shop) in red
 * with ↑, YOU GOT (came in) in green with ↓ (lib/party-history.ts), and a type icon
 * tells a bill from a payment from a return. Time reads at three levels, the way the
 * best chat and banking feeds do it, plus one thing none of them has: each MONTH opens
 * with its totals and the balance it closed on, so a year reads like chapters of a bahi;
 * each DAY is a floating date (chat) or a bar (bahi) carrying that day's gave/got; each
 * ENTRY shows its time only when one was recorded. Totals count every matching entry,
 * not only the 30 on screen. Two views: the chat (gave on the right, like your own
 * messages) and the bahi table (You gave | You got, the balance after each).
 */
import { useEffect, useState } from 'react'
import { Search, Receipt, Wallet, RotateCcw, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ChipRow } from '@/components/common/ChipRow'
import { SegmentedSwitch } from '@/components/common/SegmentedSwitch'
import { cn, formatINR, hasRecordedTime } from '@/lib/utils'
import { billDayKey, billDayLabel, groupByDay } from '@/lib/bill-days'
import {
  HISTORY_FILTERS, HISTORY_PAGE, filterHistory, historyKind, direction, periodTotals, paidOnBill,
  type HistoryEntry, type HistoryFilter, type HistoryKind,
} from '@/lib/party-history'

type View = 'chat' | 'ledger'
const VIEW_KEY = 'bahikhata:party-history-view'
// Day headers stick just under the app's top bar (Header.tsx: 3.5rem + the phone's safe area).
const STICKY_TOP = { top: 'calc(3.5rem + var(--safe-top, 0px))' }
const monthOf = (dayKey: string) => dayKey.slice(0, 7)

function readView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'ledger' ? 'ledger' : 'chat' } catch { return 'chat' }
}

function TypeIcon({ kind, className }: { kind: HistoryKind | null; className?: string }) {
  if (kind === 'got' || kind === 'gave') return <Wallet className={className} aria-hidden />
  if (kind === 'return_in' || kind === 'return_out') return <RotateCcw className={className} aria-hidden />
  return <Receipt className={className} aria-hidden />
}

/** ↑ ₹700 in red, ↓ ₹450 in green — the pair every header uses. */
function GaveGot({ tot, className }: { tot?: { gave: number; got: number }; className?: string }) {
  if (!tot) return null
  return (
    <span className={cn('inline-flex items-center gap-2 tabular-nums', className)}>
      {tot.gave > 0 && <span className="inline-flex items-center gap-0.5 text-bad"><ArrowUpRight className="w-3.5 h-3.5" aria-hidden />{formatINR(tot.gave)}</span>}
      {tot.got > 0 && <span className="inline-flex items-center gap-0.5 text-good"><ArrowDownLeft className="w-3.5 h-3.5" aria-hidden />{formatINR(tot.got)}</span>}
    </span>
  )
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
  useEffect(() => { setShown(HISTORY_PAGE) }, [filter, q])
  const days = groupByDay(rows.slice(0, shown))
  const dayTot = periodTotals(rows, (e) => billDayKey(e.date))
  const monthTot = periodTotals(rows, (e) => monthOf(billDayKey(e.date)))
  // The oldest month of a capped khata is only partly loaded: no total rather than a short one.
  const oldestMonth = rows.length ? monthOf(billDayKey(rows[rows.length - 1].date)) : ''
  // "Closed on" is the balance after the month's last entry — true only when nothing is hidden.
  const unfiltered = filter === 'all' && !q.trim()
  const now = new Date()
  const dayName = (key: string) => billDayLabel(key, now, { today: t('bills.today'), yesterday: t('bills.yesterday') })
  const monthName = (key: string) => new Date(`${key}-01T00:00:00.000Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const mode = (m?: string | null) => (m && ['cash', 'upi', 'card', 'bank', 'other'].includes(m) ? t(`ins.mode.${m}`) : m || '')
  const timeOf = (e: HistoryEntry) => (hasRecordedTime(e.date) ? new Date(e.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '')
  // One line under a bill: its number, items, and money paid on it (so the day's ↓ adds up
  // on screen); under a payment: how it came and the note.
  const detailOf = (e: HistoryEntry, withPaid = true) => {
    if (e.isPayment) return [mode(e.paymentMode), e.notes].filter(Boolean).join(' · ')
    const paid = withPaid ? paidOnBill(e) : 0
    return [
      e.invoiceNo,
      (e.itemCount === 1 ? t('items.count_1') : t('bahi.items_n')).replace('{n}', String(e.itemCount ?? 0)),
      paid > 0 && (e.due ?? 0) > 0.004 ? t('bahi.paid_v').replace('{v}', formatINR(paid)) : '',
    ].filter(Boolean).join(' · ')
  }

  /** A month opens with its totals and the balance it closed on (the newest entry's). */
  const monthBand = (key: string, closing: number) => (
    <div className="px-4 pt-4 pb-2 border-t border-border/60 bg-card" data-history-month={key}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">{monthName(key)}</span>
        {(notice && key === oldestMonth) ? null : <GaveGot tot={monthTot.get(key)} className="text-xs font-semibold" />}
      </div>
      {unfiltered && <p className="text-xs text-muted-foreground tabular-nums">{t(key === monthOf(billDayKey(now)) ? 'bahi.month_now' : 'bahi.month_close').replace('{v}', balWords(closing))}</p>}
    </div>
  )
  /** Months break wherever the shown days cross one. */
  const withMonths = (render: (day: { key: string; rows: HistoryEntry[] }) => React.ReactNode) =>
    days.map((day, di) => (
      <div key={`${day.key}-${di}`}>
        {(di === 0 || monthOf(days[di - 1].key) !== monthOf(day.key)) && monthBand(monthOf(day.key), day.rows[0].runningBalance)}
        {render(day)}
      </div>
    ))

  return (
    <section aria-labelledby="history-title" className="rounded-2xl bg-card border border-border/60 shadow-card overflow-clip" data-party-history>
      <div className="px-4 pt-4 pb-3 space-y-3">
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
            {/* The key, once: what red ↑ and green ↓ mean on this page. */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground" data-history-key>
              <span className="inline-flex items-center gap-1"><span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-bad text-white"><ArrowUpRight className="w-3.5 h-3.5" aria-hidden /></span>{t('bahi.you_gave')}</span>
              <span className="inline-flex items-center gap-1"><span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-good text-white"><ArrowDownLeft className="w-3.5 h-3.5" aria-hidden /></span>{t('bahi.you_got')}</span>
            </div>
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
        <p className="px-4 pb-5 text-sm text-muted-foreground">{t('bahi.empty')}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-muted-foreground">{t('bahi.no_match').replace('{q}', q.trim() || t(`bahi.f.${filter}`))}</p>
      ) : view === 'chat' ? (
        <div data-history-view="chat" className="pb-2">
          {withMonths((day) => (
            <div className="bg-muted/30">
              {/* The day floats over the chat while you scroll through it, like a messaging app's date. */}
              <div className="sticky z-10 flex justify-center py-2 pointer-events-none" style={STICKY_TOP} data-history-day>
                <span className="inline-flex items-center gap-2 rounded-full bg-card/95 backdrop-blur border border-border/70 shadow-sm px-3 py-1 text-xs font-semibold">
                  <span>{dayName(day.key)}</span>
                  <GaveGot tot={dayTot.get(day.key)} />
                </span>
              </div>
              <ol className="px-3 pb-3 space-y-2">
                {day.rows.map((e) => {
                  const kind = historyKind(e)
                  const gave = direction(kind) === 'gave'
                  const due = !e.isPayment && (e.due ?? 0) > 0.004
                  const bubble = (
                    <span className={cn(
                      'block w-[84%] max-w-sm rounded-2xl px-3 py-2 text-left shadow-sm ring-1',
                      gave ? 'bg-bad-soft ring-bad/15 rounded-br-sm' : 'bg-good-soft ring-good/15 rounded-bl-sm',
                    )} data-direction={gave ? 'gave' : 'got'}>
                      <span className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 font-semibold text-foreground min-w-0">
                          <TypeIcon kind={kind} className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{kind ? label(kind) : e.type}</span>
                        </span>
                        <span className="text-muted-foreground tabular-nums shrink-0">{timeOf(e)}</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className={cn('inline-flex items-center gap-1.5 text-xl font-bold tabular-nums leading-none', gave ? 'text-bad' : 'text-good')}>
                          <span className={cn('inline-flex w-6 h-6 shrink-0 items-center justify-center rounded-full text-white', gave ? 'bg-bad' : 'bg-good')}>
                            {gave ? <ArrowUpRight className="w-4 h-4" aria-hidden /> : <ArrowDownLeft className="w-4 h-4" aria-hidden />}
                          </span>
                          {formatINR(e.amount)}
                        </span>
                        {!e.isPayment && (
                          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', due ? 'bg-check-soft text-check' : 'bg-card/80 text-good')}>
                            {due ? t('bahi.due').replace('{v}', formatINR(e.due!)) : `✓ ${t('bahi.paid')}`}
                          </span>
                        )}
                      </span>
                      {detailOf(e) && <span className="block mt-1.5 text-xs text-muted-foreground break-words">{detailOf(e)}</span>}
                      <span className={cn('block mt-1.5 pt-1.5 border-t text-xs text-muted-foreground tabular-nums', gave ? 'border-bad/10' : 'border-good/10')}>
                        {t('bahi.bal')} {balWords(e.runningBalance)}
                      </span>
                    </span>
                  )
                  return (
                    <li key={`${e.isPayment ? 'pay' : 'txn'}-${e.id}`} className={cn('flex', gave ? 'justify-end' : 'justify-start')}>
                      {e.isPayment ? bubble : (
                        <button type="button" onClick={() => onOpenBill(e.id)} className={cn('flex w-full min-h-12', gave ? 'justify-end' : 'justify-start')}>
                          {bubble}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        <div data-history-view="ledger" className="pb-1">
          {/* The bahi: what it was | you gave | you got, and the balance after it. */}
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2 px-4 py-2 text-xs font-semibold border-t border-border/60">
            <span className="text-muted-foreground">{t('bahi.entry')}</span>
            <span className="text-right text-bad">↑ {t('bahi.you_gave')}</span>
            <span className="text-right text-good">↓ {t('bahi.you_got')}</span>
          </div>
          {withMonths((day) => (
            <>
              <div className="sticky z-10 flex items-center justify-between gap-2 px-4 py-1.5 bg-muted/90 backdrop-blur border-y border-border/60" style={STICKY_TOP} data-history-day>
                <span className="text-xs font-semibold">{dayName(day.key)}</span>
                <GaveGot tot={dayTot.get(day.key)} className="text-xs font-semibold" />
              </div>
              <ol>
                {day.rows.map((e) => {
                  const kind = historyKind(e)
                  const gave = direction(kind) === 'gave'
                  // A bill's own side is its amount; money paid on it sits in the other
                  // column of the same line, as in a paper bahi — the columns add to the day.
                  const paid = paidOnBill(e)
                  const cell = (v: number, main: boolean) => (main || v > 0 ? <span className={main ? 'font-bold' : 'font-medium'}>{formatINR(v)}</span> : null)
                  const body = (
                    <>
                      <span className="min-w-0 text-left">
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          <TypeIcon kind={kind} className={cn('w-4 h-4 shrink-0', gave ? 'text-bad' : 'text-good')} />
                          <span className="truncate">{kind ? label(kind) : e.type}</span>
                        </span>
                        {/* Wraps rather than cuts: at 375 px a cut line hid the entry's time (live, 31 Oct). */}
                        <span className="block text-xs text-muted-foreground break-words">{[detailOf(e, false), timeOf(e)].filter(Boolean).join(' · ')}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">{t('bahi.bal')} {balWords(e.runningBalance)}</span>
                      </span>
                      <span className="text-right text-sm tabular-nums text-bad">{gave ? cell(e.amount, true) : cell(paid, false)}</span>
                      <span className="text-right text-sm tabular-nums text-good">{gave ? cell(paid, false) : cell(e.amount, true)}</span>
                    </>
                  )
                  const grid = 'w-full grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-start gap-2 px-4 py-2.5'
                  return (
                    <li key={`${e.isPayment ? 'pay' : 'txn'}-${e.id}`} className="border-t border-border/40 first:border-t-0">
                      {e.isPayment ? <div className={grid}>{body}</div> : (
                        <button type="button" onClick={() => onOpenBill(e.id)} className={cn(grid, 'min-h-12 hover:bg-muted/40')}>{body}</button>
                      )}
                    </li>
                  )
                })}
              </ol>
            </>
          ))}
        </div>
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
