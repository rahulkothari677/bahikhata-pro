/**
 * 🔒 AUDIT V24 follow-up: PURE GST state-code helpers, extracted from gst.ts.
 *
 * WHY THIS FILE EXISTS: gst.ts imports the Prisma client (for
 * deriveInterStateStatus), so anything importing it drags a live DB client
 * into module scope. gstr1-builder.ts is documented (and tested) as a
 * pure-function module — importing deriveStateCode from gst.ts broke that
 * purity and made the builder's tests require DATABASE_URL. These helpers
 * have zero dependencies beyond being pure functions.
 *
 * gst.ts re-exports both, so every existing `import { deriveStateCode } from
 * '@/lib/gst'` call site keeps working unchanged.
 */

// GST state codes — the first 2 digits of a GSTIN identify the state.
// For parties without a GSTIN (B2C), we derive the code from the state name.
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
