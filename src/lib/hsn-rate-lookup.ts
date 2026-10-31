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
import { istDateString } from '@/lib/timezone'

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
 * does not move them uniformly: **bidi dropped from 28% to 18%** while the rest of
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
  /**
   * The rows in force from `effectiveFrom`, when the amending notification's own
   * text has been read and the new rows are known. Without them the change is
   * declared and the lookup refuses (as for tobacco); with them it answers.
   */
  rules?: RateRule[]
  /** The code left the rate schedules for the exemption list (exempt-goods-lookup.ts). */
  exempt?: boolean
}

export const RATE_AMENDMENTS: RateAmendment[] = [
  {
    prefixes: ['2401', '2402', '2403', '2404', '21069020'],
    notification: '19/2025-Central Tax (Rate), dated 31.12.2025',
    effectiveFrom: '2026-02-01',
    note:
      'Pan masala, gutkha, cigarettes and other tobacco moved to 40%. Bidi went the other way, down to 18%, so the heading did not move as one — check the item before accepting any rate.',
  },
  {
    // Read from the Gazette (CG-DL-E-27102026-277454): Sch. I S.No. 272A inserted, Sch. II S.No. 138 narrowed.
    prefixes: ['4012'],
    notification: '02/2026-Central Tax (Rate), dated 27.10.2026 (G.S.R. 921(E))',
    effectiveFrom: '2026-11-01',
    note: 'Retreaded tractor tyres moved to 5%; other retreaded or used tyres stay 18%.',
    rules: [
      { gstRate: 5, description: 'Retreaded tractor tyres', schedule: 'I', conditions: [] },
      {
        gstRate: 18,
        description: 'Retreaded or used pneumatic tyres of rubber (other than retreaded tractor tyres); solid or cushion tyres, tyre treads and tyre flaps, of rubber',
        schedule: 'II',
        conditions: [],
      },
    ],
  },
  {
    // Same notification, Sch. I S.No. 237 substituted: the rate stays 5%; the entry now names
    // sea-weed bio-stimulants. Carried so a 3101 answer from 1 Nov quotes the words in force.
    prefixes: ['3101'],
    notification: '02/2026-Central Tax (Rate), dated 27.10.2026 (G.S.R. 921(E))',
    effectiveFrom: '2026-11-01',
    note: 'Fertiliser entry reworded: rate unchanged at 5%; sea-weed extract bio-stimulants are now named in it.',
    rules: [
      {
        gstRate: 5,
        description: 'All goods i.e. animal or vegetable fertilisers or organic fertilisers pre-packaged and labelled. Explanation: this entry includes sea-weed extract based bio-stimulants, as registered under Schedule VI to the Fertiliser (Inorganic, Organic or Mixed) (Control) Order, 1985',
        schedule: 'I',
        conditions: ['pre-packaged-and-labelled'],
      },
    ],
  },
  {
    // Read from the Gazette (CG-DL-E-27102026-277454): exemption 10/2025-CT(R) S.No. 87A inserted.
    prefixes: ['12119013'],
    notification: '03/2026-Central Tax (Rate), dated 27.10.2026 (G.S.R. 924(E))',
    effectiveFrom: '2026-11-01',
    note: 'Psyllium seeds (isabgol) are exempt — no GST, reported as exempt, not nil-rated.',
    exempt: true,
  },
]

/**
 * The amendment affecting this code on this date (IST day), if one lands after the
 * table's date. A refusal-only amendment also covers a SHORTER typed code inside its
 * heading ("24" for tobacco); one that carries rows answers only for a code within it.
 */
export function amendmentFor(hsn: string, asOn: Date = new Date()): RateAmendment | null {
  const day = istDateString(asOn)
  for (const a of RATE_AMENDMENTS) {
    if (a.effectiveFrom > day) continue                      // not in force yet
    if (a.effectiveFrom <= table.source.ratesAsOn) continue  // already in the base
    const answers = a.rules || a.exempt
    if (a.prefixes.some(p => hsn.startsWith(p) || (!answers && p.startsWith(hsn)))) return a
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
  /** A later notification moved this code to the exemption list. */
  | 'exempt'

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

  /*
   * Added with the exemption table (10/2025). They live HERE, in the one map,
   * because a condition means the same thing whichever notification raised it
   * and a screen should not have to know which table an answer came from.
   * Two maps describing one idea is the mistake that caused four of my bugs.
   */
  'fresh-or-chilled-only':
    'This applies only to the fresh or chilled form. Frozen or processed, it is treated differently.',
  'unprocessed-only':
    'This applies only in the unprocessed form. Processed, it is treated differently.',
  'seller-specific':
    'This depends on WHO sells it — a government treasury, KVIC, or a similar authorised seller. An ordinary shop selling the same item is usually not covered.',
  'listed-in-annexure':
    'This applies only to items named in the notification’s own annexure. The HSN code alone does not decide it.',
  'seed-quality-only':
    'This applies only to goods of seed quality, not the same item sold as food.',
  'chapter-entry':
    'This entry covers one named item in the chapter, not every heading in it. Check your item is exactly that.',
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
export function lookupHsn(input: string, asOn: Date = new Date()): HsnLookupResult {
  const hsn = normaliseHsn(input)
  const base = { hsn, source: SOURCE }
  const onDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  /** One reading of a set of rows, whether from the base table or a dated amendment. */
  const answer = (key: string, rules: RateRule[], from?: RateAmendment): HsnLookupResult => {
    const extra = from ? { supersededBy: from, source: { notification: from.notification, ratesAsOn: from.effectiveFrom } } : {}
    // A row that explicitly carves this code out must not answer for it.
    const applicable = rules.filter(r => !r.excludes?.some(x => hsn.startsWith(x) || x.startsWith(hsn)))
    if (!applicable.length) {
      return {
        ...base, ...extra, outcome: 'unknown', matchedOn: key, rules,
        suggestedRate: null,
        message: `HSN ${key} has a rate, but this notification specifically excludes ${hsn}. Check the exemption list or ask your CA.`,
      }
    }
    const rates = [...new Set(applicable.map(r => r.gstRate))]
    const conditioned = applicable.some(r => r.conditions.length > 0)
    const since = from ? ` (from ${onDate(from.effectiveFrom)}, ${from.notification})` : ''
    if (rates.length > 1) {
      return {
        ...base, ...extra, outcome: 'ambiguous', matchedOn: key, rules: applicable, suggestedRate: null,
        message: `HSN ${key} has ${rates.length} different rates (${rates.map(r => r + '%').join(', ')}) depending on the goods${since}. Pick the one that matches what you sell.`,
      }
    }
    if (conditioned) {
      return {
        ...base, ...extra, outcome: 'needs-confirmation', matchedOn: key, rules: applicable,
        suggestedRate: rates[0],
        message: `HSN ${key} is ${rates[0]}%${since} — but only under a condition. Check it before accepting.`,
      }
    }
    return {
      ...base, ...extra, outcome: 'single', matchedOn: key, rules: applicable, suggestedRate: rates[0],
      message: `HSN ${key} is ${rates[0]}% GST${since}.`,
    }
  }

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
  const amended = amendmentFor(hsn, asOn)
  if (amended?.exempt) {
    const key = amended.prefixes.find(p => hsn.startsWith(p)) ?? hsn
    return {
      ...base, outcome: 'exempt', matchedOn: key, rules: [], suggestedRate: null,
      supersededBy: amended, source: { notification: amended.notification, ratesAsOn: amended.effectiveFrom },
      message: `HSN ${key} is exempt from ${onDate(amended.effectiveFrom)} (${amended.notification}). ${amended.note}`,
    }
  }
  if (amended?.rules) {
    return answer(amended.prefixes.find(p => hsn.startsWith(p)) ?? hsn, amended.rules, amended)
  }
  if (amended) {
    return {
      ...base, outcome: 'superseded', matchedOn: null, rules: [], suggestedRate: null,
      supersededBy: amended,
      message: `This rate changed on ${onDate(amended.effectiveFrom)} (${amended.notification}). ${amended.note} Set the rate yourself — our table predates the change.`,
    }
  }

  for (let len = Math.min(hsn.length, 8); len >= 2; len--) {
    const key = hsn.slice(0, len)
    const rules = CODES[key]
    if (!rules || !rules.length) continue
    const found = answer(key, rules)
    /*
     * #120 (Phase 8b): a chapter row speaks for every heading in the chapter
     * only when the shopkeeper's item is the thing it names — chapter 12's
     * 5% is "all goods other than of seed quality", chapter 64's is footwear
     * up to ₹2,500. Typed 4+ digits that found nothing closer get the rate as
     * a question, with the row's own words, never as a plain answer.
     */
    if (key.length === 2 && hsn.length > 2 && found.outcome === 'single') {
      return {
        ...found, outcome: 'needs-confirmation',
        // The row's own words can run to 900 characters; the screen shows them behind ⓘ.
        message: `No row for ${hsn} itself. Chapter ${key} is ${found.suggestedRate}% only for the goods it names — check them before accepting.`,
      }
    }
    return found
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
