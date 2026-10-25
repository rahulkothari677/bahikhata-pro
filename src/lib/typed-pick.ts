/**
 * Phase 7c step 2d (change C12) — which item a typed line means, and how much.
 *
 * NEVER A GUESS ON THE BILL. A line goes straight on only when exactly one
 * item can take what was said:
 *   - "toor 400": of the toor rows only the loose Toor Dal takes 400 (= 400 g);
 *     the packed ones have no 400 size → straight on, 0.4 kg.
 *   - "parle g 10": the ₹10 size of Parle-G → straight on, 1 packet.
 *   - "tata salt": Tata Salt and Tata Salt Lite match, but only one is named in
 *     full → straight on.
 * Anything less certain ("dal 400", "maggi 2", "lays 10") comes back as a
 * question with its likely choices, which the bill shows as a card — never a
 * popup, never a wrong line. A pick the shop made twice for the same words is
 * remembered (`learned`) and used only while that item still matches.
 *
 * The search is the app's one rule (lib/item-search.ts), passed in; amounts are
 * lib/loose-entry.ts.
 */
import { parseTypedLine, type TypedLine } from './typed-line'
import { groupPickRows, rowName, type PickProduct } from './pick-rows'
import { nextQtyFor, isLooseUnit } from './loose-entry'

export interface PickableItem extends PickProduct { unit?: string | null }
export interface TypedChoice<P> { product: P; qty: number }
export type TypedPick<P> =
  | { kind: 'add'; said: string; key: string; product: P; qty: number; learned: boolean }
  | { kind: 'ask'; said: string; key: string; choices: TypedChoice<P>[]; more: number }
  | { kind: 'none' }

export interface TypedPickOptions<P> {
  /** The app's item search, best first, names only (itemSearch nameOnly); `close` = spelling guesses. */
  search: (query: string) => { items: P[]; close: boolean }
  gramsRule: boolean
  /** "₹50 of it": the quantity those rupees buy, by the bill's price rule. */
  rupeesToQty: (p: P, rupees: number) => number | null
  /** The item this shop picked twice for these words, if any. */
  learned?: (key: string) => string | null
}

/** Choices shown on a question card. */
export const TYPED_CHOICES = 6

/** The words a pick is remembered under: the name and its sizes ("parle g 5"), never the amount. */
export function learnKey(line: TypedLine): string {
  return [line.name, ...line.sizes].join(' ').trim()
}

const wordsOf = (s: string) => s.toLowerCase().split(/[\s-]+/).filter(Boolean)
/** Does this item carry this size exactly ("₹5" is 5, "₹50" is not)? */
const hasSize = (p: PickableItem, n: number) =>
  (`${p.sizeLabel ?? ''} ${p.name}`.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).includes(n)

/** How much of an item the line asks for, or null when that item cannot take it. */
function qtyFor(p: PickableItem, line: TypedLine, tailWasSize: boolean, opts: TypedPickOptions<any>): number | null {
  if (isLooseUnit(p.unit)) {
    const amt = line.amount ?? (line.tail !== null && !tailWasSize ? { n: line.tail, unit: 'count' as const } : null)
    if (!amt) return 1
    const r = nextQtyFor(amt, p.unit, opts.gramsRule, (rs) => opts.rupeesToQty(p, rs))
    return 'qty' in r ? r.qty : null
  }
  // A weight or ₹ on a packet waits for pack sizes (change C13).
  if (line.amount && line.amount.unit !== 'count') return null
  const n = line.amount?.n ?? (!tailWasSize ? line.tail : null) ?? line.count ?? 1
  return Number.isInteger(n) && n > 0 ? n : null
}

/** The one item the line can mean, or null. */
function onlyItem<P extends PickableItem>(items: P[], line: TypedLine, tailWasSize: boolean, opts: TypedPickOptions<P>): P | null {
  const rows = groupPickRows(items)
  const single = rows.filter((r) => r.items.length === 1)
  const weighed = !!line.amount && line.amount.unit !== 'count'
  // Who can take what was said: a weight or ₹ → loose goods; a bare number → loose goods (own
  // unit) and single items (a count); nothing → any single item.
  const able = (weighed ? single.filter((r) => isLooseUnit(r.items[0].unit))
    : line.tail !== null && !tailWasSize ? single
      : rows.length === 1 ? rows : single)
    .filter((r) => r.items.length === 1 && qtyFor(r.items[0], line, tailWasSize, opts) !== null)
  if (able.length === 1) return able[0].items[0]
  if (able.length > 1) {
    const typed = new Set(wordsOf(line.name))
    const full = able.filter((r) => wordsOf(rowName(r)).every((w) => typed.has(w)))
    if (full.length === 1) return full[0].items[0]
  }
  return null
}

export function pickTypedLine<P extends PickableItem>(text: string, opts: TypedPickOptions<P>): TypedPick<P> {
  const line = parseTypedLine(text)
  if (!line.name) return { kind: 'none' }
  const said = line.said
  const key = learnKey(line)
  const add = (product: P, qty: number, learned = false): TypedPick<P> => ({ kind: 'add', said, key, product, qty, learned })
  const base = [line.name, ...line.sizes].join(' ')
  // A size said ("5 wala") must be the item's size exactly — "5" never means the ₹50 pack.
  const sized = (list: P[]) => (line.sizes.length ? list.filter((i) => line.sizes.every((n) => hasSize(i, n))) : list)

  // 1. A bare number that is a size ("parle g 10" = the ₹10 pack). Never from a spelling guess:
  //    "maggi 2" must not become Lays Magic Masala ₹20.
  if (line.tail !== null && !line.amount) {
    const r = opts.search(`${base} ${line.tail}`)
    if (!r.close) {
      const one = onlyItem(sized(r.items).filter((i) => hasSize(i, line.tail!)), line, true, opts)
      if (one) return add(one, qtyFor(one, line, true, opts)!)
    }
  }
  // 2. The name (and its sizes): the learned pick, then the only item that can take the amount.
  const found = opts.search(base)
  const items = sized(found.items)
  if (!items.length) return { kind: 'ask', said, key, choices: [], more: 0 }
  if (!found.close) {
    const learnedId = opts.learned?.(key)
    const remembered = learnedId ? items.find((i) => i.id === learnedId) : undefined
    if (remembered) {
      const q = qtyFor(remembered, line, false, opts)
      if (q) return add(remembered, q, true)
    }
    const one = onlyItem(items, line, false, opts)
    if (one) return add(one, qtyFor(one, line, false, opts)!)
  }

  // 3. A question: the likely items, loose goods first when a weight or ₹ was said.
  const rows = groupPickRows(items)
  const weighed = !!line.amount && line.amount.unit !== 'count'
  const ordered = weighed ? [...rows.filter((r) => isLooseUnit(r.items[0].unit)), ...rows.filter((r) => !isLooseUnit(r.items[0].unit))] : rows
  // A bare number: loose goods that take it as an amount first ("dal 400" → 400 g of each dal), then
  // the packets of exactly that size ("lays magik masala 20" → ₹20), then the rest.
  const flat = ordered.flatMap((r) => r.items)
  const tail = line.tail
  const bySize = tail !== null
    ? [...flat.filter((i) => isLooseUnit(i.unit)), ...flat.filter((i) => !isLooseUnit(i.unit) && hasSize(i, tail)), ...flat.filter((i) => !isLooseUnit(i.unit) && !hasSize(i, tail))]
    : flat
  const all = bySize
    .map((product) => ({ product, qty: qtyFor(product, line, tail !== null && !isLooseUnit(product.unit) && hasSize(product, tail), opts) }))
    .filter((c): c is TypedChoice<P> => c.qty !== null)
  return { kind: 'ask', said, key, choices: all.slice(0, TYPED_CHOICES), more: Math.max(0, all.length - TYPED_CHOICES) }
}

/**
 * Picks remembered on this device: words → { item, times }. Used once the same
 * item was picked twice for the same words (so one odd pick is never repeated),
 * and only while that item still matches the words.
 */
export interface LearnedPicks { [key: string]: { id: string; n: number } }

export function teach(picks: LearnedPicks, key: string, id: string): { picks: LearnedPicks; learnedNow: boolean } {
  if (!key) return { picks, learnedNow: false }
  const was = picks[key]
  const n = was && was.id === id ? was.n + 1 : 1
  return { picks: { ...picks, [key]: { id, n } }, learnedNow: n === 2 }
}

export function learnedId(picks: LearnedPicks, key: string): string | null {
  const e = picks[key]
  return e && e.n >= 2 ? e.id : null
}
