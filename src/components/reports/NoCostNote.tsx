'use client'

/**
 * #254 (Phase 6a): how the profit reports show sales whose profit is not
 * counted — an item saved without a cost price (or at cost ₹0) and lines typed
 * into a bill. One component and one wording for Bill-wise and Item-wise
 * profit, the way Insights says "No cost price" (ins.typed). The amount is on
 * screen; the why is behind ⓘ.
 */
import { InfoHint } from '@/components/common/InfoHint'
import { formatINR } from '@/lib/utils'

/** A margin from marginOnCosted(): null means nothing sold had a cost price. */
export function marginText(margin: number | null | undefined): string {
  return margin === null || margin === undefined ? 'No cost price' : `${margin}%`
}

export function NoCostNote({ amount }: { amount: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      • {formatINR(amount)} with no cost price
      <InfoHint
        label="no cost price"
        text="Items saved without a cost price (or at ₹0), and lines typed into a bill, book no profit. Their sales are left out of the margin. Add the item's cost price to count its profit."
      />
    </span>
  )
}
