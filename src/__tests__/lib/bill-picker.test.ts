/**
 * Phase 7c (#294, #295, #298) — one bill picker for every bill. Replaces the
 * Counter's tile tests (counter-tiles.test.ts) and keeps what they guarded:
 * the order never moves under a finger (#181, #146), suggestions fold on a long
 * bill (#229), nothing scrolls inside the page (#232), one row component.
 */
import { describe, test, expect } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import { readCode } from '@/test-support/read-source'

const te = readCode('src/components/ledger/TransactionEntry.tsx')
const picker = readCode('src/components/ledger/ItemPicker.tsx')

describe('one picker, one layout, for every bill type (#298)', () => {
  test('the bill screen draws the ItemPicker once, for sale, purchase, estimate and return alike', () => {
    expect(te.split('<ItemPicker').length - 1).toBe(1)
    expect(te).not.toMatch(/\{!counterMode && \(\s*<div className="p-3 sm:p-4 border-b/)
    expect(te).toContain("oftenLabel={isSale ? 'Often sold' : 'Often bought'}")
    expect(te).toContain('priceOf={(p) => (isSale ? p.salePrice : p.purchasePrice)}')
  })
  test('the tiles and the old picker are gone (no grid, no category drop-down, no scroll box)', () => {
    expect(te).not.toMatch(/CounterTile|counterTiles|tileChip|TOP_TILES|selectedCategory|recentProducts/)
    expect(fs.existsSync(path.join(process.cwd(), 'src/lib/counter-tiles.ts'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'src/components/common/ProductPicker.tsx'))).toBe(false) // #300
  })
  test('the 7 Aug order on a phone for every bill: customer 1, picker + bill 2, details 3, summary 4, notes 5', () => {
    expect(te).toContain('<Card className="shadow-card border-border/60 order-1 lg:order-none py-0">')
    expect(te).toContain('<Card className="shadow-card border-border/60 order-2 lg:order-none py-0">')
    expect(te).toContain('<Card className="shadow-card border-border/60 lg:order-none order-3 py-0">')
    expect(te).toContain('<Card className="shadow-card border-border/60 sticky top-20 lg:order-none order-4 py-0">')
    expect(te).not.toMatch(/counterMode \? 'order-\d'/)
    expect(te).toContain('lg:grid lg:gap-4 lg:grid-cols-3')
  })
})

describe('what the picker shows', () => {
  test('"Often sold" comes from the frozen ranking, re-frozen whenever a bill is open (#181)', () => {
    expect(te).toContain('const oftenIds = freezeWhileBillOpen(liveOftenIds, oftenRef.current, items.length > 0)')
    expect(te).toContain('/api/products/top-sellers?type=${pickType}&partyId=${encodeURIComponent(partyId)}')
    expect(te).toContain('return ranked.length ? ranked : getRecentProductIds()') // a new shop: this phone's recent items
  })
  test('rows come from lib/pick-rows.ts: search rows say "8 of N"; a long bill folds the suggestions (#229)', () => {
    expect(picker).toContain('const rows = useMemo(() => groupPickRows(p.result.items), [p.result])')
    expect(picker).toContain('{SEARCH_ROWS} of {rows.length} shown · keep typing')
    expect(picker).toContain('const folded = p.billLines > FOLD_AFTER_LINES && !expanded')
    expect(picker).toContain('{shown} of {rows.length} shown · show more') // a group is never cut
  })
  test('#232: nothing scrolls inside the page — only the Groups sheet scrolls, as a sheet', () => {
    const page = picker.slice(0, picker.indexOf('function GroupsSheet'))
    expect(page).not.toMatch(/overflow-y-auto|max-h-/)
    expect(picker.split('overflow-y-auto').length - 1).toBe(1)
  })
  test('one row component per kind: PickRow for an item, SizeButton for a size — every add says "Add <name>"', () => {
    expect(picker.split('aria-label={qty > 0 ? `Add another ${p.name}` : `Add ${p.name}`}').length - 1).toBe(1)
    expect(picker.split('aria-label={qty > 0 ? `Add another ${it.name}` : `Add ${it.name}`}').length - 1).toBe(1)
    expect(te).not.toMatch(/function PickRow|function SizeButton/)
  })
  test('sizes show in a 48 px button with their price, the most-sold size marked, out of stock said', () => {
    const size = picker.slice(picker.indexOf('function SizeButton'), picker.indexOf('export function PickRow'))
    expect(size).toContain("'min-h-12 rounded-lg border px-3")
    expect(size).toContain("top ? 'border-primary/60 bg-primary/5")
    expect(size).toContain('{out && qty === 0 && <span className="text-xs font-medium text-bad">out</span>}')
  })
})

describe('/api/products/top-sellers (Often sold, Often bought, usually buys)', () => {
  const route = readCode('src/app/api/products/top-sellers/route.ts')
  test('ranks by bills, this shop\'s live bills only, counted by the database', () => {
    expect(route).toContain('ORDER BY COUNT(DISTINCT t."id") DESC')
    expect(route).toContain('t."userId" = ${authCtx.userId}')
    expect(route).toContain('p."userId" = ${authCtx.userId}')
    expect(route).toContain('t."deletedAt" IS NULL')
    expect(route).toContain('t."type" = ${type}')
  })
  test('purchases need the purchases permission; a party narrows to its own bills', () => {
    expect(route).toContain("type === 'purchase' ? 'purchases' : 'sales'")
    expect(route).toContain('AND (${partyId}::text IS NULL OR t."partyId" = ${partyId})')
  })
})
