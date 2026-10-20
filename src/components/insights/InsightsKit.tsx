'use client'

/**
 * The Insights building blocks (Phase 5c-2, ledger model v4 §2–3): a card, the
 * three-totals strip, the group bar whose rows add up to the whole, the
 * ranked list and the bar rows. Every section is made of these, so the five
 * sections read alike. They only draw what the engine summed.
 */
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { InfoHint } from '@/components/common/InfoHint'
import { cn, formatINR } from '@/lib/utils'

/** One column on a phone; two from 1024px, the totals across both. */
export const SECTION_GRID = 'space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start'

export function InsightCard({ title, note, info, children, className }: { title: string; note?: string; info?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl bg-card border border-border/60 shadow-card p-3 lg:p-4 space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex items-center gap-1 min-w-0">
          <span className="break-words">{title}</span>
          {info && <InfoHint text={info} label={title} />}
        </h3>
        {note && <span className="text-xs text-muted-foreground text-right">{note}</span>}
      </div>
      {children}
    </section>
  )
}

export interface TotalCell { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }

/** Three totals in one strip — the whole first. */
export function TotalsStrip({ cells, className }: { cells: TotalCell[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-3 rounded-2xl bg-card border border-border/60 shadow-card divide-x divide-border/60', className)}>
      {cells.map((c) => (
        <div key={c.label} className="p-3 min-w-0">
          <span className="block text-xs text-muted-foreground">{c.label}</span>
          <span className={cn('block text-base sm:text-lg font-bold tabular-nums break-words', c.tone === 'good' && 'text-good', c.tone === 'bad' && 'text-bad')}>{c.value}</span>
          {c.sub && <span className="block text-xs text-muted-foreground">{c.sub}</span>}
        </div>
      ))}
    </div>
  )
}

export interface GroupRow {
  id: string; label: string; sub?: string; amount: number; share: number; dot: string; value?: string
  /** What the bar slice is sized by, when not the amount (customers: how many are in the group). */
  weight?: number
  /** What sits under the value, when not the share (e.g. "in stock"). */
  small?: string
  /** Phase 5e-4b: open the full list with this group selected (ledger model v4 §2). */
  onClick?: () => void
}

/**
 * A bar split into groups, then one row per group. Bar widths are the exact
 * amounts; the percent on each row is the engine's whole-number share (they
 * add to 100). A group of ₹0 has a row but no slice.
 */
export function GroupBar({ rows, ariaLabel }: { rows: GroupRow[]; ariaLabel: string }) {
  const size = (r: GroupRow) => Math.max(0, r.weight ?? r.amount)
  const total = rows.reduce((s, r) => s + size(r), 0)
  return (
    <div className="space-y-1">
      <div role="img" aria-label={ariaLabel} className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {total > 0 && rows.filter((r) => size(r) > 0).map((r) => (
          <span key={r.id} className={cn('h-full', r.dot)} style={{ width: `${(size(r) / total) * 100}%` }} />
        ))}
      </div>
      <ul className="divide-y divide-border/60">
        {rows.map((r) => {
          const body = (
            <>
              <span aria-hidden className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', r.dot)} />
              <span className="flex-1 min-w-0 text-left">
                <span className="block text-sm font-semibold break-words">{r.label}</span>
                {r.sub && <span className="block text-xs text-muted-foreground">{r.sub}</span>}
              </span>
              <span className="text-right">
                <span className="block text-sm font-bold tabular-nums whitespace-nowrap">{r.value ?? formatINR(r.amount)}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{r.small ?? `${r.share}%`}</span>
              </span>
              {r.onClick && <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
            </>
          )
          return (
            <li key={r.id}>
              {r.onClick
                ? <button type="button" onClick={r.onClick} className="w-full min-h-12 flex items-center gap-3 py-2.5 hover:bg-muted/40 rounded-lg">{body}</button>
                : <div className="flex items-center gap-3 py-2.5">{body}</div>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export interface RankRow { key: string; name: string; line?: string; value: string; tone?: 'good' | 'bad'; onClick?: () => void; /** The row's tap named as an action, e.g. "Price". */ action?: string }

export interface StatRow { id: string; label: string; sub?: string; value: string; small?: string; dot: string; onClick?: () => void }

/** Rows that are counts, not parts of one whole (stock: out, low, not sold) — no bar, no share. */
export function StatRows({ rows }: { rows: StatRow[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((r) => {
        const body = (
          <>
            <span aria-hidden className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', r.dot)} />
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-sm font-semibold break-words">{r.label}</span>
              {r.sub && <span className="block text-xs text-muted-foreground">{r.sub}</span>}
            </span>
            <span className="text-right">
              <span className="block text-sm font-bold tabular-nums whitespace-nowrap">{r.value}</span>
              {r.small && <span className="block text-xs text-muted-foreground">{r.small}</span>}
            </span>
            {r.onClick && <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          </>
        )
        return (
          <li key={r.id}>
            {r.onClick
              ? <button type="button" onClick={r.onClick} className="w-full min-h-12 flex items-center gap-3 py-2.5 hover:bg-muted/40 rounded-lg">{body}</button>
              : <div className="flex items-center gap-3 py-2.5">{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}

/** Ranked rows: number, name, one line, value. A row that opens something is a 48px button. */
export function RankList({ rows }: { rows: RankRow[] }) {
  return (
    <ol className="divide-y divide-border/60">
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="w-7 h-7 rounded-full bg-muted text-xs font-bold flex items-center justify-center flex-shrink-0 tabular-nums">{i + 1}</span>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-sm font-semibold break-words">{r.name}</span>
              {r.line && <span className="block text-xs text-muted-foreground">{r.line}</span>}
            </span>
            <span className={cn('text-sm font-bold tabular-nums whitespace-nowrap', r.tone === 'good' && 'text-good', r.tone === 'bad' && 'text-bad')}>{r.value}</span>
            {/* An action named next to its number (ledger model v4: "Price" next to a cost that went up). */}
            {r.onClick && r.action && <span className="shrink-0 rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary">{r.action}</span>}
            {r.onClick && !r.action && <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          </>
        )
        return (
          <li key={r.key}>
            {r.onClick
              ? <button type="button" onClick={r.onClick} className="w-full min-h-12 flex items-center gap-3 py-2.5 hover:bg-muted/40 rounded-lg">{body}</button>
              : <div className="flex items-center gap-3 py-2.5">{body}</div>}
          </li>
        )
      })}
    </ol>
  )
}

/** Bars against the largest row, with the value and share (sales by category). */
export function BarRows({ rows }: { rows: { id: string; label: string; amount: number; share: number }[] }) {
  const top = Math.max(0, ...rows.map((r) => r.amount))
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.id} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 break-words">{r.label}</span>
            <span className="font-semibold tabular-nums whitespace-nowrap">{formatINR(r.amount)} <span className="text-xs font-normal text-muted-foreground">· {r.share}%</span></span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${top > 0 ? (Math.max(0, r.amount) / top) * 100 : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Loading, failed and empty states, the same in every section. */
export function InsightsState({ kind, onRetry, t }: { kind: 'loading' | 'error' | 'empty'; onRetry?: () => void; t: (k: string) => string }) {
  if (kind === 'loading') {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t('ins.loading')}>
        {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />)}
      </div>
    )
  }
  if (kind === 'error') {
    return (
      <div className="rounded-2xl bg-card border border-border/60 p-6 text-center space-y-3">
        <p className="text-sm font-semibold">{t('ins.error')}</p>
        {onRetry && <button type="button" onClick={onRetry} className="min-h-12 px-5 rounded-xl border border-border text-sm font-semibold hover:bg-muted">{t('ins.retry')}</button>}
      </div>
    )
  }
  return <p className="rounded-2xl bg-card border border-border/60 p-6 text-center text-sm text-muted-foreground">{t('ins.empty')}</p>
}
