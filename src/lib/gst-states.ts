/**
 * The ONE place a state is decided. (Phase 2, #118 / #143, 2 Oct 2026)
 *
 * WHY. The bill's tax head and GSTR-1's place of supply were decided by two
 * different rules: the bill compared raw typed state names ("UP" ≠ "Uttar
 * Pradesh" → IGST on a sale inside UP; seen live: Rajasthan → Rajasthan
 * charged IGST because the party's state was typed "RJ"), while GSTR-1 used
 * the GSTIN prefix. And three callers passed the old four-string
 * deriveStateCode() arguments in the wrong order. Now every caller resolves
 * state CODES through these functions, with named fields.
 *
 * THE LAW (Downloads\reports\GST law verified September 2026.md, "Place of
 * supply"): same State/UT → CGST + SGST, different → IGST (IGST Act s.7(1),
 * 8(1)). Goods: where the movement ends for delivery (s.10(1)(a)); a sale to
 * an unregistered buyer: the address recorded on the invoice — the State name
 * alone counts — or the supplier's own location if none is recorded
 * (s.10(1)(ca), Notification 02/2023-IT; Circular 209/3/2024-GST: the
 * delivery address governs when it differs from billing).
 *
 * STATE CODES in current use: 01–24, 26, 27, 29–38, and 97 "Other Territory".
 * 25 (old Daman and Diu) and 28 (undivided Andhra Pradesh) are past-record
 * codes and are not accepted for new entries.
 */

export interface IndianState {
  code: string
  name: string
  /** Lower-case short forms people actually type (vehicle-plate codes, old names). */
  aliases: string[]
}

export const INDIAN_STATES: ReadonlyArray<IndianState> = [
  { code: '01', name: 'Jammu and Kashmir', aliases: ['jk', 'j and k', 'jammu kashmir'] },
  { code: '02', name: 'Himachal Pradesh', aliases: ['hp'] },
  { code: '03', name: 'Punjab', aliases: ['pb'] },
  { code: '04', name: 'Chandigarh', aliases: ['ch'] },
  { code: '05', name: 'Uttarakhand', aliases: ['uk', 'uttaranchal'] },
  { code: '06', name: 'Haryana', aliases: ['hr'] },
  { code: '07', name: 'Delhi', aliases: ['dl', 'new delhi', 'nct of delhi', 'national capital territory of delhi'] },
  { code: '08', name: 'Rajasthan', aliases: ['rj', 'raj'] },
  { code: '09', name: 'Uttar Pradesh', aliases: ['up'] },
  { code: '10', name: 'Bihar', aliases: ['br'] },
  { code: '11', name: 'Sikkim', aliases: ['sk'] },
  { code: '12', name: 'Arunachal Pradesh', aliases: ['ar'] },
  { code: '13', name: 'Nagaland', aliases: ['nl'] },
  { code: '14', name: 'Manipur', aliases: ['mn'] },
  { code: '15', name: 'Mizoram', aliases: ['mz'] },
  { code: '16', name: 'Tripura', aliases: ['tr'] },
  { code: '17', name: 'Meghalaya', aliases: ['ml'] },
  { code: '18', name: 'Assam', aliases: ['as'] },
  { code: '19', name: 'West Bengal', aliases: ['wb'] },
  { code: '20', name: 'Jharkhand', aliases: ['jh'] },
  { code: '21', name: 'Odisha', aliases: ['od', 'or', 'orissa'] },
  { code: '22', name: 'Chhattisgarh', aliases: ['cg', 'ct', 'chattisgarh', 'chhatisgarh'] },
  { code: '23', name: 'Madhya Pradesh', aliases: ['mp'] },
  { code: '24', name: 'Gujarat', aliases: ['gj'] },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', aliases: ['dn', 'dd', 'dnh', 'dnhdd', 'dadra and nagar haveli', 'daman and diu'] },
  { code: '27', name: 'Maharashtra', aliases: ['mh'] },
  { code: '29', name: 'Karnataka', aliases: ['ka'] },
  { code: '30', name: 'Goa', aliases: ['ga'] },
  { code: '31', name: 'Lakshadweep', aliases: ['ld'] },
  { code: '32', name: 'Kerala', aliases: ['kl'] },
  { code: '33', name: 'Tamil Nadu', aliases: ['tn'] },
  { code: '34', name: 'Puducherry', aliases: ['py', 'pondicherry'] },
  { code: '35', name: 'Andaman and Nicobar Islands', aliases: ['an', 'andaman and nicobar', 'andaman'] },
  { code: '36', name: 'Telangana', aliases: ['ts', 'tg'] },
  { code: '37', name: 'Andhra Pradesh', aliases: ['ap'] },
  { code: '38', name: 'Ladakh', aliases: ['la'] },
  { code: '97', name: 'Other Territory', aliases: [] },
]

const CODE_SET = new Set(INDIAN_STATES.map(s => s.code))
const LOOKUP = new Map<string, string>()
const normalise = (x: string) =>
  x.toLowerCase().replace(/&/g, ' and ').replace(/\./g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
for (const s of INDIAN_STATES) {
  LOOKUP.set(normalise(s.name), s.code)
  for (const a of s.aliases) LOOKUP.set(normalise(a), s.code)
}

/** "09", "9", "Uttar Pradesh", "U.P.", "up" → "09". Null when it cannot be told. */
export function resolveStateCode(input: string | null | undefined): string | null {
  if (!input) return null
  const raw = String(input).trim()
  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, '0')
    return CODE_SET.has(code) ? code : null
  }
  return LOOKUP.get(normalise(raw)) ?? null
}

/** The official name for a code ("09" → "Uttar Pradesh"), or null. */
export function stateNameForCode(code: string | null | undefined): string | null {
  return INDIAN_STATES.find(s => s.code === code)?.name ?? null
}

/** The state code in a GSTIN's first two digits, when it is a real, current code. */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  const m = /^(\d{2})/.exec(String(gstin || '').trim())
  return m && CODE_SET.has(m[1]) ? m[1] : null
}

/** A shop or party as far as its state is concerned. */
export interface StatePlace {
  gstin?: string | null
  state?: string | null
}

/**
 * The state code of a shop or party: its GSTIN prefix when it has a valid
 * GSTIN (registration is the stored fact), otherwise its recorded state.
 */
export function stateCodeOf(place: StatePlace | null | undefined): string | null {
  if (!place) return null
  return gstinStateCode(place.gstin) ?? resolveStateCode(place.state)
}

/**
 * Where the supply is — the 2-digit place-of-supply code.
 *
 *   1. a delivery state, when the goods go somewhere else (Phase 2c, #114)
 *   2. the buyer's GSTIN state / recorded state
 *   3. otherwise the shop's own state (s.10(1)(ca): no address recorded →
 *      the supplier's location; a counter sale is at the shop)
 */
export function placeOfSupplyCode(args: {
  shop: StatePlace | null | undefined
  party?: StatePlace | null
  delivery?: string | null
}): string | null {
  return resolveStateCode(args.delivery) ?? stateCodeOf(args.party) ?? stateCodeOf(args.shop)
}

/**
 * Is this supply inter-state? The ONE rule the bill screen, the server and
 * every return use. `indeterminate` only when the shop's own state is not
 * known — then the app cannot tell and asks.
 */
export function supplyKind(args: {
  shop: StatePlace | null | undefined
  party?: StatePlace | null
  delivery?: string | null
}): { isInterState: boolean; indeterminate: boolean; shopCode: string | null; posCode: string | null } {
  const shopCode = stateCodeOf(args.shop)
  const posCode = placeOfSupplyCode(args)
  return {
    isInterState: !!(shopCode && posCode && shopCode !== posCode),
    indeterminate: !shopCode,
    shopCode,
    posCode,
  }
}

// ── Older entry points, kept so existing imports keep working ──────────────

/** @deprecated Use resolveStateCode(). */
export function stateNameToCode(stateName: string | null | undefined): string | null {
  return resolveStateCode(stateName)
}

/**
 * @deprecated Positional strings are how three callers came to pass them in
 * the wrong order. Use placeOfSupplyCode({ shop, party }).
 */
export function deriveStateCode(
  partyGstin: string | null | undefined,
  partyState: string | null | undefined,
  shopGstin: string | null | undefined,
  shopState: string | null | undefined,
): string | null {
  return placeOfSupplyCode({ party: { gstin: partyGstin, state: partyState }, shop: { gstin: shopGstin, state: shopState } })
}

/**
 * @deprecated Use supplyKind({ shop, party }) — it also reads GSTINs. Kept
 * for older imports; follows the same rule (a buyer with no recorded state is
 * at the shop's own state, s.10(1)(ca)).
 */
export function deriveInterStateFromStates(
  shopState?: string | null,
  partyState?: string | null,
): { isInterState: boolean; indeterminate: boolean } {
  const k = supplyKind({ shop: { state: shopState }, party: { state: partyState } })
  return { isInterState: k.isInterState, indeterminate: k.indeterminate }
}

// ── GSTIN (Phase 2b, #143) ─────────────────────────────────────────────────

/**
 * The GSTIN format: 2-digit state code, 10-character PAN, entity number,
 * the letter Z, and a check character. The ONE copy — it used to live in
 * both lib/utils.ts and the settings route.
 */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The 15th (check) character GSTN computes from the first 14 (mod-36 Luhn). */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i])
    if (v < 0) return null
    const p = v * ((i % 2) + 1)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]
}

/**
 * Is this a usable GSTIN, and which state is it from? Plain-words reasons, so
 * a form can say what to fix. A wrong check character is reported but is a
 * warning for the caller to show — old records can carry one.
 */
export function checkGstin(input: string | null | undefined): {
  ok: boolean
  reason: string | null
  stateCode: string | null
  checksumOk: boolean
} {
  const g = String(input || '').trim().toUpperCase()
  if (!g) return { ok: false, reason: null, stateCode: null, checksumOk: false }
  if (g.length !== 15) return { ok: false, reason: `A GSTIN has 15 characters — this has ${g.length}.`, stateCode: null, checksumOk: false }
  if (!GSTIN_PATTERN.test(g)) return { ok: false, reason: 'This is not in the GSTIN format — check for a typo.', stateCode: null, checksumOk: false }
  const stateCode = gstinStateCode(g)
  if (!stateCode) return { ok: false, reason: `"${g.slice(0, 2)}" is not a state code in use.`, stateCode: null, checksumOk: false }
  const checksumOk = gstinCheckChar(g.slice(0, 14)) === g[14]
  return {
    ok: true,
    reason: checksumOk ? null : 'The last character does not match — check for a typo.',
    stateCode,
    checksumOk,
  }
}
