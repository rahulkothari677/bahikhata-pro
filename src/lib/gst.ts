import { db } from '@/lib/db'

/**
 * 🔒 AUDIT FIX H3 (v2 audit): Shared GST inter-state derivation helper.
 *
 * Extracted from transactions/route.ts (POST) so both POST and PUT use the
 * EXACT same logic. Was: POST derived isInterState server-side (correct),
 * but PUT trusted the client-supplied flag (wrong — user could flip
 * CGST/SGST ↔ IGST on edit → wrong GST return).
 *
 * 🔒 AUDIT FIX N10 (v3): Cache the shop's state to cut 1 query per write.
 * The shop state rarely changes (maybe once during setup). Cache it for
 * 5 minutes per user. This saves a DB query on every transaction write.
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

// 🔒 N10: Cache shop state per user (5 min TTL)
const shopStateCache = new Map<string, { state: string | null; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * 🔒 V8 M1: Invalidate the shop-state cache for a user.
 * Call this when the user changes their shop state in Settings.
 * Without this, sales created in the next 5 minutes would use the OLD
 * state → wrong intra/inter-state GST split (CGST/SGST vs IGST).
 */
export function invalidateShopStateCache(userId: string): void {
  shopStateCache.delete(userId)
}

async function getCachedShopState(userId: string): Promise<string | null> {
  const cached = shopStateCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.state
  }
  const shopSetting = await db.setting.findUnique({
    where: { userId },
    select: { state: true },
  })
  const state = shopSetting?.state?.trim() || null
  shopStateCache.set(userId, { state, expiresAt: Date.now() + CACHE_TTL })
  return state
}

export async function deriveInterStateStatus(
  userId: string,
  partyId?: string | null,
): Promise<{ isInterState: boolean; party: any | null }> {
  let party: any = null

  if (partyId) {
    party = await db.party.findFirst({ where: { id: partyId, userId } })
    // If party not found, treat as walk-in (intra-state default)
  }

  // 🔒 N10: Use cached shop state (5 min TTL) instead of querying every time
  const shopState = await getCachedShopState(userId)
  const partyState = party?.state?.trim() || null

  // Inter-state ONLY if both states are known and differ
  const isInterState = !!(shopState && partyState && shopState.toLowerCase() !== partyState.toLowerCase())

  return { isInterState, party }
}
