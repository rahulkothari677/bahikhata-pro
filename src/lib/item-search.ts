/**
 * Phase 7a (#296, #297, #287) — ONE item search for the whole app.
 *
 * Before this there were three: a letters-anywhere match in the bill screen and
 * the item picker ("atta" also found Kurkure Chilli Chatka), a different one in
 * the Items list, and a database `contains` behind the search box. Measured on
 * a 341-item shop: after three letters the wanted item was on screen for 55%
 * of items, and "aata" or "cheeni" found nothing.
 *
 * The rule, in the order a shopkeeper meets it:
 *  - Every word typed must start a word of the item (name, or its group), in
 *    any order: "atta aash" finds Aashirvaad Atta; "atta" never finds "Chatka".
 *  - Spelling slips that Indian spellings make are forgiven — the SAME folding
 *    the name resolver uses (lib/resolve-name.ts): aata = atta, ashirwad =
 *    aashirvaad, cheeni = chini, Hindi script read as Latin.
 *  - Shop words (lib/shop-words.ts): cheeni finds Sugar, namak finds Salt.
 *  - Numbers: "10" finds ₹10 packs and items priced ₹10; "500g" finds "500 gm".
 *  - A barcode or code finds its item first.
 *  - Nothing found at all → close matches one letter off ("parel" → Parle-G),
 *    marked as close, never mixed in with real matches.
 *
 * Returns EVERY match, ranked, with the total — a caller that shows fewer says
 * "8 of 52" (the entry study's P6: nothing is cut without saying so).
 */
import { normalise, transliterate } from './resolve-name'
import { SHOP_WORD_GROUPS, UNIT_WORD_GROUPS, QUERY_NOISE_WORDS } from './shop-words'

export interface SearchableItem {
  id: string
  name: string
  sku?: string | null
  barcode?: string | null
  hsn?: string | null
  category?: string | null
  /** In rupees, as the API sends it. */
  salePrice?: number | null
}

export interface ItemSearchResult<T> {
  items: T[]
  total: number
  /** True when nothing matched and these are one-letter-off close matches. */
  close: boolean
}

interface Tok { light: string; fold: string; num: number | null }

/** Words, as typed or printed: Hindi script read as Latin, lower case, letters split from digits. */
function words(s: string | null | undefined): string[] {
  return transliterate(String(s || ''))
    .toLowerCase()
    .replace(/₹/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function tok(light: string): Tok {
  return { light, fold: normalise(light).replace(/\s+/g, ''), num: /^\d+(\.\d+)?$/.test(light) ? Number(light) : null }
}

/**
 * Spelling slips are forgiven only between words of 4+ letters: folded, "aata"
 * and "atta" agree (good), but so would "good" and "gud" (jaggery). Short words
 * are covered by the shop-word list instead ("daal" → dal).
 */
function foldable(t: Tok, q: Tok): boolean {
  return q.light.length >= 4 && t.light.length >= 4 && !!q.fold
}

/** The same thing written two ways: as typed (prefix while typing) and folded (spelling slips). */
function startsWith(t: Tok, q: Tok): boolean {
  return t.light.startsWith(q.light) || (foldable(t, q) && t.fold.startsWith(q.fold))
}

const groupOf = (groups: readonly (readonly string[])[]) => groups.map((g) => g.map(tok))
const SHOP_GROUPS = groupOf(SHOP_WORD_GROUPS)
const UNIT_GROUPS = groupOf(UNIT_WORD_GROUPS)
const NOISE = new Set(QUERY_NOISE_WORDS)

/**
 * The shop words a query word stands for: a word of a group as typed, the same
 * word spelt another way, or the start (4+ letters) of one. Folded spellings
 * only count for words of 4+ letters on both sides — folded, "good" and "gud"
 * (jaggery) are the same three letters, and "zzzz" folds to one.
 */
function synonymsFor(q: Tok): Tok[] {
  const out: Tok[] = []
  const longFold = q.fold.length >= 4
  for (const g of SHOP_GROUPS) {
    const hit = g.some((m) => m.light === q.light ||
      (longFold && m.fold.length >= 4 && m.fold === q.fold) ||
      (q.light.length >= 4 && m.light.startsWith(q.light)) ||
      (longFold && m.fold.startsWith(q.fold)))
    if (hit) out.push(...g)
  }
  return out
}

/**
 * An item word written as a shop word stands for: the word itself, its plural
 * ("biscuits"), or the same word spelt another way. Not any longer word — "salt"
 * is not "Salted" chips.
 */
function isShopWord(t: Tok, s: Tok): boolean {
  return t.light === s.light || t.light === `${s.light}s` || t.light === `${s.light}es` ||
    (s.fold.length >= 4 && t.fold === s.fold)
}

/**
 * The shop-word groups an item's name names, each as its group's first word —
 * "Aashirvaad Aata 5kg" → ['atta'], "चीनी" → ['sugar']. Phase 8b (#129): the
 * item form's HSN-by-name reads names through this, so search and HSN agree on
 * what a word means.
 */
export function shopWordsIn(name: string): string[] {
  const out: string[] = []
  for (const w of words(name).map(tok)) {
    for (const g of SHOP_GROUPS) {
      if (!out.includes(g[0].light) && g.some((m) => isShopWord(w, m))) out.push(g[0].light)
    }
  }
  return out
}

function unitGroupFor(q: Tok): Tok[] | null {
  return UNIT_GROUPS.find((g) => g.some((m) => m.light === q.light)) ?? null
}

/** A typed word, with what it stands for worked out once per search (not once per item). */
interface QWord { t: Tok; unit: Tok[] | null; syn: Tok[] }

interface Indexed {
  name: Tok[]
  /** Neighbouring words run together ("parle"+"g"), for a word typed as one piece. */
  joins: { at: number; t: Tok }[]
  group: Tok[]
  codes: string[]
  hsn: string
  price: number | null
  nameLen: number
  /** Lower-case name for the A–Z tie-break: a plain comparison, ~50× faster than localeCompare over 10,000 rows. */
  sortKey: string
}
const INDEX = new WeakMap<object, Indexed>()

function indexOf(item: SearchableItem): Indexed {
  const hit = INDEX.get(item)
  if (hit) return hit
  const name = words(item.name).map(tok)
  const joins: { at: number; t: Tok }[] = []
  for (let i = 0; i < name.length - 1; i++) {
    joins.push({ at: i, t: tok(name[i].light + name[i + 1].light) })
    if (i < name.length - 2) joins.push({ at: i, t: tok(name[i].light + name[i + 1].light + name[i + 2].light) })
  }
  const built: Indexed = {
    name,
    joins,
    group: words(item.category).map(tok),
    codes: [item.barcode, item.sku].filter((c): c is string => !!c).map((c) => c.trim().toLowerCase()),
    hsn: (item.hsn || '').trim(),
    price: typeof item.salePrice === 'number' && Number.isFinite(item.salePrice) ? item.salePrice : null,
    nameLen: (item.name || '').length,
    sortKey: `${(item.name || '').toLowerCase()}\u0000${item.id}`,
  }
  INDEX.set(item, built)
  return built
}

/** One-letter-off (insert, delete, change, or swap two neighbours). */
function withinOne(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diff: number[] = []
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i)
    if (diff.length === 1) return true
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  while (i < s.length && s[i] === l[i]) i++
  return s.slice(i) === l.slice(i + 1)
}

type How = 'name' | 'synonym' | 'number' | 'price' | 'group' | 'close'
interface Hit { how: How; first: boolean; whole?: boolean }

/** How one typed word matches the item, best way first; null when it does not. */
function matchWord(ix: Indexed, w: QWord, allowClose: boolean, nameOnly = false): Hit | null {
  const { t: q, unit, syn } = w
  if (q.num !== null) {
    const at = ix.name.findIndex((t) => t.num !== null && t.num === q.num)
    if (at >= 0) return { how: 'number', first: at === 0 }
    if (ix.price !== null && ix.price === q.num) return { how: 'price', first: false }
    const pre = ix.name.findIndex((t) => t.num !== null && t.light.startsWith(q.light))
    if (pre >= 0) return { how: 'number', first: pre === 0 }
    return null
  }
  if (unit) {
    const at = ix.name.findIndex((t) => unit.some((u) => u.light === t.light))
    if (at >= 0) return { how: 'name', first: at === 0 }
  }
  // A whole word ("haldi" in MDH Haldi Powder) beats the start of a longer one (Haldiram's).
  const whole = ix.name.findIndex((t) => t.light === q.light || (foldable(t, q) && t.fold === q.fold))
  if (whole >= 0) return { how: 'name', first: whole === 0, whole: true }
  const direct = ix.name.findIndex((t) => startsWith(t, q))
  if (direct >= 0) return { how: 'name', first: direct === 0 }
  // A word typed as one piece that the item writes as two ("parleg" for Parle-G).
  // The typed word must run PAST the first word, as typed or folded ("good" is not "gud"+"jaggery").
  const joined = ix.joins.find((j) => (q.light.length > ix.name[j.at].light.length && j.t.light.startsWith(q.light)) ||
    (q.fold.length > ix.name[j.at].fold.length && foldable(j.t, q) && j.t.fold.startsWith(q.fold)))
  if (joined) return { how: 'name', first: joined.at === 0 }
  if (syn.length) {
    const at = ix.name.findIndex((t) => syn.some((s) => isShopWord(t, s)))
    if (at >= 0) return { how: 'synonym', first: at === 0 }
  }
  // nameOnly (a typed bill line, lib/typed-pick.ts): the item's own name must answer — "cheeni"
  // is Sugar, never Gud for sitting in the "Sugar & salt" group.
  if (!nameOnly && ix.group.some((t) => startsWith(t, q) || syn.some((s) => isShopWord(t, s)))) return { how: 'group', first: false }
  // One letter off — but the first two letters agree, or "cheeni" would turn into "Clinic Plus";
  // and never for a known shop word: "cheeni" is spelt right, the shop just has no sugar.
  if (allowClose && q.fold.length >= 4 && !syn.length) {
    const at = ix.name.findIndex((t) => t.fold.slice(0, 2) === q.fold.slice(0, 2) &&
      [q.fold.length - 1, q.fold.length, q.fold.length + 1].some((n) => n >= 3 && withinOne(q.fold, t.fold.slice(0, n))))
    if (at >= 0) return { how: 'close', first: at === 0 }
  }
  return null
}

const WEIGHT: Record<How, number> = { name: 40, number: 40, price: 25, synonym: 20, group: 5, close: 10 }

function queryWords(query: string): QWord[] {
  return words(query).filter((w) => !NOISE.has(w)).map(tok).filter((t) => t.light)
    .map((t) => ({ t, unit: unitGroupFor(t), syn: t.num === null ? synonymsFor(t) : [] }))
}

function score(item: SearchableItem, ix: Indexed, qs: QWord[], codeQuery: string, allowClose: boolean, nameOnly = false): number | null {
  if (codeQuery) {
    if (ix.codes.includes(codeQuery)) return 10_000
    if (codeQuery.length >= 4 && ix.codes.some((c) => c.startsWith(codeQuery))) return 5_000
  }
  let total = 0
  let firstHit = false
  for (const q of qs) {
    const m = matchWord(ix, q, allowClose, nameOnly)
    if (!m) {
      // An HSN typed as the only word still finds its items (it did before 7a).
      if (qs.length === 1 && q.t.num !== null && ix.hsn.startsWith(q.t.light)) return 1
      return null
    }
    total += WEIGHT[m.how] + (m.whole ? 35 : 0)
    if (m.first) firstHit = true
  }
  return total + (firstHit ? 15 : 0) - Math.min(ix.nameLen, 60) / 20 + (item.name ? 0 : -1)
}

/**
 * All items matching `query`, best first. `boost` (item id → 0..1) lifts a
 * shop's often-sold items among equals; it never lets a worse match jump a
 * better one by more than one step.
 */
export function itemSearch<T extends SearchableItem>(
  items: readonly T[],
  query: string,
  opts: { boost?: ReadonlyMap<string, number>; nameOnly?: boolean } = {},
): ItemSearchResult<T> {
  const qs = queryWords(query)
  const compact = String(query || '').trim().toLowerCase().replace(/\s+/g, '')
  const codeQuery = /^[a-z0-9-]{3,}$/.test(compact) && /\d/.test(compact) ? compact : ''
  if (!qs.length && !codeQuery) return { items: [...items], total: items.length, close: false }

  const run = (allowClose: boolean) => {
    const scored: { item: T; s: number; k: string }[] = []
    for (const item of items) {
      const ix = indexOf(item)
      const s = score(item, ix, qs, codeQuery, allowClose, !!opts.nameOnly)
      if (s !== null) scored.push({ item, s: s + 9 * (opts.boost?.get(item.id) ?? 0), k: ix.sortKey })
    }
    scored.sort((a, b) => b.s - a.s || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    return scored.map((x) => x.item)
  }
  const strict = run(false)
  if (strict.length) return { items: strict, total: strict.length, close: false }
  const close = run(true)
  return { items: close, total: close.length, close: close.length > 0 }
}

/** Does this item match? (Filters — the Items list — use the same rule, close matches excluded.) */
export function itemMatches(item: SearchableItem, query: string): boolean {
  const qs = queryWords(query)
  const compact = String(query || '').trim().toLowerCase().replace(/\s+/g, '')
  const codeQuery = /^[a-z0-9-]{3,}$/.test(compact) && /\d/.test(compact) ? compact : ''
  if (!qs.length && !codeQuery) return true
  return score(item, indexOf(item), qs, codeQuery, false) !== null
}

/** "8 of 52" — how many a caller shows against how many matched. */
export function shownOf(shown: number, total: number): string | null {
  return total > shown ? `${shown} of ${total}` : null
}
