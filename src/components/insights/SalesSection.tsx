'use client'

/**
 * Insights → Sales (Phase 5c-2, ledger model v4): three totals, day by day,
 * busiest hours, how customers paid, sales by category. Every figure is the
 * engine's; the payments rows add up to the bills' value and the category
 * rows to the sales before GST (any gap is its own row, from the engine).
 */
import { useState, type PointerEvent } from 'react'
import { cn, formatINR, formatINRCompact } from '@/lib/utils'
import { useInsights } from '@/hooks/use-insights'
import { calendarCells, changeVsBefore, hourLabel, hourWindow } from '@/lib/insights-view'
import { BarRows, GroupBar, InsightCard, InsightsState, SECTION_GRID, TotalsStrip } from '@/components/insights/InsightsKit'
import type { DateRange } from '@/components/common/DateRangePicker'

/** Paid modes are shades of money-in; udhaar (not paid yet) is the owed colour. */
export const MODE_DOT: Record<string, string> = {
  cash: 'bg-good', upi: 'bg-good/70', card: 'bg-good/45', bank: 'bg-good/25', other: 'bg-muted-foreground/40', udhaar: 'bg-bad', nobody: 'bg-check',
}
const LEVEL = ['bg-muted', 'bg-primary/15', 'bg-primary/35', 'bg-primary/60', 'bg-primary text-primary-foreground']

export function categoryLabel(id: string, t: (k: string) => string): string {
  if (id === '') return t('ins.no_category')
  if (id === '__unmatched') return t('ins.unmatched')
  if (id === '__typed') return t('ins.typed')
  return id
}

export function SalesSection({ range, t }: { range: DateRange; t: (k: string) => string }) {
  const { data, isLoading, isError, refetch } = useInsights('sales', range)
  if (isLoading && !data) return <InsightsState kind="loading" t={t} />
  if (isError || !data) return <InsightsState kind="error" onRetry={() => refetch()} t={t} />
  const { totals } = data
  const change = changeVsBefore(totals.sales, totals.previous)
  const sub = change
    ? t(change.dir === 'same' ? 'ins.same_as_before' : change.dir === 'up' ? 'ins.up_on_before' : 'ins.down_on_before').replace('{n}', String(change.pct))
    : undefined
  const strip = (
    <TotalsStrip className="lg:col-span-2" cells={[
      { label: t('ins.sales'), value: formatINR(totals.sales), sub },
      { label: t('ins.bills'), value: String(totals.bills) },
      { label: t('ins.avg_bill'), value: formatINR(totals.averageBill) },
    ]} />
  )
  if (totals.bills === 0 && totals.returns === 0) return <div className="space-y-3">{strip}<InsightsState kind="empty" t={t} /></div>

  const hours = hourWindow(data.hours)
  const days = data.calendar.length
  return (
    <div className={SECTION_GRID}>
      {strip}
      {days >= 2 && (
        <InsightCard title={t('ins.day_by_day')}>
          <DayCalendar days={data.calendar} t={t} />
        </InsightCard>
      )}
      {hours.length > 0 && (
        <InsightCard title={t('ins.hours')} note={days > 1 ? t('ins.hours_note') : undefined}>
          <HoursChart hours={hours} perDayNote={days > 1} t={t} />
        </InsightCard>
      )}
      <InsightCard title={t('ins.paid')} info={t('ins.paid_info')}>
        <GroupBar
          ariaLabel={t('ins.paid')}
          rows={data.payments.map((g) => ({ id: g.id, label: t(`ins.mode.${g.id}`), amount: g.amount, share: g.share, dot: MODE_DOT[g.id] ?? MODE_DOT.other }))}
        />
      </InsightCard>
      {data.categories.length > 0 && (
        <InsightCard title={t('ins.by_cat')} note={t('ins.before_gst')}>
          <BarRows rows={data.categories.map((c) => ({ id: c.id || 'none', label: categoryLabel(c.id, t), amount: c.amount, share: c.share }))} />
        </InsightCard>
      )}
    </div>
  )
}

/** Every day of the period, Monday first; tap a day to read it. */
function DayCalendar({ days, t }: { days: { day: string; label: string; amount: number }[]; t: (k: string) => string }) {
  const cells = calendarCells(days)
  const [picked, setPicked] = useState<string | null>(null)
  const sel = days.find((d) => d.day === picked)
  const heads = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    <div className="space-y-2">
      <p className="text-sm min-h-5" aria-live="polite">
        {sel ? <><span className="text-muted-foreground">{sel.label} · </span><b className="tabular-nums">{formatINR(sel.amount)}</b></> : <span className="text-muted-foreground">{t('ins.tap_day')}</span>}
      </p>
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {heads.map((h, i) => <span key={`h${i}`} aria-hidden className="text-center text-xs text-muted-foreground">{h}</span>)}
        {cells.map((c) => c.day === null
          ? <span key={c.key} aria-hidden />
          : (
            <button
              key={c.key}
              type="button"
              onClick={() => setPicked(c.key)}
              aria-label={`${days.find((d) => d.day === c.key)?.label}: ${formatINR(c.amount)}`}
              aria-pressed={picked === c.key}
              className={cn('h-12 sm:h-14 rounded-lg flex flex-col items-center justify-center leading-none', LEVEL[c.level], picked === c.key && 'ring-2 ring-foreground')}
            >
              <span className="text-xs">{c.day}</span>
              {c.amount > 0 && <span className="hidden sm:block text-xs font-semibold tabular-nums">{formatINRCompact(c.amount).replace('₹', '')}</span>}
            </button>
          ))}
      </div>
    </div>
  )
}

/** Sales by hour, slide a finger along to read each hour (like Trends). */
function HoursChart({ hours, perDayNote, t }: { hours: { hour: number; perDay: number; bills: number }[]; perDayNote: boolean; t: (k: string) => string }) {
  const top = Math.max(...hours.map((h) => h.perDay), 0)
  const busiest = hours.reduce((b, h) => (h.perDay > b.perDay ? h : b), hours[0])
  const [at, setAt] = useState<number>(busiest.hour)
  const sel = hours.find((h) => h.hour === at) ?? busiest
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.min(hours.length - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * hours.length)))
    setAt(hours[i].hour)
  }
  return (
    <div className="space-y-2">
      <p className="text-sm" aria-live="polite">
        <span className="text-muted-foreground">{hourLabel(sel.hour)} · </span>
        <b className="tabular-nums">{formatINR(sel.perDay)}</b>
        <span className="text-muted-foreground">{perDayNote ? ` ${t('ins.a_day')}` : ''} · {t(sel.bills === 1 ? 'ins.bill_1' : 'ins.bills_n').replace('{n}', String(sel.bills))}</span>
      </p>
      <div
        role="img"
        aria-label={t('ins.hours')}
        onPointerDown={pick}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'mouse') pick(e) }}
        className="flex items-end gap-1 h-28 touch-none select-none"
      >
        {hours.map((h) => (
          <span key={h.hour} className="flex-1 h-full flex items-end">
            <span className={cn('w-full rounded-t-md', h.hour === sel.hour ? 'bg-primary' : 'bg-primary/35')} style={{ height: `${top > 0 ? Math.max(2, (h.perDay / top) * 100) : 2}%` }} />
          </span>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        <span>{hourLabel(hours[0].hour)}</span>
        <span>{hourLabel(hours[hours.length - 1].hour)}</span>
      </div>
    </div>
  )
}
