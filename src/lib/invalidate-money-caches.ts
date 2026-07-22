/**
 * invalidateMoneyCaches — shared helper that invalidates every React Query
 * cache touched by a money mutation (sale, purchase, payment, income/expense,
 * credit/debit note, edit, delete, recurring-entry post).
 *
 * WHY THIS EXISTS — the auditor's Round 9 found four independent cache-freshness
 * gaps that all have the same shape: a mutation succeeds, the ledger +
 * dashboard refresh, but the party profile / parties list / product caches are
 * left stale for up to 2 minutes (the global staleTime). Concrete user impact:
 *
 *   R9-6  Sell on credit → open the party within 2 min → balance is the
 *         pre-sale number. Second independent route to the bug the user
 *         originally reported.
 *   R9-7  Sell 10 bags of Atta → start the next sale → the picker still
 *         shows pre-sale stock for up to 2 minutes. At a counter doing
 *         rapid sales this is the normal case, not an edge case.
 *   R9-8  Recurring rent/salary posts → nothing on screen changes until
 *         the 2-minute staleTime lapses.
 *   R9-10 Edit a sale's amount → party balance + product stock stay stale.
 *
 * All four are closed by routing every money mutation's success path through
 * this single helper. The `['products']` and `['party-profile']` invalidations
 * use prefix matching (no id) so they cover all variants (`for-entry`,
 * `for-picker`, `for-edit`, `search`, `['party-profile', selectedPartyId]`).
 *
 * Usage:
 *   const queryClient = useQueryClient()
 *   await invalidateMoneyCaches(queryClient)
 *   triggerRefresh()  // still call this for the refreshKey-keyed queries
 */
import type { QueryClient } from '@tanstack/react-query'

export async function invalidateMoneyCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['transactions'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    // Prefix match — covers ['parties'], ['parties','for-entry'], ['parties','search'], etc.
    queryClient.invalidateQueries({ queryKey: ['parties'] }),
    // Prefix match — covers ['party-profile', selectedPartyId] for every party.
    queryClient.invalidateQueries({ queryKey: ['party-profile'] }),
    // Prefix match — covers ['products','for-entry'], ['products','for-picker'],
    // ['products','for-edit'], ['products','search'], ['products', refreshKey].
    queryClient.invalidateQueries({ queryKey: ['products'] }),
    // Insights + analytics depend on transaction aggregates.
    queryClient.invalidateQueries({ queryKey: ['insights'] }),
    queryClient.invalidateQueries({ queryKey: ['analytics'] }),
    // Round-off toggle / stock-policy / hide-profit changes affect the next
    // sale's preview, so include the setting cache too.
    queryClient.invalidateQueries({ queryKey: ['setting'] }),
  ])
}
