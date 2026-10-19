'use client'

/**
 * ChipRow — one row of choice chips (ledger model v4 consistency kit).
 * Insights sections first (Phase 5c-2); Bills and Khata group chips (5d, 5e)
 * use the same row, so a chip looks and works the same everywhere.
 *
 * Scrolls sideways on a narrow phone instead of wrapping into a second row,
 * each chip has a 48px tap area (hit-48) and says whether it is on
 * (aria-pressed), and an optional count sits inside the chip.
 */
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'

export interface Chip<T extends string> { value: T; label: string; count?: number }

export function ChipRow<T extends string>({ chips, value, onChange, ariaLabel, className }: {
  chips: Chip<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]', className)}>
      {chips.map((c) => {
        const on = c.value === value
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => { if (!on) { haptic.click(); onChange(c.value) } }}
            className={cn(
              'hit-48 shrink-0 min-h-10 rounded-full border px-4 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors',
              on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary/40',
            )}
          >
            {c.label}
            {c.count !== undefined && <span className={cn('tabular-nums', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{c.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
