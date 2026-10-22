/**
 * The screens where a bill is being written (one list for every caller).
 *
 * Phase 6e: on these screens single letters belong to the bill — a barcode gun
 * types the codes it reads, and SKUs carry letters ("SNK001") — so the app's
 * one-letter shortcuts (S = Sales, N = New, D = Home… KeyboardShortcuts.tsx)
 * stay off here. Before this, a scanned "SNK001" left the bill on the "S".
 */
export const ENTRY_VIEWS: readonly string[] = ['new-sale', 'new-purchase', 'new-estimate']

export function isEntryView(view: string | null | undefined): boolean {
  return !!view && ENTRY_VIEWS.includes(view)
}
