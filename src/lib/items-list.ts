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

export const ITEM_CHIPS = ['all', 'low', 'out', 'dead'] as const
export type ItemChip = (typeof ITEM_CHIPS)[number]
export const ITEM_SORTS = ['sales', 'name', 'stock', 'value'] as const
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
  barcode?: string | null
  sku?: string | null
  hsn?: string | null
  [extra: string]: unknown
}

export function inItemChip(p: ItemRow, chip: ItemChip, now: Date): boolean {
  switch (chip) {
    case 'all': return true
    case 'low': return p.isLowStock && p.currentStock > 0
    case 'out': return tracksStock(p) && p.currentStock <= 0
    case 'dead': return tracksStock(p) && p.currentStock > 0 && ageBucket(stockAgeDays(p.lastSoldAt, p.createdAt, now)) === 'dead'
  }
}

export function itemsList(all: ItemRow[], opts: { chip: ItemChip; search: string; category: string | null; sort: ItemSort; offset: number; now: Date; limit?: number }) {
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
  const scoped = all.filter((p) => (!opts.category || cat(p) === opts.category)
    && (!opts.search.trim() || matchesProductSearch(p, opts.search) || cat(p).toLowerCase().includes(opts.search.trim().toLowerCase())))
  const counts = Object.fromEntries(ITEM_CHIPS.map((c) => [c, scoped.filter((p) => inItemChip(p, c, opts.now)).length])) as Record<ItemChip, number>
  const rows = scoped.filter((p) => inItemChip(p, opts.chip, opts.now))
  const byName = (a: ItemRow, b: ItemRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  const cmp: Record<ItemSort, (a: ItemRow, b: ItemRow) => number> = {
    sales: (a, b) => b.salesNow - a.salesNow || byName(a, b),
    name: byName,
    // A service has no stock: it goes after every stocked item, never at the top of "lowest stock".
    stock: (a, b) => Number(!tracksStock(a)) - Number(!tracksStock(b)) || a.currentStock - b.currentStock || byName(a, b),
    value: (a, b) => (b.stockValue ?? 0) - (a.stockValue ?? 0) || byName(a, b),
  }
  rows.sort(cmp[opts.sort])
  const limit = opts.limit ?? ITEMS_PAGE
  return {
    rows: rows.slice(opts.offset, opts.offset + limit),
    matched: rows.length,
    hasMore: opts.offset + limit < rows.length,
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
