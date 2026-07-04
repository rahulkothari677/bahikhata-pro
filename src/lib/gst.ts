import { db } from '@/lib/db'

/**
 * 🔒 AUDIT FIX H3 (v2 audit): Shared GST inter-state derivation helper.
 *
 * Extracted from transactions/route.ts (POST) so both POST and PUT use the
 * EXACT same logic. Was: POST derived isInterState server-side (correct),
 * but PUT trusted the client-supplied flag (wrong — user could flip
 * CGST/SGST ↔ IGST on edit → wrong GST return).
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
export async function deriveInterStateStatus(
  userId: string,
  partyId?: string | null,
): Promise<{ isInterState: boolean; party: any | null }> {
  let party: any = null

  if (partyId) {
    party = await db.party.findFirst({ where: { id: partyId, userId } })
    // If party not found, treat as walk-in (intra-state default)
  }

  // Fetch the shop's state from settings
  const shopSetting = await db.setting.findUnique({
    where: { userId },
    select: { state: true },
  })

  const shopState = shopSetting?.state?.trim() || null
  const partyState = party?.state?.trim() || null

  // Inter-state ONLY if both states are known and differ
  const isInterState = !!(shopState && partyState && shopState.toLowerCase() !== partyState.toLowerCase())

  return { isInterState, party }
}
