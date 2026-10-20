'use client'

/**
 * A report's rows on a phone (#241, Phase 5f-3): each row is the name, one
 * line under it, and the one number that matters on the right; tap it for the
 * rest. Six reports showed a desktop table you swiped sideways at 375 px
 * (Revenue, COGS, Profit, Margin off screen). The table stays for wider
 * screens — the report renders this with `sm:hidden` and the table `hidden sm:block`.
 *
 * Native <details>, so it opens with a tap or the keyboard and needs no state.
 */
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReportRow {
  key: string
  title: string
  sub?: string
  /** The one number that matters for this report. */
  value: string
  tone?: 'good' | 'bad' | 'check'
  /** Everything else the table shows, label and value. */
  details: { label: string; value: string }[]
}

export function ReportRows({ rows, total, empty, className }: {
  rows: ReportRow[]
  total?: { label: string; value: string }
  empty?: string
  className?: string
}) {
  if (rows.length === 0) return empty ? <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>{empty}</p> : null
  const tone = (t?: ReportRow['tone']) => (t === 'good' ? 'text-good' : t === 'bad' ? 'text-bad' : t === 'check' ? 'text-check' : '')
  return (
    <div className={cn('rounded-xl border border-border/60 overflow-hidden', className)}>
      <ul className="divide-y divide-border/60">
        {rows.map((r) => (
          <li key={r.key}>
            <details className="group">
              <summary className="list-none [&::-webkit-details-marker]:hidden min-h-12 px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/40">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{r.title}</span>
                  {r.sub && <span className="block text-xs text-muted-foreground truncate">{r.sub}</span>}
                </span>
                <span className={cn('text-sm font-bold tabular-nums shrink-0', tone(r.tone))}>{r.value}</span>
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 pb-3 pt-1 text-xs">
                {r.details.map((d) => (
                  <div key={d.label} className="flex justify-between gap-2 min-w-0">
                    <dt className="text-muted-foreground truncate">{d.label}</dt>
                    <dd className="font-medium tabular-nums text-right">{d.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ul>
      {total && (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-muted/40 border-t border-border/60 text-sm font-bold">
          <span>{total.label}</span>
          <span className="tabular-nums">{total.value}</span>
        </div>
      )}
    </div>
  )
}
