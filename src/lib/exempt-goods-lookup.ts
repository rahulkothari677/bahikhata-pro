/**
 * Is this HSN code exempt from GST — and is the answer conditional?
 *
 * SOURCE. Notification 10/2025-Central Tax (Rate), G.S.R. 660(E), 17 Sep 2025,
 * parsed by scripts/gst-reference/parse-exempt-goods.mjs. That notification is
 * issued **in supersession of 02/2017-CT(R)**.
 *
 * WHY THIS EXISTS. `gst-treatment.ts` carried 21 hand-written exempt HSN
 * prefixes whose comment cited 2/2017 — the superseded notification. The list
 * was careful and conservative and it was checking a shopkeeper's stock
 * against a dead statute. This replaces it with the live one: 172 entries,
 * 182 codes.
 *
 * ─────────────────── THE HALF THAT CANNOT BE ANSWERED ───────────────────
 *
 * 99 of 210 rules are CONDITIONAL — nearly half — and almost always on
 * packaging:
 *
 *     0403  "Curd, Lassi, Butter milk, other than pre-packaged and labelled"
 *     0406  "Chena or paneer, whether or not pre-packaged and labelled"
 *
 * Loose curd is exempt; branded packaged curd is 5%. Paneer is exempt either
 * way. The two lines share almost every word and mean opposite things, and no
 * HSN code can tell them apart — 0403 is 0403 however it is sold.
 *
 * So a conditional match returns 'needs-confirmation' and NEVER 'exempt'.
 * Only the shopkeeper knows how they sell the thing. The old list papered over
 * this with a comment reading "(unbranded)" and leaned on the rate check to
 * catch the rest — and its own file admits where that fails: the rate check
 * protects a correctly priced product with a misleading HSN, and cannot
 * protect a MIS-priced one. A shopkeeper who typed the wrong rate is exactly
 * who most needs the answer to be careful.
 *
 * Getting this wrong is not cosmetic. Exempt and nil-rated go in DIFFERENT
 * boxes of GSTR-1, and the CA's review called our current default of treating
 * every 0% good as nil-rated "wrong treatment".
 */
import table from '@/lib/data/gst-exempt-goods.json'

export interface ExemptRule {
  /** The notification's own words, kept verbatim — never paraphrased. */
  description: string
  conditions: string[]
  /** Serial number in the Schedule, so an answer can cite its row. */
  serial: number
}

export type ExemptOutcome =
  /** Exempt outright — no condition attached to the entry. */
  | 'exempt'
  /** The entry covers this code, but only under a condition. Must be asked. */
  | 'needs-confirmation'
  /** No entry covers this code. NOT the same as "taxable" — see below. */
  | 'not-listed'

export interface ExemptLookupResult {
  hsn: string
  outcome: ExemptOutcome
  /** The code that actually matched, which may be shorter than the input. */
  matchedOn: string | null
  rules: ExemptRule[]
  /** Plain sentence for the screen. */
  message: string
  source: string
}

const CODES = table.codes as Record<string, ExemptRule[]>
const SOURCE = `${table.source.notification} (${table.source.gazette}), ${table.source.dated}`

/**
 * Exemptions the notification does NOT key to any HSN — its code column reads
 * "Any Chapter" or a bare dash.
 *
 * They cannot be looked up, and they are not obscure: RAKHI and PUJA SAMAGRI
 * are ordinary stock in the shops this app is for. Exposed so a screen can
 * offer them as a short checklist, because the alternative is a rakhi at 0%
 * falling to the residual "nil-rated" and landing in the wrong GSTR-1 box.
 */
export const UNKEYED_EXEMPTIONS = table.unkeyed as Array<{
  serial: number
  appliesTo: string
  description: string
  conditions: string[]
}>

/**
 * Look up an HSN, most specific first.
 *
 * The notification writes codes at four lengths — 8-digit tariff items,
 * 6-digit sub-headings, 4-digit headings and 2-digit chapters — so an 8-digit
 * product code is tried at 8, then 6, then 4, then 2. Longest match wins,
 * which is how the tariff itself is read: a specific entry overrides the
 * chapter it sits in.
 *
 * SCALE. This is a plain object lookup against 182 keys, at most four probes,
 * with no scan of the table. It answers in the same time for one product or
 * ten million, and the data is a 40 KB import rather than a query — nothing
 * here gets slower as a shop grows.
 */
export function lookupExemption(hsn: string | null | undefined): ExemptLookupResult {
  const raw = String(hsn ?? '').replace(/\D/g, '')
  const base: Omit<ExemptLookupResult, 'outcome' | 'matchedOn' | 'rules' | 'message'> = {
    hsn: raw,
    source: SOURCE,
  }

  if (!raw || raw.length < 2) {
    return {
      ...base,
      outcome: 'not-listed',
      matchedOn: null,
      rules: [],
      message: 'No HSN code, so exemption cannot be checked.',
    }
  }

  for (const len of [8, 6, 4, 2]) {
    if (raw.length < len) continue
    const key = raw.slice(0, len)
    const rules = CODES[key]
    if (!rules?.length) continue

    /*
     * If ANY matching rule is unconditional, the goods are exempt outright —
     * something on the list with nothing attached to it needs no question.
     * Only when every match carries a condition does this have to ask.
     */
    const unconditional = rules.filter(r => r.conditions.length === 0)
    if (unconditional.length) {
      return {
        ...base,
        outcome: 'exempt',
        matchedOn: key,
        rules: unconditional,
        message: `HSN ${key} is exempt under ${table.source.notification}: ${unconditional[0].description}`,
      }
    }

    return {
      ...base,
      outcome: 'needs-confirmation',
      matchedOn: key,
      rules,
      message: `HSN ${key} can be exempt, but only under a condition: ${rules[0].description}`,
    }
  }

  /*
   * NOT-LISTED IS NOT "TAXABLE".
   *
   * It means this notification does not exempt the code. The goods may still
   * be nil-rated, or outside GST altogether, or simply have a rate — all of
   * which are other tables' questions. Saying "taxable" here would be this
   * file answering something it was not asked, which is how a lookup starts
   * producing wrong returns that look authoritative.
   */
  return {
    ...base,
    outcome: 'not-listed',
    matchedOn: null,
    rules: [],
    message: `HSN ${raw} is not in the exemption list. That does not by itself make it taxable — check its rate.`,
  }
}

/**
 * The QUESTION each condition asks, and what each answer means.
 *
 * ── WHY THIS EXISTS: I SHIPPED THE WRONG QUESTION (29 Aug 2026) ─────────
 *
 * The first version of the item-screen panel asked one hard-coded question —
 * "Is this sold loose, or pre-packaged and labelled?" — for EVERY conditional
 * entry. Only 41 of the 99 conditional rules are about packaging. The rest:
 *
 *     26  fresh-or-chilled-only    potatoes, tomatoes, onions, carrots
 *     13  seller-specific          stamp papers, khadi through KVIC
 *     11  seed-quality-only        the same grain as seed vs as food
 *      2  unprocessed-only         fresh ginger, fresh turmeric
 *      2  listed-in-annexure       drugs named in Annexure I
 *
 * So a shop selling potatoes was asked whether they were pre-packaged, when
 * the notification actually turns on whether they are fresh or chilled. The
 * answer would have set a treatment on a question the law never asked.
 *
 * That is worse than not asking, and I had already written the reason down in
 * the parser: a shopkeeper asked something with no bearing on the answer
 * learns to dismiss the question, including the times it decides a rate. I
 * wrote that warning and then shipped the thing it warns about.
 *
 * ALL conditions on a rule must be satisfied for the exemption to hold —
 * "All goods, other than fresh or chilled, other than pre-packaged and
 * labelled" is two tests, not one — so the screen asks each of them.
 */
export interface ConditionQuestion {
  /** Asked in the shopkeeper's words, about the item in front of them. */
  question: string
  /** The answer that KEEPS the exemption. */
  exemptLabel: string
  /** The answer that loses it. */
  taxableLabel: string
}

export const CONDITION_QUESTION: Record<string, ConditionQuestion> = {
  'pre-packaged-and-labelled': {
    question: 'Is this sold loose, or pre-packaged and labelled?',
    exemptLabel: 'Sold loose',
    taxableLabel: 'Pre-packaged & labelled',
  },
  'fresh-or-chilled-only': {
    question: 'Is this sold fresh or chilled, or frozen or processed?',
    exemptLabel: 'Fresh or chilled',
    taxableLabel: 'Frozen or processed',
  },
  'not-fresh-or-chilled': {
    /*
     * The mirror image, and the reason each condition needs its own answers
     * rather than a shared yes/no. Here the exemption applies to goods that
     * are NOT fresh — so "fresh or chilled" is the answer that loses it.
     * A generic "does the condition apply?" would invert this half the time.
     */
    question: 'Is this frozen or processed, or sold fresh or chilled?',
    exemptLabel: 'Frozen or processed',
    taxableLabel: 'Fresh or chilled',
  },
  'unprocessed-only': {
    question: 'Is this sold in its natural form, or processed?',
    exemptLabel: 'Natural, unprocessed',
    taxableLabel: 'Processed',
  },
  'seed-quality-only': {
    question: 'Is this sold as seed for sowing, or as food?',
    exemptLabel: 'Seed for sowing',
    taxableLabel: 'Sold as food',
  },
  'seller-specific': {
    question: 'Are you an authorised seller of this, as the notification describes?',
    exemptLabel: 'Yes, authorised',
    taxableLabel: 'No, ordinary sale',
  },
  'listed-in-annexure': {
    question: 'Is this exact item named in the notification’s annexure?',
    exemptLabel: 'Yes, it is named',
    taxableLabel: 'No, or not sure',
  },
  'has-exclusion': {
    question: 'This entry excludes some goods — read it above. Is yours covered?',
    exemptLabel: 'Yes, covered',
    taxableLabel: 'No, or not sure',
  },
}

/** Counts, for the screen that explains where an answer came from. */
export const EXEMPT_TABLE_INFO = {
  notification: table.source.notification,
  gazette: table.source.gazette,
  dated: table.source.dated,
  supersedes: table.source.supersedes,
  entryCount: table.entryCount,
  codeCount: table.codeCount,
  ruleCount: table.ruleCount,
}
