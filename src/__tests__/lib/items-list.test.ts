/**
 * 🔒 GUARD: Items — every item, counted over all of them (Phase 5e-2).
 *
 * The Items screen loaded up to 5,000 products and worked out counts, stock
 * value and categories itself. Now the server pages 60 at a time and the
 * counts, totals and categories cover every item. "Not sold in 90 days" is
 * the shared stock-aging rule (Insights, Inventory Aging).
 */
import { describe, test, expect } from '@jest/globals'
import { inItemChip, itemsList, ITEM_CHIPS, type ItemRow } from '@/lib/items-list'

const now = new Date('2026-10-19T06:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
const I = (id: string, extra: Partial<ItemRow> = {}): ItemRow => ({
  id, name: id, category: 'Grocery', currentStock: 10, tracksInventory: true, isLowStock: false, stockValue: 100,
  createdAt: daysAgo(400), lastSoldAt: daysAgo(2), salesNow: 0, qtyNow: 0, ...extra,
})

const shop: ItemRow[] = [
  I('Atta', { salesNow: 5342.91, stockValue: 9600 }),
  I('Dal', { salesNow: 700, category: 'Pulses' }),
  I('Lays', { currentStock: 3, isLowStock: true, salesNow: 78.46 }),
  I('Soap', { currentStock: 0, isLowStock: true, stockValue: 0 }),
  I('Old honey', { lastSoldAt: daysAgo(120), stockValue: 500 }),
  I('New tea', { lastSoldAt: null, createdAt: daysAgo(5) }),
  I('Haircut', { tracksInventory: false, currentStock: 0, isLowStock: false, stockValue: 0, category: null }),
]

describe('chips', () => {
  test('low = running low but not out; out = stocked item at 0 or below; services are never out', () => {
    expect(shop.filter((p) => inItemChip(p, 'low', now)).map((p) => p.id)).toEqual(['Lays'])
    expect(shop.filter((p) => inItemChip(p, 'out', now)).map((p) => p.id)).toEqual(['Soap'])
  })
  test('not sold in 90 days: in stock, no sale in 90 days, and on the books that long', () => {
    expect(shop.filter((p) => inItemChip(p, 'dead', now)).map((p) => p.id)).toEqual(['Old honey'])
  })
})

describe('the list', () => {
  const r = itemsList(shop, { chip: 'all', search: '', category: null, sort: 'sales', offset: 0, now })
  test('counts and totals over every item; categories with their stock value', () => {
    expect(r.counts).toEqual({ all: 7, low: 1, out: 1, dead: 1 })
    expect(r.totals).toEqual({ items: 7, stockValue: 10400, out: 1, low: 1 })
    expect(r.categories.find((c) => c.name === 'Uncategorized')).toEqual({ name: 'Uncategorized', count: 1, value: 0 })
  })
  test('best sellers first', () => {
    expect(r.rows.slice(0, 3).map((p) => p.id)).toEqual(['Atta', 'Dal', 'Lays'])
  })
  test('most profit this month first (5e-4)', () => {
    const withProfit = shop.map((p, i) => ({ ...p, profitNow: [120, 30, 800, 0, -40, 5, 60][i] }))
    expect(itemsList(withProfit, { chip: 'all', search: '', category: null, sort: 'profit', offset: 0, now }).rows.slice(0, 3).map((p) => p.id)).toEqual(['Lays', 'Atta', 'Haircut'])
  })
  test('lowest stock first: stocked items by stock, a service (no stock) last', () => {
    const s = itemsList(shop, { chip: 'all', search: '', category: null, sort: 'stock', offset: 0, now }).rows.map((p) => p.id)
    expect(s.slice(0, 2)).toEqual(['Soap', 'Lays'])
    expect(s[s.length - 1]).toBe('Haircut')
  })
  test('a category and a search narrow the list and the counts, not the shop totals', () => {
    const p = itemsList(shop, { chip: 'all', search: '', category: 'Pulses', sort: 'name', offset: 0, now })
    expect([p.rows.map((x) => x.id), p.counts.all, p.totals.items]).toEqual([['Dal'], 1, 7])
    expect(itemsList(shop, { chip: 'all', search: 'pulses', category: null, sort: 'name', offset: 0, now }).rows.map((x) => x.id)).toEqual(['Dal'])
  })
  test('staff who may not see profit get no stock value — null in the totals and every category, never ₹0', () => {
    const hidden = shop.map((p) => ({ ...p, stockValue: undefined }))
    const h = itemsList(hidden, { chip: 'all', search: '', category: null, sort: 'name', offset: 0, now })
    expect(h.totals.stockValue).toBeNull()
    expect(h.categories.length).toBeGreaterThan(1)
    expect(h.categories.map((c) => c.value)).toEqual(h.categories.map(() => null))
    expect(r.categories.every((c) => typeof c.value === 'number')).toBe(true)
  })
  test('pages of 60 cover every item once; every chip count equals its rows', () => {
    const many = Array.from({ length: 130 }, (_, i) => I(`i${String(i).padStart(3, '0')}`, { currentStock: i % 7, isLowStock: i % 7 < 2 }))
    const seen: string[] = []
    for (let offset = 0, more = true; more; offset += 60) {
      const page = itemsList(many, { chip: 'all', search: '', category: null, sort: 'name', offset, now })
      seen.push(...page.rows.map((x) => x.id)); more = page.hasMore
    }
    expect(seen).toEqual(many.map((x) => x.id))
    const all = itemsList(many, { chip: 'all', search: '', category: null, sort: 'name', offset: 0, now, limit: 1000 })
    for (const chip of ITEM_CHIPS) expect(itemsList(many, { chip, search: '', category: null, sort: 'name', offset: 0, now, limit: 1000 }).rows.length).toBe(all.counts[chip])
  })
})
