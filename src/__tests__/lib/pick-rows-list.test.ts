/**
 * Phase 7c, change C11 — the List design's rows, tested on a big general store
 * (test-support/big-shop-catalog.ts: 1,211 items, the shop of the design demo
 * Rahul chose from). Groups are tabs, a big group gets product tabs, rows run
 * best sellers first, and a loose good sits with its packed brands.
 */
import { describe, test, expect } from '@jest/globals'
import { bigShopCatalog } from '@/test-support/big-shop-catalog'
import { groupRows, rankedGroupRows, listGroups, typeTabs, rowName, TYPE_TABS_FROM, type PickProduct } from '@/lib/pick-rows'

const items: (PickProduct & { unit: string })[] = bigShopCatalog().map((c, i) => ({
  id: `p${i}`, name: c.name, category: c.category, unit: c.unit,
  familyId: c.family ? `f:${c.family}` : null, family: c.family ? { id: `f:${c.family}`, name: c.family } : null,
  sizeLabel: c.sizeLabel ?? null, sizeRank: i,
}))
const idOf = (name: string) => items.find((p) => p.name === name)!.id
const tabsOf = (group: string) => {
  const t = typeTabs(groupRows(items, group))
  if (!t) return null
  return Object.fromEntries(t.tabs.map((tab) => [tab, groupRows(items, group).filter((r) => t.typeOf.get(r.key) === tab).map(rowName)]))
}

describe('the shop', () => {
  test('is big: over 1,000 items in about 320 rows across 14 groups', () => {
    expect(items.length).toBeGreaterThan(1000)
    expect(listGroups(items, []).length).toBe(14)
  })
})

describe('rowName — what a row is called', () => {
  test('a brand by its name; an item on its own without its size or "(loose)"', () => {
    const one = (name: string) => ({ key: name, brand: null, items: [{ id: name, name }] })
    expect(rowName({ key: 'f', brand: { id: 'f', name: 'Parle-G' }, items: [] })).toBe('Parle-G')
    expect(rowName(one('Sugar (loose)'))).toBe('Sugar')
    expect(rowName(one('Tata Salt 1kg'))).toBe('Tata Salt')
    expect(rowName(one('Eggs'))).toBe('Eggs')
  })
})

describe('listGroups — the group tabs', () => {
  test('groups holding the best sellers come first, by their best seller; then A–Z; no group last', () => {
    const withLoose = [...items, { id: 'x', name: 'Carry bag', category: null, unit: 'pcs' }]
    const g = listGroups(withLoose, [idOf('Lays Classic Salted ₹10'), idOf('Tata Salt 1 kg')])
    expect(g.slice(0, 3)).toEqual(['Snacks', 'Sugar & salt', 'Atta & flour'])
    expect(g[g.length - 1]).toBe('Uncategorized')
  })
})

describe('rankedGroupRows — a group\'s rows', () => {
  test('best sellers first, then A–Z; the most-sold size is marked', () => {
    const rows = rankedGroupRows(items, 'Atta & flour', [idOf('Fortune Besan 1 kg'), idOf('Aashirvaad Atta 5 kg')])
    expect(rows.slice(0, 2).map(rowName)).toEqual(['Fortune Besan', 'Aashirvaad Atta'])
    expect(rows[1].topId).toBe(idOf('Aashirvaad Atta 5 kg'))
    expect(rows[2].topId).toBeNull()
    expect(rows.length).toBe(groupRows(items, 'Atta & flour').length) // nothing dropped
  })
})

describe('typeTabs — product tabs inside a big group', () => {
  test('Spices (120 rows) splits into its 12 products, 10 brands each — "Garam Masala", never one "Masala" tab of 60', () => {
    const t = tabsOf('Spices')!
    expect(Object.keys(t)).toHaveLength(12)
    expect(Object.values(t).every((rows) => rows.length === 10)).toBe(true)
    expect(t['Garam Masala']).toContain('MDH Garam Masala')
    expect(t.Masala).toBeUndefined()
  })
  test('loose goods sit in their product\'s tab: Chakki Atta with the atta brands, Besan (loose) with besan', () => {
    const t = tabsOf('Atta & flour')!
    expect(Object.keys(t)).toEqual(['Atta', 'Besan', 'Maida', 'Suji'])
    expect(t.Atta).toContain('Chakki Atta')
    expect(t.Besan).toContain('Besan')
  })
  test('names with no shared product word go by brand (Snacks), Parle-G joins Parle, small tabs join a bigger one (Toor Dal → Dal)', () => {
    expect(Object.keys(tabsOf('Snacks')!)).toEqual(['Haldiram\'s', 'Lays', 'Bikaji', 'Kurkure', 'Other'])
    expect(tabsOf('Biscuits')!.Parle).toContain('Parle-G')
    const rice = tabsOf('Rice & dal')!
    expect(rice.Dal).toEqual(expect.arrayContaining(['Toor Dal', 'Tata Sampann Toor Dal', 'Moong Dal']))
    expect(rice['Toor Dal']).toBeUndefined()
  })
  test('no tabs for a small group; "Other" never holds most of a group', () => {
    expect(groupRows(items, 'Dairy & bread').length).toBeLessThan(TYPE_TABS_FROM)
    expect(tabsOf('Dairy & bread')).toBeNull()
    for (const g of listGroups(items, [])) {
      const t = tabsOf(g)
      if (t?.Other) expect(t.Other.length * 2).toBeLessThanOrEqual(groupRows(items, g).length)
    }
  })
})
