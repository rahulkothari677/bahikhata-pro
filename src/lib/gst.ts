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
): Promise<{ isInterState: boolean; party: any | null }> {
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

  return { isInterState, party }
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

const STATE_NAME_TO_CODE: Record<string, string> = {
  'andaman and nicobar islands': '35',
  'andhra pradesh': '37',
  'arunachal pradesh': '12',
  'assam': '18',
  'bihar': '10',
  'chandigarh': '04',
  'chhattisgarh': '22',
  'dadra and nagar haveli and daman and diu': '26',
  'delhi': '07',
  'goa': '30',
  'gujarat': '24',
  'haryana': '06',
  'himachal pradesh': '02',
  'jammu and kashmir': '01',
  'jharkhand': '20',
  'karnataka': '29',
  'kerala': '32',
  'ladakh': '38',
  'lakshadweep': '31',
  'madhya pradesh': '23',
  'maharashtra': '27',
  'manipur': '14',
  'meghalaya': '17',
  'mizoram': '15',
  'nagaland': '13',
  'odisha': '21',
  'puducherry': '34',
  'punjab': '03',
  'rajasthan': '08',
  'sikkim': '11',
  'tamil nadu': '33',
  'telangana': '36',
  'tripura': '16',
  'uttar pradesh': '09',
  'uttarakhand': '05',
  'west bengal': '19',
}

/**
 * Convert a state name (e.g. "Maharashtra", "Gujarat") to a 2-digit GST state code.
 * Case-insensitive. Returns null if the state name is not recognized.
 */
export function stateNameToCode(stateName: string | null | undefined): string | null {
  if (!stateName) return null
  const normalized = stateName.trim().toLowerCase()
  return STATE_NAME_TO_CODE[normalized] || null
}

/**
 * Derive the 2-digit state code (POS — place of supply) for a transaction.
 *
 * Priority:
 *   1. If the party has a GSTIN, use its first 2 digits (most reliable).
 *   2. If the party has a state, convert the state name to a code.
 *   3. If no party (walk-in), use the shop's own GSTIN first 2 digits.
 *   4. If the shop has no GSTIN, use the shop's state name → code.
 *   5. If nothing works, return null (the UI should warn about missing POS).
 *
 * @param partyGstin - the party's GSTIN (15-char alphanumeric)
 * @param partyState - the party's state name
 * @param shopGstin - the shop's own GSTIN
 * @param shopState - the shop's state name
 * @returns 2-digit state code string, or null if not derivable
 */
export function deriveStateCode(
  partyGstin: string | null | undefined,
  partyState: string | null | undefined,
  shopGstin: string | null | undefined,
  shopState: string | null | undefined,
): string | null {
  // 1. Party GSTIN → first 2 digits
  if (partyGstin && partyGstin.length >= 2 && /^\d{2}/.test(partyGstin)) {
    return partyGstin.slice(0, 2)
  }
  // 2. Party state name → code
  const partyCode = stateNameToCode(partyState)
  if (partyCode) return partyCode
  // 3. Shop GSTIN → first 2 digits (for walk-in / unregistered customers)
  if (shopGstin && shopGstin.length >= 2 && /^\d{2}/.test(shopGstin)) {
    return shopGstin.slice(0, 2)
  }
  // 4. Shop state name → code
  const shopCode = stateNameToCode(shopState)
  if (shopCode) return shopCode
  // 5. Nothing worked
  return null
}
