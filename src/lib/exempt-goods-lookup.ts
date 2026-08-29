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
