/**
 * Phase 7c (#294, #295, #298) — one bill picker for every bill. Replaces the
 * Counter's tile tests (counter-tiles.test.ts) and keeps what they guarded:
 * the order never moves under a finger (#181, #146), a long bill keeps the bill
 * in view (#229), the list window never fights the page (#232, rewritten for
 * C11), one row component.
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
  test('rows come from lib/pick-rows.ts; search rows say "30 of N"; a long bill shortens the list window (#229)', () => {
    expect(picker).toContain('const found = useMemo(() => (searching ? groupPickRows(p.result.items) : []), [searching, p.result])')
    expect(picker).toContain('{SEARCH_ROWS} of {found.length} shown · keep typing')
    expect(picker).toContain('const folded = p.billLines > FOLD_AFTER_LINES')
    expect(picker).toContain('setWinH(Math.min(folded ? WINDOW_FOLDED : WINDOW_MAX, Math.max(WINDOW_MIN, room)))')
    expect(picker).toContain('rankedGroupRows(p.products, tab, p.oftenIds)')
  })
  test('#232, rewritten for C11: the list window is the box that scrolls in the page — tall, and a swipe in it never drags the page', () => {
    // #232 was a 4-row box inside the page that a thumb fought with. The List design
    // Rahul chose (22–24 Oct) is built on a list window, so the rule now holds what made
    // #232 bad: the window is at least 300 px tall and keeps its scroll to itself.
    const boxes = picker.match(/overflow-y-auto[^'"]*/g) ?? []
    expect(boxes.length).toBe(2) // the window, and Side view's group column
    for (const box of boxes) expect(box).toContain('overscroll-contain')
    expect(picker).toContain("'h-[45vh] min-h-[300px] max-h-[440px] lg:h-[440px] lg:max-h-none'")
    // Measured on a phone: never under 300 px, folded or not.
    expect(picker).toContain('const WINDOW_MIN = 300')
    expect(picker).toContain('const WINDOW_FOLDED = 300')
    // Choosing a group on a phone parks the tabs under the top bar, so no row hides under the total bar.
    expect(picker).toContain("const go = (t: string) => { setPicked(t); setSub('All'); top(); park() }")
  })
  test('one row shape for every product and one size button — every add says "Add <name>"', () => {
    expect(picker.split('aria-label={qty > 0 ? `Add another ${it.name}` : `Add ${it.name}`}').length - 1).toBe(1)
    expect(te).not.toMatch(/function PickRow|function SizeButton|function ListRow/)
    expect(picker).not.toMatch(/function PickRow|function BrandRow|function GroupsSheet/)
  })
  test('sizes show in a 48 px button with their price, the most-sold size marked, stock said', () => {
    const size = picker.slice(picker.indexOf('function SizeButton'))
    expect(size).toContain("'min-h-12 min-w-12 px-2 rounded-lg border")
    expect(size).toContain("top ? 'border-primary/60 bg-primary/5")
    expect(size).toContain("out ? 'out' : low ? `${stock} left`")
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
