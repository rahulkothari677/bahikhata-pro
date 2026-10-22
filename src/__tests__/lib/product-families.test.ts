/**
 * Phase 7b (#293) — brands with sizes: the Items list shows one row per brand,
 * and the routes that group items keep every rule on the server.
 */
import { describe, test, expect } from '@jest/globals'
import { itemsList, groupIntoEntries, isFamilyEntry, entryItems, type ItemRow } from '@/lib/items-list'
import { sizeRank } from '@/lib/product-sizes'
import { readCode } from '@/test-support/read-source'

const now = new Date('2026-10-22T06:00:00Z')
let n = 0
const row = (name: string, extra: Partial<ItemRow> = {}): ItemRow => ({
  id: `p${++n}`, name, category: 'Biscuits', currentStock: 20, isLowStock: false, stockValue: 100,
  createdAt: '2026-01-01', lastSoldAt: null, salesNow: 0, qtyNow: 0, profitNow: 0, tracksInventory: true, ...extra,
})
const size = (fam: string, label: string, extra: Partial<ItemRow> = {}) =>
  row(`${fam} ${label}`, { familyId: `f-${fam}`, family: { id: `f-${fam}`, name: fam }, sizeLabel: label, sizeRank: sizeRank(label), ...extra })

const SHOP = [
  size('Parle-G', '₹50', { salesNow: 10 }), size('Parle-G', '₹5', { salesNow: 900 }), size('Parle-G', '₹10', { salesNow: 400 }),
  row('Oreo ₹30', { salesNow: 500 }),
  size('Aashirvaad Atta', '10 kg', { salesNow: 50, category: 'Atta' }), size('Aashirvaad Atta', '1 kg', { salesNow: 60, category: 'Atta' }),
  row('Sugar (loose)', { salesNow: 5, category: 'Loose' }),
]

describe('one row per brand on the Items list', () => {
  test('a brand is one entry, its sizes small to large, placed where its best size falls in the order', () => {
    const r = itemsList(SHOP, { chip: 'all', search: '', category: null, sort: 'sales', offset: 0, now })
    expect(r.rows.map((e) => (isFamilyEntry(e) ? `${e.name}[${e.members.map((m) => m.sizeLabel).join(',')}]` : e.name)))
      .toEqual(['Parle-G[₹5,₹10,₹50]', 'Oreo ₹30', 'Aashirvaad Atta[1 kg,10 kg]', 'Sugar (loose)'])
    expect(r.matched).toBe(4)        // rows on screen
    expect(r.matchedItems).toBe(7)   // sizes and items
    expect(r.totals.items).toBe(7)   // the shop's figures still count items
  })
  test('a page of 60 is 60 ROWS, so a brand is never split across pages', () => {
    const many = Array.from({ length: 70 }, (_, i) => row(`Item ${String(i).padStart(2, '0')}`))
    const shop = [...many, ...['₹5', '₹10', '₹20'].map((l) => size('Zz Brand', l))]
    const p1 = itemsList(shop, { chip: 'all', search: '', category: null, sort: 'name', offset: 0, now })
    const p2 = itemsList(shop, { chip: 'all', search: '', category: null, sort: 'name', offset: p1.rows.length, now })
    expect(p1.rows).toHaveLength(60)
    expect(p1.hasMore).toBe(true)
    const brand = p2.rows.find(isFamilyEntry)!
    expect(brand.members).toHaveLength(3)
    expect(entryItems([...p1.rows, ...p2.rows])).toHaveLength(73)
  })
  test('a search shows the brand with only the sizes that matched; the brand\'s name finds its sizes', () => {
    const r = itemsList(SHOP, { chip: 'all', search: 'parle 10', category: null, sort: 'sales', offset: 0, now })
    expect(r.rows).toHaveLength(1)
    expect((r.rows[0] as any).members.map((m: ItemRow) => m.sizeLabel)).toEqual(['₹10'])
    const renamed = SHOP.map((p) => (p.familyId === 'f-Parle-G' ? { ...p, family: { id: 'f-Parle-G', name: 'Parle Glucose' } } : p))
    const byBrand = itemsList(renamed, { chip: 'all', search: 'glucose', category: null, sort: 'sales', offset: 0, now })
    expect(entryItems(byBrand.rows)).toHaveLength(3)
  })
  test('items without a brand come back exactly as before', () => {
    const plain = [row('A'), row('B')]
    expect(groupIntoEntries(plain)).toEqual(plain)
  })
})

describe('the brand routes keep every rule on the server', () => {
  const lib = readCode('src/lib/product-families-server.ts')
  const list = readCode('src/app/api/products/families/route.ts')
  const one = readCode('src/app/api/products/families/[id]/route.ts')
  test('only this shop\'s items; one brand per item, refused by name; labels and order worked out here', () => {
    expect(lib).toContain('where: { userId, id: { in: ids } }')
    expect(lib).toContain("if (items.length !== ids.length) throw new FamilyError(")
    expect(lib).toContain('const elsewhere = items.filter((i) => i.familyId && i.familyId !== familyId)')
    expect(lib).toContain('data: { familyId, sizeLabel: label, sizeRank: sizeRank(label) }')
    expect(lib).toContain("name: { equals: clean, mode: 'insensitive' }") // one "Parle-G" per shop
  })
  test('grouping is all-or-nothing; every route checks the brand is this shop\'s', () => {
    expect(list).toContain('await db.$transaction(async (tx) => {')
    expect(list).toContain('validateBody(createFamiliesSchema')
    expect(one.split('if (!(await ownFamily(userId, id)))').length - 1).toBe(2)
    expect(one).toContain('db.productFamily.findFirst({ where: { id, userId }')
  })
  test('ungrouping never deletes an item, and changes every phone\'s list (labels cleared, updatedAt bumped)', () => {
    const del = one.slice(one.indexOf('export async function DELETE'))
    expect(del).toContain('data: { familyId: null, sizeLabel: null, sizeRank: null }')
    expect(del).not.toMatch(/product\.delete/)
    // A rename touches its sizes so the item list's version tag changes.
    expect(one).toContain('await tx.product.updateMany({ where: { userId, familyId: id }, data: { familyId: id } })')
  })
  test('the suggestions are only suggestions: GET saves nothing', () => {
    const get = list.slice(list.indexOf('export async function GET'), list.indexOf('export async function POST'))
    expect(get).not.toMatch(/\.(create|update|updateMany|delete)\(/)
    expect(get).toContain('suggestions: suggestFamilies(items)')
  })
})
