'use client'

/**
 * The group a list was opened with from Insights — "A items · This Month",
 * "Gone quiet · Last Month", "16–30 days" — as an extra chip with ✕ (ledger
 * model v4 §4). It narrows the list and the chip counts under it; ✕ shows the
 * whole list again. Phase 5e-4b.
 */
import { X } from 'lucide-react'
import { haptic } from '@/lib/haptic'

export function FocusChip({ label, onClear, clearLabel }: { label: string; onClear: () => void; clearLabel: string }) {
  return (
    <div className="flex">
      <span className="inline-flex min-h-10 max-w-full items-center gap-1 rounded-full border border-primary bg-primary/10 pl-4 pr-1 text-sm font-semibold text-primary">
        <span className="truncate">{label}</span>
        <button
          type="button"
          onClick={() => { haptic.click(); onClear() }}
          aria-label={clearLabel}
          className="hit-48 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-primary/15"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </div>
  )
}
