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

/**
 * 6a-2: bills saved under an older rule booked a slightly different profit
 * than their items now add up to. The total follows the bills (Home's figure);
 * the difference is shown, never spread or dropped — Insights' "Not matched to
 * items" row, the same words.
 */
export function UnmatchedNote({ amount }: { amount: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      • {formatINR(amount)} not matched to items
      <InfoHint
        label="not matched to items"
        text="Some older bills booked a slightly different profit than their items add up to today (saved before a rule change). The total follows the bills, the same as Home."
      />
    </span>
  )
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
