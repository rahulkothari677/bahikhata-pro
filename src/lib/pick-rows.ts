/**
 * Phase 7c (#294, #295) — the rows of the bill picker, for every bill type.
 *
 * ONE ROW PER BRAND: a brand's sizes ride on one row as buttons (Parle-G:
 * ₹5 ₹10 ₹20 ₹50), an item on its own is a row by itself. The same row is used
 * for search results, "Often sold" and a group's full list — one pattern,
 * learned once (final plan §1). This replaces the Counter's tile grid, which
 * showed one tile per size and cut a group at 24 without a word.
 *
 * Pure, so it is tested; the screen only draws what these return.
 */
import { bySize, parseSize } from './product-sizes'

export interface PickProduct {
  id: string
  name: string
  category?: string | null
  familyId?: string | null
  family?: { id: string; name: string } | null
  sizeLabel?: string | null
  sizeRank?: number | null
}

export interface PickRowGroup<P extends PickProduct> {
  key: string
  /** The brand, or null for an item on its own. */
  brand: { id: string; name: string } | null
  items: P[]
  /** The size to mark as the shop's usual pick (most sold), when known. */
  topId?: string | null
}

/** How many rows a search shows in the list window before it says "30 of N, keep typing". */
export const SEARCH_ROWS = 30
/** Rows under ★ Often: the shop's best sellers (a ranking, so a top list by definition). */
export const OFTEN_ROWS = 24
/** Rows under "<customer> usually buys", at the top of ★ Often. */
export const USUAL_ROWS = 12
/** After this many bill lines the list window gets shorter, so the bill shows (#229). */
export const FOLD_AFTER_LINES = 6

/**
 * Ranked items → rows, keeping the ranking: a brand's row sits where its
 * best-ranked size fell, and carries only the sizes in `items` (a search for
 * "parle 10" shows Parle-G with its ₹10 alone).
 */
export function groupPickRows<P extends PickProduct>(ranked: readonly P[]): PickRowGroup<P>[] {
  const out: PickRowGroup<P>[] = []
  const byBrand = new Map<string, PickRowGroup<P>>()
  for (const p of ranked) {
    if (!p.familyId) { out.push({ key: p.id, brand: null, items: [p] }); continue }
    let row = byBrand.get(p.familyId)
    if (!row) {
      // No "most sold" mark here: in search results the first size is only the best MATCH.
      row = { key: `f:${p.familyId}`, brand: { id: p.familyId, name: p.family?.name ?? p.name }, items: [], topId: null }
      byBrand.set(p.familyId, row)
      out.push(row)
    }
    row.items.push(p)
  }
  for (const r of byBrand.values()) r.items.sort(bySize)
  return out
}

/**
 * Rows for items ranked by id (the shop's best sellers, or one customer's
 * usual items): a brand appears ONCE with ALL its sizes, so any size is one
 * tap, and its most-sold size is marked. Ids no longer in the catalog are
 * skipped; `exclude` keeps a row from showing twice on one screen.
 */
export function rankedRows<P extends PickProduct>(
  products: readonly P[],
  rankIds: readonly string[],
  limit: number,
  exclude: ReadonlySet<string> = new Set(),
): PickRowGroup<P>[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  const sizesOf = new Map<string, P[]>()
  for (const p of products) if (p.familyId) sizesOf.set(p.familyId, [...(sizesOf.get(p.familyId) ?? []), p])
  const out: PickRowGroup<P>[] = []
  const seen = new Set<string>()
  for (const id of rankIds) {
    if (out.length >= limit) break
    const p = byId.get(id)
    if (!p) continue
    const key = p.familyId ? `f:${p.familyId}` : p.id
    if (seen.has(key) || exclude.has(key)) continue
    seen.add(key)
    out.push(p.familyId
      ? { key, brand: { id: p.familyId, name: p.family?.name ?? p.name }, items: [...(sizesOf.get(p.familyId) ?? [p])].sort(bySize), topId: p.id }
      : { key, brand: null, items: [p] })
  }
  return out
}

/** Every row of one group (category), A–Z by what the row shows — the whole list, paged by the caller. */
export function groupRows<P extends PickProduct>(products: readonly P[], category: string, noCategory = 'Uncategorized'): PickRowGroup<P>[] {
  const inGroup = products.filter((p) => (p.category || noCategory) === category)
  const rows = groupPickRows(inGroup)
  const label = (r: PickRowGroup<P>) => (r.brand?.name ?? r.items[0].name).toLowerCase()
  return rows.sort((a, b) => (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0))
}


/**
 * Phase 7c, change C11 — the List design (Rahul, 24 Oct): groups as tabs, a
 * group's rows in a list window, product tabs inside a big group.
 */

/** What a row is called: its brand, or the item's name without its size and "(loose)". */
export function rowName<P extends PickProduct>(r: PickRowGroup<P>): string {
  if (r.brand) return r.brand.name
  const n = r.items[0].name
  return (parseSize(n)?.base ?? n).replace(/\s*\(loose\)\s*$/i, '').trim() || n
}

const rankMap = (rankIds: readonly string[]) => new Map(rankIds.map((id, i) => [id, i]))
const bestRank = (items: readonly { id: string }[], rank: Map<string, number>) =>
  items.reduce((b, it) => Math.min(b, rank.get(it.id) ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)

/**
 * The group tabs, in the order a shop reaches for them: groups holding its best
 * sellers first (by their best seller), then A–Z; "no group" last.
 */
export function listGroups<P extends PickProduct>(products: readonly P[], rankIds: readonly string[], noCategory = 'Uncategorized'): string[] {
  const rank = rankMap(rankIds)
  const best = new Map<string, number>()
  for (const p of products) {
    const c = p.category || noCategory
    best.set(c, Math.min(best.get(c) ?? Number.MAX_SAFE_INTEGER, rank.get(p.id) ?? Number.MAX_SAFE_INTEGER))
  }
  return [...best.keys()].sort((a, b) =>
    Number(a === noCategory) - Number(b === noCategory) || best.get(a)! - best.get(b)! || a.localeCompare(b))
}

/** A group's rows, best sellers first, then A–Z. */
export function rankedGroupRows<P extends PickProduct>(products: readonly P[], category: string, rankIds: readonly string[], noCategory = 'Uncategorized'): PickRowGroup<P>[] {
  const rank = rankMap(rankIds)
  const rows = groupRows(products, category, noCategory)
  const at = new Map(rows.map((r, i) => [r.key, i]))
  return rows.map((r) => ({ ...r, topId: r.brand ? topIdOf(r.items, rank) : null }))
    .sort((a, b) => bestRank(a.items, rank) - bestRank(b.items, rank) || at.get(a.key)! - at.get(b.key)!)
}

/** The brand's most-sold size, when the ranking knows one. */
function topIdOf(items: readonly { id: string }[], rank: Map<string, number>): string | null {
  let top: string | null = null
  let best = Number.MAX_SAFE_INTEGER
  for (const it of items) { const r = rank.get(it.id); if (r !== undefined && r < best) { best = r; top = it.id } }
  return top
}

/** A group with more rows than this gets product tabs ("Atta", "Besan", "Maida" inside "Atta & flour"). */
export const TYPE_TABS_FROM = 13
/** A product tab needs at least this many rows; smaller ones stay in "Other". */
export const TYPE_MIN_ROWS = 3

export interface TypeTabs {
  /** Tab names, biggest first, "Other" last. */
  tabs: string[]
  /** Row key → its tab. */
  typeOf: Map<string, string>
}

/**
 * Product tabs read from the row names — the app stores a group, not a product
 * type, and shops name items "<brand> <product>": Aashirvaad Atta, MDH Haldi,
 * Everest Garam Masala, Clinic Plus Shampoo.
 *
 *  1. A row's tab is the LONGEST ending of its name shared by ≥ TYPE_MIN_ROWS
 *     rows ("Garam Masala", not "Masala", which every masala shares).
 *  2. A name with no shared ending goes by its first word, when that is shared
 *     ("Lays", "Kurkure", "Haldiram's" in Snacks).
 *  3. A row still without a tab joins a tab whose name it contains ("Tata
 *     Salt Lite" → "Salt"); the rest are "Other".
 *  4. A small tab whose name ends in a bigger tab's name joins it ("Toor Dal"
 *     → "Dal") unless it is large enough to stand alone.
 *
 * Only navigation hangs on this — a row in an odd tab costs a tap, never a
 * wrong bill — and "All" is always the first tab. No tabs when the group is
 * small, when fewer than two tabs come out, or when "Other" would be most of it.
 */
export function typeTabs<P extends PickProduct>(rows: readonly PickRowGroup<P>[]): TypeTabs | null {
  if (rows.length < TYPE_TABS_FROM) return null
  // "Parle-G" is "Parle" + "G", so it joins the Parle tab.
  const words = rows.map((r) => rowName(r).split(/[\s-]+/).filter(Boolean))
  const key = (ws: string[]) => ws.join(' ').toLowerCase()
  const shown = new Map<string, string>()
  const count = new Map<string, number>()
  const bump = (k: string, label: string) => { count.set(k, (count.get(k) ?? 0) + 1); if (!shown.has(k)) shown.set(k, label) }
  const FIRST = '\u0000first:'
  for (const ws of words) {
    const seen = new Set<string>()
    for (let i = 0; i < ws.length; i++) { const k = key(ws.slice(i)); if (!seen.has(k)) { seen.add(k); bump(k, ws.slice(i).join(' ')) } }
    if (ws.length > 1) bump(FIRST + ws[0].toLowerCase(), ws[0])
  }
  const typeOf = new Map<string, string>()
  rows.forEach((r, n) => {
    const ws = words[n]
    for (let i = 0; i < ws.length; i++) { const k = key(ws.slice(i)); if ((count.get(k) ?? 0) >= TYPE_MIN_ROWS) { typeOf.set(r.key, k); return } }
    const f = FIRST + (ws[0] ?? '').toLowerCase()
    if (ws.length > 1 && (count.get(f) ?? 0) >= TYPE_MIN_ROWS) typeOf.set(r.key, f)
  })
  const chosen = () => [...new Set(typeOf.values())]
  rows.forEach((r, n) => {
    if (typeOf.has(r.key)) return
    const name = ` ${key(words[n])} `
    const hit = chosen().filter((k) => !k.startsWith(FIRST) && name.includes(` ${k} `)).sort((a, b) => b.length - a.length)[0]
    if (hit) typeOf.set(r.key, hit)
  })
  const size = (k: string) => [...typeOf.values()].filter((v) => v === k).length
  for (const k of chosen()) {
    if (k.startsWith(FIRST) || size(k) >= 2 * TYPE_MIN_ROWS) continue
    const parent = chosen().filter((p) => p !== k && !p.startsWith(FIRST) && k.endsWith(` ${p}`)).sort((a, b) => b.length - a.length)[0]
    if (parent) for (const [rk, v] of typeOf) if (v === k) typeOf.set(rk, parent)
  }
  const OTHER = 'Other'
  const out = new Map<string, string>()
  for (const r of rows) {
    const k = typeOf.get(r.key)
    out.set(r.key, k ? shown.get(k)! : OTHER)
  }
  const sizes = new Map<string, number>()
  for (const v of out.values()) sizes.set(v, (sizes.get(v) ?? 0) + 1)
  const others = sizes.get(OTHER) ?? 0
  const tabs = [...sizes.keys()].filter((t) => t !== OTHER).sort((a, b) => sizes.get(b)! - sizes.get(a)! || a.localeCompare(b))
  if (tabs.length < 2 || others * 2 > rows.length) return null
  return { tabs: others ? [...tabs, OTHER] : tabs, typeOf: out }
}

/**
 * #181/#146: while a bill is open the order of "Often sold" is frozen, so a
 * second tap never lands on a row that moved. Moved here from the Counter's
 * tiles (lib/counter-tiles.ts, removed with them).
 */
export function freezeWhileBillOpen<T>(live: T, snapshot: T | undefined, billOpen: boolean): T {
  return billOpen && snapshot !== undefined ? snapshot : live
}
