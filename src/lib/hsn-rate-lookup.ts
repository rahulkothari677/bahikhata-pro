/**
 * "I typed an HSN — what GST rate applies?"
 *
 * WHY THIS EXISTS. The CA reviewed our GST handling and found a real defect:
 * we treated any 0%-rated line with no declared treatment as **nil-rated**.
 * His words were *"it is wrong treatment"*. Nil-rated, exempt and non-GST are
 * three different things decided by WHAT the item is, not by its rate landing
 * on zero — and they go in different boxes of GSTR-1 Table 8 and GSTR-3B
 * 3.1(c)/(e). Guessing there produces two returns that are wrong in a way
 * that agrees with itself, which our own reconciliation would call "fine".
 *
 * He then asked for this: the shopkeeper types an HSN and the app works out
 * the rate from the actual notification. This is that.
 *
 * IT SUGGESTS. IT DOES NOT DECIDE.
 *
 * An HSN code very often does not settle the rate on its own. Straight from
 * the notification:
 *
 *   0202 … 0210 — All goods, **other than fresh or chilled, pre-packaged and
 *   labelled** — 5%
 *
 * The same code behaves differently sold loose than sold packed. Others turn
 * on composition ("70% or more by weight") or on a declared retail sale price.
 * So every answer carries its conditions and its source, and the shopkeeper
 * confirms. That is the app's existing rule — **refusing beats guessing** —
 * applied to tax rates: a wrong rate nobody notices never gets corrected, and
 * it flows straight into both returns.
 *
 * WHAT IT CANNOT DO YET. The exemption notification (10/2025-Central Tax
 * (Rate)) has not been supplied, so a code absent from the rate schedules is
 * reported as `unknown` — NOT as exempt and NOT as 0%. Plain milk (0401) is
 * the clearest case: it is missing here precisely because it is exempt, and
 * answering "0%" would be right by accident and wrong in principle, because
 * exempt and nil-rated are different boxes on the return.
 *
 * @see scripts/gst-reference/parse-goods-rates.mjs — how the table is built
 * @see src/lib/gst-rates.ts — the slabs a shopkeeper may PICK (a different list)
 */
import table from '@/lib/data/gst-goods-rates.json'

export interface RateRule {
  gstRate: number
  description: string
  schedule: string | null
  conditions: string[]
  /** Sub-codes this row explicitly carves out ("0910 [other than 0910 11 10]"). */
  excludes?: string[]
}

/**
 * Changes made AFTER the base notification this table was built from.
 *
 * WHY THIS EXISTS — I shipped the bug it fixes. The table is parsed from
 * Notification 09/2025, whose own title is "rates on goods **as on
 * 22.09.2025**". Tobacco then moved to 40% on 1 February 2026. So for eleven
 * months the table has been answering 28% for cigarettes, confidently, with a
 * schedule reference attached to make it look authoritative.
 *
 * I found it by checking a claim in the CA's review against the very PDF he
 * supplied — he said 28% was gone, his own file said otherwise, and chasing
 * why exposed that both of us were reading a snapshot as if it were current.
 *
 * WHY THIS DOES NOT SIMPLY STATE 40%. I have verified that Notification
 * 19/2025-CT(R) dated 31.12.2025 moved these goods to 40% from 01.02.2026,
 * from two independent sources — but I do not hold that notification, and it
 * does not move them uniformly: **bidi stayed at 18%** while the rest of
 * heading 2403 went to 40%. Encoding "2403 → 40%" would therefore be a new
 * wrong answer replacing the old one, on a sub-code I cannot pin.
 *
 * So the table declares the change and refuses. "This rate changed on 1 Feb
 * 2026 and I do not have the new figure" is useful. "28%" is a lie with a
 * citation attached.
 */
export interface RateAmendment {
  /** Code prefixes affected. A 4-digit heading covers its sub-codes. */
  prefixes: string[]
  notification: string
  effectiveFrom: string
  note: string
}

export const RATE_AMENDMENTS: RateAmendment[] = [
  {
    prefixes: ['2401', '2402', '2403', '2404', '21069020'],
    notification: '19/2025-Central Tax (Rate), dated 31.12.2025',
    effectiveFrom: '2026-02-01',
    note:
      'Pan masala, gutkha, cigarettes and other tobacco moved to 40%. Bidi stayed at 18%, so the heading did not move as one — check the item before accepting any rate.',
  },
]

/** The amendment affecting this code, if one lands after the table's date. */
export function amendmentFor(hsn: string, asOn: Date = new Date()): RateAmendment | null {
  for (const a of RATE_AMENDMENTS) {
    if (new Date(a.effectiveFrom) > asOn) continue          // not in force yet
    if (a.effectiveFrom <= table.source.ratesAsOn) continue  // already in the base
    if (a.prefixes.some(p => hsn.startsWith(p) || p.startsWith(hsn))) return a
  }
  return null
}

export type LookupOutcome =
  /** Exactly one rule, no conditions — the closest thing to a definite answer. */
  | 'single'
  /** One or more rules, but at least one carries a condition. Must be confirmed. */
  | 'needs-confirmation'
  /** Several rules with different rates. The shopkeeper must choose. */
  | 'ambiguous'
  /** Not in the rate schedules. May be exempt — we cannot tell yet. */
  | 'unknown'
  /** The base notification's rate for this code was changed after it. */
  | 'superseded'

export interface HsnLookupResult {
  hsn: string
  outcome: LookupOutcome
  /** The code actually matched, which may be shorter than what was typed. */
  matchedOn: string | null
  rules: RateRule[]
  /** Only set when a single unconditional rule applies. */
  suggestedRate: number | null
  /** Plain-language sentence for the screen. Never a bare number. */
  message: string
  source: { notification: string; ratesAsOn: string }
  /** Set when a later notification changed this code's rate. */
  supersededBy?: RateAmendment
}

const CODES = table.codes as Record<string, RateRule[]>
const SOURCE = { notification: table.source.notification, ratesAsOn: table.source.ratesAsOn }

/** Digits only. A shopkeeper may type "0910 30" or "0910-30". */
export function normaliseHsn(input: string): string {
  return (input || '').replace(/\D/g, '')
}

/**
 * Human wording for a condition code.
 *
 * These are questions, not statements, because the shopkeeper is the only one
 * who knows how they sell the thing.
 */
export const CONDITION_TEXT: Record<string, string> = {
  'pre-packaged-and-labelled':
    'This rate applies only if the item is pre-packaged and labelled. Sold loose, it may be exempt.',
  'not-fresh-or-chilled':
    'This rate excludes fresh or chilled goods — those are treated differently.',
  'composition-by-weight':
    'This rate depends on what the item is made of, by weight. Check the description.',
  'declared-retail-sale-price':
    'This rate depends on a declared retail sale price.',
  'has-exclusion':
    'This entry excludes some goods. Read the description before accepting it.',
}

/**
 * Find the rate rules for an HSN, most specific first.
 *
 * The notification writes codes at four lengths — 8-digit tariff items,
 * 6-digit sub-headings, 4-digit headings and 2-digit chapters. A shopkeeper
 * typing 8 digits should get the 8-digit row if one exists, and fall back to
 * the heading otherwise. Falling back the other way — answering a 4-digit rule
 * when an 8-digit one exists — would apply a general rate to a good the
 * statute treats specifically.
 */
export function lookupHsn(input: string): HsnLookupResult {
  const hsn = normaliseHsn(input)
  const base = { hsn, source: SOURCE }

  if (hsn.length < 2) {
    return {
      ...base, outcome: 'unknown', matchedOn: null, rules: [], suggestedRate: null,
      message: 'Enter at least 2 digits of the HSN code.',
    }
  }

  /*
   * A superseded code is answered before anything else. The base table still
   * holds a rate for it and would happily return that rate with a schedule
   * reference — which is precisely how it spent eleven months telling people
   * cigarettes were 28%.
   */
  const amended = amendmentFor(hsn)
  if (amended) {
    return {
      ...base, outcome: 'superseded', matchedOn: null, rules: [], suggestedRate: null,
      supersededBy: amended,
      message: `This rate changed on ${new Date(amended.effectiveFrom).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} (${amended.notification}). ${amended.note} Set the rate yourself — our table predates the change.`,
    }
  }

  for (let len = Math.min(hsn.length, 8); len >= 2; len--) {
    const key = hsn.slice(0, len)
    const rules = CODES[key]
    if (!rules || !rules.length) continue

    // A row that explicitly carves this code out must not answer for it.
    const applicable = rules.filter(r => !r.excludes?.some(x => hsn.startsWith(x) || x.startsWith(hsn)))
    if (!applicable.length) {
      return {
        ...base, outcome: 'unknown', matchedOn: key, rules,
        suggestedRate: null,
        message: `HSN ${key} has a rate, but this notification specifically excludes ${hsn}. Check the exemption list or ask your CA.`,
      }
    }

    const rates = [...new Set(applicable.map(r => r.gstRate))]
    const conditioned = applicable.some(r => r.conditions.length > 0)

    if (rates.length > 1) {
      return {
        ...base, outcome: 'ambiguous', matchedOn: key, rules: applicable, suggestedRate: null,
        message: `HSN ${key} has ${rates.length} different rates (${rates.map(r => r + '%').join(', ')}) depending on the goods. Pick the one that matches what you sell.`,
      }
    }

    if (conditioned) {
      return {
        ...base, outcome: 'needs-confirmation', matchedOn: key, rules: applicable,
        suggestedRate: rates[0],
        message: `HSN ${key} is ${rates[0]}% — but only under a condition. Check it before accepting.`,
      }
    }

    return {
      ...base, outcome: 'single', matchedOn: key, rules: applicable, suggestedRate: rates[0],
      message: `HSN ${key} is ${rates[0]}% GST.`,
    }
  }

  return {
    ...base, outcome: 'unknown', matchedOn: null, rules: [], suggestedRate: null,
    /*
     * Deliberately NOT "0%" and NOT "exempt". A code absent from the rate
     * schedules is very often exempt — but the exemption notification is not
     * loaded yet, and exempt, nil-rated and non-GST go in three different
     * boxes of the return. Saying "we don't know" is the honest answer and
     * the one that keeps the return correct.
     */
    message: `HSN ${hsn} is not in the rate schedules. It may be exempt or nil-rated — we cannot tell yet, so please set the treatment yourself.`,
  }
}

/** Everything the table knows, for tests and a future CA-facing screen. */
export const RATE_TABLE_META = {
  notification: table.source.notification,
  ratesAsOn: table.source.ratesAsOn,
  ruleCount: table.ruleCount,
  codeCount: table.codeCount,
}
