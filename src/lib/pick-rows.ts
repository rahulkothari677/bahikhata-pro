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
import { bySize } from './product-sizes'

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

/** How many rows a search shows before it says "8 of N, keep typing". */
export const SEARCH_ROWS = 8
/** Rows under "Often sold". */
export const OFTEN_ROWS = 8
/** Rows under "<customer> usually buys". */
export const USUAL_ROWS = 5
/** A group's list grows 60 rows at a time; never cut without a "show more". */
export const GROUP_PAGE = 60
/** After this many bill lines, "Often sold" folds to one line so the bill shows (#229). */
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

/** The groups (categories) with how many ROWS each shows, A–Z. */
export function pickGroups<P extends PickProduct>(products: readonly P[], noCategory = 'Uncategorized'): { name: string; rows: number; items: number }[] {
  const items = new Map<string, number>()
  const brands = new Map<string, Set<string>>()
  for (const p of products) {
    const c = p.category || noCategory
    items.set(c, (items.get(c) ?? 0) + 1)
    if (!brands.has(c)) brands.set(c, new Set())
    brands.get(c)!.add(p.familyId ? `f:${p.familyId}` : p.id)
  }
  return [...items].map(([name, n]) => ({ name, items: n, rows: brands.get(name)!.size }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * #181/#146: while a bill is open the order of "Often sold" is frozen, so a
 * second tap never lands on a row that moved. Moved here from the Counter's
 * tiles (lib/counter-tiles.ts, removed with them).
 */
export function freezeWhileBillOpen<T>(live: T, snapshot: T | undefined, billOpen: boolean): T {
  return billOpen && snapshot !== undefined ? snapshot : live
}
