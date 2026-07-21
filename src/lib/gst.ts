import { db } from '@/lib/db'

/**
 * 🔒 AUDIT FIX H3 (v2 audit): Shared GST inter-state derivation helper.
 *
 * Extracted from transactions/route.ts (POST) so both POST and PUT use the
 * EXACT same logic. Was: POST derived isInterState server-side (correct),
 * but PUT trusted the client-supplied flag (wrong — user could flip
 * CGST/SGST ↔ IGST on edit → wrong GST return).
 *
 * 🔒 V10 §3.7: Removed the in-memory shopStateCache.
 * The V3-era cache (5 min TTL) was per-instance — on serverless, a state
 * change in instance A didn't invalidate instance B's cache, so a sale
 * routed to B right after a state change got the WRONG intra/inter-state
 * split (CGST/SGST vs IGST) for up to 5 minutes. That's a GST correctness
 * bug, exactly the kind of thing this app cannot have.
 *
 * The query we'd be caching is a primary-key lookup on Setting (userId),
 * which is O(1) and ~1-2ms on Neon's free tier — there's nothing to gain
 * from caching it. Removed the cache entirely; correctness > a 2ms saving
 * on an already-fast operation.
 *
 * Rules:
 * - If no party is selected (walk-in customer), default to intra-state
 *   (CGST+SGST) — the shop's own state.
 * - If the party has no state set, default to intra-state (safest assumption).
 * - If both states are set and DIFFERENT → inter-state (IGST).
 * - If both states are set and SAME → intra-state (CGST+SGST).
 * - The client-supplied isInterState is IGNORED (the server is the source of truth).
 *
 * @param userId - the shop owner's user ID (for fetching Setting.state)
 * @param partyId - the party's ID (optional — null for walk-in customers)
 * @returns { isInterState, party } — the derived flag + the party object (for reuse)
 */

// 🔒 V10 §3.7: No cache. The previous `invalidateShopStateCache()` export is
// kept as a no-op so existing callers (Settings page) don't break — but it
// no longer needs to be called because there's nothing to invalidate.
export function invalidateShopStateCache(_userId: string): void {
  // No-op — see comment above. The query is direct now.
}

export async function deriveInterStateStatus(
  userId: string,
  partyId?: string | null,
): Promise<{ isInterState: boolean; party: any | null; indeterminate: boolean }> {
  let party: any = null

  if (partyId) {
    party = await db.party.findFirst({ where: { id: partyId, userId } })
    // If party not found, treat as walk-in (intra-state default)
  }

  // 🔒 V10 §3.7: Direct primary-key lookup, no cache. ~1-2ms on Neon.
  // Caching introduced a GST correctness bug on serverless (stale state on
  // other warm instances for up to 5 min after a state change).
  const shopSetting = await db.setting.findUnique({
    where: { userId },
    select: { state: true },
  })
  const shopState = shopSetting?.state?.trim() || null
  const partyState = party?.state?.trim() || null

  // Inter-state ONLY if both states are known and differ
  const isInterState = !!(shopState && partyState && shopState.toLowerCase() !== partyState.toLowerCase())

  // 🔒 V26 Phase 8 R10-1: Return whether the derivation is indeterminate
  // (either state is missing). When indeterminate, the caller should honor
  // the client-supplied isInterState value — it's the only information available.
  // When determinate (both states known), the server's derivation is authoritative
  // and the client's value is ignored (prevents tax-head tampering).
  const indeterminate = !shopState || !partyState

  return { isInterState, party, indeterminate }
}

// ─── State name ↔ code mapping (for GSTR-1 POS field) ─────────────────────
//
// 🔒 V17 Audit Phase 3 (GSTR-1): The GST portal requires `pos` (place of
// supply) as a 2-digit numeric state code. Our schema stores state as a
// free-form string (e.g. "Maharashtra", "Gujarat"). These helpers convert
// between the two.
//
// For parties with a GSTIN, the state code is the first 2 digits of the GSTIN
// (e.g. "27" for Maharashtra). For parties without a GSTIN (B2C), we derive
// the code from the state name.

// 🔒 AUDIT V24 follow-up: stateNameToCode/deriveStateCode moved to the PURE
// module gst-states.ts (no db import) so gstr1-builder.ts stays pure and its
// tests run without DATABASE_URL. Re-exported here so all existing call sites
// (`import { deriveStateCode } from '@/lib/gst'`) keep working unchanged.
export { stateNameToCode, deriveStateCode } from './gst-states'
