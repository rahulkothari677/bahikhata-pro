/**
 * Phase 6c — the Counter's quick tiles never move under the thumb (#181, #146),
 * fold on a long bill (#229), and the add card never scrolls inside the page
 * (#232).
 */
import { describe, test, expect } from '@jest/globals'
import { counterTiles, foldTiles, freezeWhileBillOpen, TOP_TILES, COUNTER_FOLD_AFTER } from '@/lib/counter-tiles'
import { readCode } from '@/test-support/read-source'

const P = (id: string, name: string, category = 'Grocery') => ({ id, name, category })
const products = [P('sugar', 'Sugar'), P('atta', 'Atta 5kg', 'Flour'), P('milk', 'Milk', 'Dairy'), P('bread', 'Bread', 'Bakery'), P('eggs', 'Eggs', 'Dairy')]

describe('counterTiles', () => {
  test('best sellers first in rank order, then recent, then the rest by name', () => {
    const t = counterTiles(products, { rankIds: ['milk', 'atta'], recentIds: ['eggs'], category: null, limit: 12 })
    expect(t.map((p) => p.id)).toEqual(['milk', 'atta', 'eggs', 'bread', 'sugar'])
  })
  test('the same inputs give the same order whatever order the products came in', () => {
    const a = counterTiles(products, { rankIds: ['atta'], recentIds: [], category: null, limit: 12 })
    const b = counterTiles([...products].reverse(), { rankIds: ['atta'], recentIds: [], category: null, limit: 12 })
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id))
  })
  test('a category shows only its items, ranked first; Top is every item; the limit holds', () => {
    expect(counterTiles(products, { rankIds: ['eggs'], recentIds: [], category: 'Dairy', limit: 24 }).map((p) => p.id)).toEqual(['eggs', 'milk'])
    expect(counterTiles(products, { rankIds: [], recentIds: [], category: TOP_TILES, limit: 2 })).toHaveLength(2)
  })
  test('an id that is not an item (deleted, another shop) is skipped, never shown', () => {
    expect(counterTiles(products, { rankIds: ['ghost', 'milk'], recentIds: ['ghost'], category: null, limit: 12 })[0].id).toBe('milk')
  })
})

describe('#181: no tap moves a tile while a bill is open', () => {
  test('the ranking taken when the bill started is kept until the bill is done', () => {
    const atStart = { rankIds: ['milk', 'atta'], recentIds: [] as string[] }
    const afterTaps = { rankIds: ['atta', 'milk'], recentIds: ['bread'] } // e.g. a refreshed ranking or a new recent item
    const kept = freezeWhileBillOpen(afterTaps, atStart, true)
    expect(kept).toBe(atStart)
    const before = counterTiles(products, { ...atStart, category: null, limit: 12 }).map((p) => p.id)
    const during = counterTiles(products, { ...kept, category: null, limit: 12 }).map((p) => p.id)
    expect(during).toEqual(before)
  })
  test('a new bill (nothing on it) takes the fresh ranking', () => {
    const live = { rankIds: ['atta'], recentIds: [] as string[] }
    expect(freezeWhileBillOpen(live, { rankIds: ['milk'], recentIds: [] }, false)).toBe(live)
    expect(freezeWhileBillOpen(live, undefined, true)).toBe(live) // nothing kept yet: use what there is
  })
})

describe('#229: tiles fold on a long bill', () => {
  const tiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  test(`up to ${COUNTER_FOLD_AFTER} lines: every tile; after that: one row, unless asked`, () => {
    expect(foldTiles(tiles, COUNTER_FOLD_AFTER, false, 3)).toEqual({ shown: tiles, folded: false })
    expect(foldTiles(tiles, COUNTER_FOLD_AFTER + 1, false, 3)).toEqual({ shown: ['a', 'b', 'c'], folded: true })
    expect(foldTiles(tiles, 20, true, 3)).toEqual({ shown: tiles, folded: false })
    expect(foldTiles(['a', 'b'], 20, false, 3)).toEqual({ shown: ['a', 'b'], folded: false })
  })
})

describe('the Counter on the sale screen', () => {
  const code = readCode('src/components/ledger/TransactionEntry.tsx')
  const at = (s: string) => { const i = code.indexOf(s); expect({ s, found: i >= 0 }).toEqual({ s, found: true }); return i }
  test('the tiles come from the frozen ranking, re-frozen whenever a bill is open', () => {
    expect(code).toContain('freezeWhileBillOpen(liveTileRanking, tileRankingRef.current, items.length > 0)')
    expect(code).toContain('counterTiles(products, {')
    expect(code).toContain('...tileRanking,')
  })
  test('only a plain sale is a Counter (returns, estimates, purchases keep their form)', () => {
    expect(code).toContain("const counterMode = actualType === 'sale' && !estimateMode")
  })
  test('#232: the Counter\'s add card never scrolls inside the page', () => {
    const card = code.slice(at('aria-label="Search items"'), at('function PickRow'))
    const addCard = card.slice(0, card.indexOf('</Card>'))
    expect(addCard.length).toBeGreaterThan(500)
    expect(addCard).not.toMatch(/overflow-y-auto|max-h-/)
    expect(addCard).toContain('<CounterTile')
    expect(addCard).toContain('tilesFolded &&')
  })
  test('one row component for every pick list (no second copy of the item row)', () => {
    expect(code.split('<PickRow').length - 1).toBe(2)
    expect(code.split('aria-label={qty > 0 ? `Add another ${p.name}` : `Add ${p.name}`}').length - 1).toBe(2) // PickRow + CounterTile
  })
})

describe('/api/products/top-sellers', () => {
  const route = readCode('src/app/api/products/top-sellers/route.ts')
  test('ranks by bills, from this shop\'s live sales only, counted by the database', () => {
    expect(route).toContain('ORDER BY COUNT(DISTINCT t."id") DESC')
    expect(route).toContain('t."userId" = ${authCtx.userId}')
    expect(route).toContain('p."userId" = ${authCtx.userId}')
    expect(route).toContain('t."deletedAt" IS NULL')
    expect(route).toContain(`t."type" = 'sale'`)
    expect(route).toContain("canAccessModule(authCtx.role, authCtx.permissions, 'sales')")
  })
})
