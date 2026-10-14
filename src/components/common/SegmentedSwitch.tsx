'use client'

/**
 * SegmentedSwitch — the one switch for "two views of the same kind of thing"
 * (Phase 5a-2, ledger model §9 "consistency kit").
 *
 * Used by Bills (Sales | Purchases) and Khata (Customers | Suppliers); Home
 * (Overview | Insights) and the Insights sections use it later. One component
 * so every switch looks, sizes and behaves the same.
 *
 * Touch: the track is 48 px tall (4 px padding + 40 px buttons), so each
 * option meets the 48 px floor across its full width.
 */
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Optional dot colour class (a book colour), e.g. 'bg-primary'. */
  dotClassName?: string
}

export function SegmentedSwitch<T extends string>({
  options, value, onChange, ariaLabel, className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('grid grid-flow-col auto-cols-fr gap-1 rounded-2xl bg-muted p-1', className)}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => { if (!on) { haptic.click(); onChange(o.value) } }}
            className={cn(
              'hit-48 min-h-10 rounded-xl px-2 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors',
              on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.dotClassName && <span aria-hidden className={cn('w-2 h-2 rounded-full', o.dotClassName)} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
