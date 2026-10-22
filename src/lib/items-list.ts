/**
 * Items — every item, with search, sort, category and group chips (Phase
 * 5e-2, ledger model v4 §7). Pure, so it is tested; /api/products/list feeds it
 * every product with the shared stock view (lib/product-stock.ts) and returns
 * 60 rows, with every chip's count and the totals worked out over ALL items.
 *
 * Replaces the Items screen loading up to 5,000 products and working out the
 * counts, stock value and categories on the phone.
 *
 * "Not sold in 90 days" is lib/stock-aging.ts — the same rule as Insights and
 * the Inventory Aging report: in stock, no sale in 90 days, on the books that
 * long.
 */
import { matchesProductSearch } from './find-product-by-code'
import { ageBucket, stockAgeDays } from './stock-aging'
import { tracksStock } from './inventory-tracking'
import { bySize } from './product-sizes'

export const ITEM_CHIPS = ['all', 'low', 'out', 'dead'] as const
export type ItemChip = (typeof ITEM_CHIPS)[number]
/** Ledger model v4: by sales, profit, stock value or name — and lowest stock first, for reordering. */
export const ITEM_SORTS = ['sales', 'profit', 'value', 'name', 'stock'] as const
export type ItemSort = (typeof ITEM_SORTS)[number]
export const ITEMS_PAGE = 60
export const NO_CATEGORY = 'Uncategorized'

export interface ItemRow {
  id: string
  name: string
  category?: string | null
  currentStock: number
  tracksInventory?: boolean | null
  isLowStock: boolean
  stockValue?: number
  createdAt: string | Date
  /** Last sale, ISO; null when never sold. */
  lastSoldAt: string | null
  /** This month's sales before GST, net of returns, and quantity. */
  salesNow: number
  qtyNow: number
  /** This month's profit; undefined for staff who may not see profit. */
  profitNow?: number
  barcode?: string | null
  sku?: string | null
  hsn?: string | null
  /** Phase 7b: the brand this item is one size of, and the size. */
  familyId?: string | null
  family?: { id: string; name: string } | null
  sizeLabel?: string | null
  sizeRank?: number | null
  [extra: string]: unknown
}

/**
 * Phase 7b (#293): one row per brand. A brand's matching sizes travel as one
 * entry, in size order, placed where its best-placed size falls in the chosen
 * order; an item without a brand is its own entry, exactly as before.
 */
export interface FamilyEntry {
  kind: 'family'
  id: string
  name: string
  members: ItemRow[]
}
export type ItemsEntry = ItemRow | FamilyEntry

export const isFamilyEntry = (e: ItemsEntry): e is FamilyEntry => (e as FamilyEntry).kind === 'family'

/** Every item in a page of entries (a brand's sizes included) — for "open this item" lookups. */
export const entryItems = (entries: readonly ItemsEntry[]): ItemRow[] =>
  entries.flatMap((e) => (isFamilyEntry(e) ? e.members : [e]))

export function groupIntoEntries(sorted: readonly ItemRow[]): ItemsEntry[] {
  const out: ItemsEntry[] = []
  const fams = new Map<string, FamilyEntry>()
  for (const p of sorted) {
    if (!p.familyId) { out.push(p); continue }
    let f = fams.get(p.familyId)
    if (!f) {
      f = { kind: 'family', id: p.familyId, name: p.family?.name ?? p.name, members: [] }
      fams.set(p.familyId, f)
      out.push(f)
    }
    f.members.push(p)
  }
  for (const f of fams.values()) f.members.sort(bySize)
  return out
}

export function inItemChip(p: ItemRow, chip: ItemChip, now: Date): boolean {
  switch (chip) {
    case 'all': return true
    case 'low': return p.isLowStock && p.currentStock > 0
    case 'out': return tracksStock(p) && p.currentStock <= 0
    case 'dead': return tracksStock(p) && p.currentStock > 0 && ageBucket(stockAgeDays(p.lastSoldAt, p.createdAt, now)) === 'dead'
  }
}

export function itemsList(all: ItemRow[], opts: { chip: ItemChip; search: string; category: string | null; sort: ItemSort; offset: number; now: Date; limit?: number; focusIds?: Set<string> | null }) {
  const cat = (p: ItemRow) => p.category || NO_CATEGORY
  // Categories of the whole shop (with what their stock is worth), for the category list.
  const catMap = new Map<string, { count: number; value: number }>()
  for (const p of all) {
    const c = catMap.get(cat(p)) ?? { count: 0, value: 0 }
    c.count += 1; c.value += Math.round((p.stockValue ?? 0) * 100)
    catMap.set(cat(p), c)
  }
  // Staff who may not see profit get no stock value (it is at cost) — null, never a ₹0 that reads as a fact.
  const hidden = all.some((p) => p.stockValue === undefined)
  const categories = [...catMap].sort((a, b) => a[0].localeCompare(b[0])).map(([name, c]) => ({ name, count: c.count, value: hidden ? null : c.value / 100 }))
  // A group opened from Insights (lib/list-focus.ts) narrows the list and its counts like a search — never the shop totals.
  const scoped = all.filter((p) => (!opts.focusIds || opts.focusIds.has(p.id)) && (!opts.category || cat(p) === opts.category)
    // Phase 7a: the app's one item search (it already counts the item's group), never letters anywhere.
    // Phase 7b: a size is found by its brand's name too ("Parle Glucose" finds "Parle-G ₹10" once grouped so).
    && (!opts.search.trim() || matchesProductSearch(p, opts.search)
      || (!!p.family?.name && matchesProductSearch({ id: p.id, name: p.family.name }, opts.search))))
  const counts = Object.fromEntries(ITEM_CHIPS.map((c) => [c, scoped.filter((p) => inItemChip(p, c, opts.now)).length])) as Record<ItemChip, number>
  const rows = scoped.filter((p) => inItemChip(p, opts.chip, opts.now))
  const byName = (a: ItemRow, b: ItemRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  const cmp: Record<ItemSort, (a: ItemRow, b: ItemRow) => number> = {
    sales: (a, b) => b.salesNow - a.salesNow || byName(a, b),
    profit: (a, b) => (b.profitNow ?? 0) - (a.profitNow ?? 0) || byName(a, b),
    name: byName,
    // A service has no stock: it goes after every stocked item, never at the top of "lowest stock".
    stock: (a, b) => Number(!tracksStock(a)) - Number(!tracksStock(b)) || a.currentStock - b.currentStock || byName(a, b),
    value: (a, b) => (b.stockValue ?? 0) - (a.stockValue ?? 0) || byName(a, b),
  }
  rows.sort(cmp[opts.sort])
  // Phase 7b: one entry per brand (its matching sizes inside), so a page of 60 is 60 rows on screen.
  const entries = groupIntoEntries(rows)
  const limit = opts.limit ?? ITEMS_PAGE
  return {
    rows: entries.slice(opts.offset, opts.offset + limit),
    matched: entries.length,
    /** Items (sizes) that matched — a brand with 4 matching sizes is 1 row and 4 items. */
    matchedItems: rows.length,
    hasMore: opts.offset + limit < entries.length,
    counts,
    categories,
    // The whole shop's figures — what the card above the list says.
    totals: {
      items: all.length,
      stockValue: hidden ? null : all.reduce((s, p) => s + Math.round((p.stockValue ?? 0) * 100), 0) / 100,
      out: all.filter((p) => inItemChip(p, 'out', opts.now)).length,
      low: all.filter((p) => inItemChip(p, 'low', opts.now)).length,
    },
  }
}
