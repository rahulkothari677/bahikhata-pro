/**
 * Phase 8b (#129) — the HSN and its rate from what the shopkeeper already typed.
 *
 * The CA's #1 cause of small-shop rework is a wrong HSN or rate on a new item.
 * The fix is not a longer form: the item's NAME already says what it is. "Aata"
 * is wheat flour, 1101; the table then knows the rest — exempt sold loose, 5%
 * pre-packaged and labelled (09/2025 and 10/2025-CT(R)).
 *
 * SUGGEST, NEVER DECIDE (entry-model P5: "AI finds and fills. AI never decides
 * what lands on a tax invoice"). Half the kirana turns on a fact no name
 * carries — loose or packed, fresh or frozen — so this returns CHOICES, each
 * with the statute's own words, and the shopkeeper taps one.
 *
 * ONE VOCABULARY. Names are read through lib/item-search.ts `shopWordsIn`, the
 * same shop-word list search uses ("cheeni" = sugar, Hindi script too). This
 * file only says which heading each shop word is.
 *
 * NOTHING HERE FROM MEMORY. Every pairing carries `statute`: a word its own row
 * in the notification must contain. The test reads every row and fails on a
 * pairing whose heading does not say so — and the same word picks the right row
 * when one heading holds two things (1905: bread exempt, biscuits 5%).
 * Left out on purpose, because a name alone cannot pin them: oil (sunflower,
 * mustard, palm are three headings), vegetables, chips, pickle, dates (the
 * source row is garbled), ajwain. Ginger and turmeric too: the 0910 row carves
 * out the fresh ones, so the heading answers nothing and the fresh 8-digit
 * codes would offer only "exempt" to a shop selling haldi powder at 5%. And
 * namkeen: 210690 also holds pan masala (21069020), whose 1 Feb 2026 change
 * makes the lookup refuse the whole sub-heading. A one-sided suggestion is a
 * wrong one. Water and broom: their rows (loose water vs sealed; twig brooms vs
 * broomsticks vs brushes) cannot be told apart by labels a shopkeeper reads.
 *
 * THE LIVE CHECK (31 Oct) found the first statute words too loose: "sugar"
 * matched "Khandsari Sugar" in the exempt row and offered refined cheeni "No GST
 * sold loose"; "tea" offered the green-leaf exemption. So each phrase now pins
 * the row a shop sells, bracketed exclusions never count (rowNames), and the
 * test pins every word's exact buttons.
 */
import { shopWordsIn } from './item-search'
import { lookupHsn, normaliseHsn } from './hsn-rate-lookup'
import { lookupExemption, exemptAdditionFor, CONDITION_QUESTION, EXEMPT_TABLE_INFO } from './exempt-goods-lookup'

export interface ShopWordHsn {
  /** The first word of a shop-word group (lib/shop-words.ts). */
  word: string
  hsn: string
  /** A word the notification's row for `hsn` contains; spaces are ignored (the source wraps words: "fe nnel"). */
  statute: string
}

export const HSN_BY_SHOP_WORD: readonly ShopWordHsn[] = [
  // staples
  { word: 'sugar', hsn: '1701', statute: 'refined sugar' }, // not the exempt khandsari row
  { word: 'jaggery', hsn: '1701', statute: 'jaggery' },
  { word: 'salt', hsn: '2501', statute: 'salt' },
  { word: 'atta', hsn: '1101', statute: 'wheat' },
  { word: 'rice', hsn: '1006', statute: 'rice' },
  { word: 'dal', hsn: '0713', statute: 'leguminous' },
  { word: 'toor', hsn: '0713', statute: 'leguminous' },
  { word: 'moong', hsn: '0713', statute: 'leguminous' },
  { word: 'chana', hsn: '0713', statute: 'leguminous' },
  { word: 'urad', hsn: '0713', statute: 'leguminous' },
  { word: 'masoor', hsn: '0713', statute: 'leguminous' },
  { word: 'besan', hsn: '1106', statute: 'pulses' },
  { word: 'suji', hsn: '1103', statute: 'cereal groats' }, // both rows; only the packed one says "suji"
  { word: 'poha', hsn: '1904', statute: 'flattened' },
  { word: 'murmura', hsn: '1904', statute: 'puffed rice' },
  { word: 'mustard', hsn: '1514', statute: 'mustard oil' },
  { word: 'ghee', hsn: '0405', statute: 'ghee' },
  // dairy and fresh
  { word: 'milk', hsn: '0401', statute: 'milk' },
  { word: 'curd', hsn: '0403', statute: 'curd' },
  { word: 'butter', hsn: '0405', statute: 'butter' },
  { word: 'egg', hsn: '0407', statute: 'eggs' },
  { word: 'bread', hsn: '1905', statute: 'bread' },
  { word: 'potato', hsn: '0701', statute: 'potatoes' },
  { word: 'onion', hsn: '0703', statute: 'onions' },
  { word: 'tomato', hsn: '0702', statute: 'tomatoes' },
  { word: 'garlic', hsn: '0703', statute: 'garlic' },
  { word: 'lemon', hsn: '0805', statute: 'citrus' },
  // spices
  { word: 'chilli', hsn: '0904', statute: 'capsicum' },
  { word: 'coriander', hsn: '0909', statute: 'coriander' },
  { word: 'cumin', hsn: '0909', statute: 'cumin' },
  { word: 'fennel', hsn: '0909', statute: 'fennel' },
  { word: 'cardamom', hsn: '0908', statute: 'cardamom' },
  { word: 'cinnamon', hsn: '0906', statute: 'cinnamon' },
  { word: 'clove', hsn: '0907', statute: 'cloves' },
  // drinks and snacks
  { word: 'tea', hsn: '0902', statute: 'whether or not flavoured' }, // made tea; green leaves are not a shop item
  { word: 'coffee', hsn: '0901', statute: 'coffee roasted' },
  { word: 'biscuit', hsn: '1905', statute: 'biscuits' },
  { word: 'almond', hsn: '0802', statute: 'nuts, dried' }, // dry fruit; fresh nuts are another row
  { word: 'cashew', hsn: '0801', statute: 'cashew' },
  { word: 'raisin', hsn: '0806', statute: 'raisins' },
  { word: 'walnut', hsn: '0802', statute: 'nuts, dried' },
  { word: 'peanut', hsn: '1202', statute: 'ground nuts' },
  { word: 'isabgol', hsn: '12119013', statute: 'psyllium' },
  // household
  { word: 'soap', hsn: '3401', statute: 'soap' },
  { word: 'toothpaste', hsn: '3306', statute: 'toothpaste' },
  { word: 'matchbox', hsn: '3605', statute: 'all goods' }, // heading 3605 is Matches; its row reads "All goods"
  { word: 'incense', hsn: '33074100', statute: 'agarbatti' },
  { word: 'candle', hsn: '3406', statute: 'candles' },
  { word: 'polythene', hsn: '3923', statute: 'plastics' },
  { word: 'battery', hsn: '8506', statute: 'batteries' },
  { word: 'bulb', hsn: '8539', statute: 'lamps' },
]

/** One thing the shopkeeper can tap: the rate, the treatment, and the words it came from. */
export interface HsnChoice {
  /** On the button: the condition in shop words ("Sold loose"), or the row's own short name. */
  label: string
  gstRate: number
  treatment: 'taxable' | 'exempt'
  /** What this choice answers on the item form's exemption questions, so nothing is asked twice. */
  answers: Record<string, 'exempt' | 'taxable'>
  /** The notification's row, verbatim — for the ⓘ. */
  description: string
  /** "09/2025-Central Tax (Rate) · from 22 September 2025". */
  source: string
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const onDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * The row's name, short enough for a button: up to its first comma, semicolon or
 * bracket, and when still long, cut at a word boundary (#339: "…chemicall…").
 */
export function shortName(description: string): string {
  const head = description.split(/[,;([]/)[0].replace(/\s+/g, ' ').trim()
  if (head.length <= 34) return head
  const space = head.lastIndexOf(' ', 33) // a space AT 33 means the first 33 letters end a word
  return `${(space > 12 ? head.slice(0, space) : head.slice(0, 33)).trimEnd()}…`
}

/**
 * Does this row NAME the thing? Words inside a bracketed exclusion do not count:
 * the sugar row says "[other than jaggery …, khandsari sugar]" and the corn-flakes
 * row "(other than puffed rice … flattened rice)" — matching there offered jaggery
 * the sugar row's rate and poha a corn-flakes button (found on the live check, 8b).
 */
export function rowNames(description: string, statute: string): boolean {
  const own = description.replace(/[[(]\s*other than[^\])]*[\])]/gi, ' ')
  return squash(own).includes(squash(statute))
}

/** A statute row before it becomes a button: its rate, treatment and the questions it turns on. */
interface Row { gstRate: number; treatment: 'taxable' | 'exempt'; asked: string[]; description: string; source: string }

/**
 * Every choice the two tables allow for this code on this date, most specific
 * rows only — a chapter-wide row (#120, #334) is a question the form asks on
 * its own, never a button here. `statute`, when given, keeps the rows that name
 * the thing (bread, not biscuits, under 1905); if none do, all rows stay.
 * Rows are chosen FIRST and labelled after, so a label describes what is offered.
 */
export function hsnChoices(input: string, asOn: Date = new Date(), statute?: string): HsnChoice[] {
  const hsn = normaliseHsn(input)
  if (hsn.length < 4) return []
  const rows: Row[] = []

  const ex = lookupExemption(hsn, asOn)
  if (ex.outcome !== 'not-listed' && (ex.matchedOn?.length ?? 0) > 2) {
    const added = exemptAdditionFor(hsn, asOn)
    const source = added
      ? `${added.notification} · from ${onDate(added.effectiveFrom)}`
      : `${EXEMPT_TABLE_INFO.notification} · from ${onDate('2025-09-22')}`
    for (const rule of ex.rules) {
      rows.push({ gstRate: 0, treatment: 'exempt', asked: rule.conditions.filter((c) => CONDITION_QUESTION[c]), description: rule.description, source })
    }
  }
  const rate = lookupHsn(hsn, asOn)
  if (rate.rules.length && (rate.matchedOn?.length ?? 0) > 2 && rate.outcome !== 'unknown') {
    const source = `${rate.source.notification} · from ${onDate(rate.source.ratesAsOn)}`
    for (const rule of rate.rules) rows.push({ gstRate: rule.gstRate, treatment: 'taxable', asked: [], description: rule.description, source })
  }

  const named = statute ? rows.filter((r) => rowNames(r.description, statute)) : rows
  const kept = named.length ? named : rows

  const exempt = kept.filter((r) => r.treatment === 'exempt')
  const taxable = kept.filter((r) => r.treatment === 'taxable')
  // The question a loose/packed (or seed/food) pair turns on. "Has an exclusion" is
  // asked and answered, but it names nothing a shopkeeper would tap for.
  const shown = (r: Row) => r.asked.filter((c) => c !== 'has-exclusion')
  const pairQuestion = exempt.length === 1 && taxable.length === 1 && shown(exempt[0]).length === 1 ? shown(exempt[0])[0] : null

  const label = (r: Row): string => {
    if (r.treatment === 'exempt') {
      if (shown(r).length) return shown(r).map((c) => CONDITION_QUESTION[c].exemptLabel).join(' · ')
      return exempt.length > 1 ? shortName(r.description) : 'No GST'
    }
    if (pairQuestion) return CONDITION_QUESTION[pairQuestion].taxableLabel
    return new Set(taxable.map((t) => t.gstRate)).size > 1 || taxable.length > 1 ? shortName(r.description) : 'Taxable'
  }

  const out: HsnChoice[] = kept.map((r) => ({
    label: label(r),
    gstRate: r.gstRate,
    treatment: r.treatment,
    answers: Object.fromEntries(r.asked.map((c) => [c, 'exempt' as const])),
    description: r.description,
    source: r.source,
  }))
  // One button per distinct outcome: two rows at the same rate and label are one choice.
  return out.filter((c, i) => out.findIndex((d) => d.gstRate === c.gstRate && d.treatment === c.treatment && d.label === c.label) === i)
}

export interface HsnSuggestion {
  /** The shop word in the name that led here ("atta"). */
  word: string
  hsn: string
  choices: HsnChoice[]
}

/** The HSN a name points to, with its choices — the first shop word that has one, or null. */
export function suggestHsnForName(name: string, asOn: Date = new Date()): HsnSuggestion | null {
  for (const word of shopWordsIn(name)) {
    const pair = HSN_BY_SHOP_WORD.find((p) => p.word === word)
    if (!pair) continue
    const choices = hsnChoices(pair.hsn, asOn, pair.statute)
    if (choices.length) return { word, hsn: pair.hsn, choices }
  }
  return null
}

/** Does the item's rate and treatment match one of the code's choices? `null` when the tables do not know the code. */
export function choiceFits(choices: HsnChoice[], gstRate: number, treatment: string): boolean | null {
  if (!choices.length) return null
  return choices.some((c) => (c.treatment === 'exempt'
    ? treatment === 'exempt' && gstRate === 0
    : treatment !== 'exempt' && treatment !== 'nonGst' && c.gstRate === gstRate))
}

/**
 * Notification 78/2020-CT (Rule 46(g), from 1 Apr 2021): previous year's
 * turnover above ₹5 crore → 6 digits on every invoice; up to it → 4. A Council
 * threshold, so one named constant. (90/2020-CT's 8 digits for listed chemicals
 * and plastics needs the list, not the code — not checked here.)
 */
export const HSN_SIX_DIGITS_ABOVE_TURNOVER = 5_00_00_000

/** Digits this shop's HSN needs, from its DECLARED previous-year turnover in rupees (null: not declared → 4). */
export function hsnDigitsFor(priorFyTurnover: number | null | undefined): 4 | 6 {
  return Number(priorFyTurnover) > HSN_SIX_DIGITS_ABOVE_TURNOVER ? 6 : 4
}

/**
 * #129: what is wrong with a typed HSN, and the fix. GSTR-1 Table 12 takes 4, 6
 * or 8 digits from a fixed list (dropdown since May 2025); a 5-digit code or
 * letters cannot be filed. Spaces and dashes are fine — they are taken out.
 * `minDigits` 6 for a shop above ₹5 crore (hsnDigitsFor).
 */
export function checkHsnFormat(input: string, minDigits: 4 | 6 = 4): { code: string; problem?: string; fix?: string } {
  const raw = (input || '').trim()
  if (!raw) return { code: '' }
  if (/[^\d\s-]/.test(raw)) return { code: raw, problem: 'HSN is digits only' }
  const code = normaliseHsn(raw)
  if (minDigits === 6 && code.length === 4) return { code, problem: 'Turnover above ₹5 crore: HSN needs 6 digits' }
  if ([4, 6, 8].includes(code.length)) return { code }
  if (code.length < 4) return { code, problem: `HSN needs at least 4 digits — this has ${code.length}` }
  const fit = code.length > 8 ? 8 : code.length - 1
  return { code, problem: `HSN is 4, 6 or 8 digits — this has ${code.length}`, fix: code.slice(0, fit) }
}
