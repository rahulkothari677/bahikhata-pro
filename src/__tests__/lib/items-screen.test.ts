/**
 * 🔒 GUARD: the Items screen counts on the server, over every item
 * (Phase 5e-2, ledger model v4: "a count from the database, never from the
 * rows on screen"). It used to load up to 5,000 products and add up the stock
 * value, the categories and the low/out counts on the phone.
 */
import { describe, test, expect } from '@jest/globals'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'
import { ITEM_CHIPS, ITEM_SORTS } from '@/lib/items-list'

describe('Items', () => {
  const screen = readCode('src/components/inventory/Inventory.tsx')
  const route = readCode('src/app/api/products/list/route.ts')
  const products = readCode('src/app/api/products/route.ts')
  test('the screen pages the server list and sums nothing itself', () => {
    expect(screen).toMatch(/offlineFetch\(`\/api\/products\/list\?\$\{qp\}`\)/)
    expect(screen).not.toMatch(/\.reduce\(/)
    expect(screen).not.toMatch(/['`]\/api\/products['`?]/)
    expect(screen).not.toMatch(/findProductByScannedCode\(products/)
    expect(screen).toMatch(/getNextPageParam: \(last: any\) => \(last\.hasMore/)
  })
  test('the route uses the shared stock view, the shared profit rule and the tested list logic', () => {
    expect(route).toMatch(/withStockView\(p, hideProfit\)/)
    expect(route).toMatch(/itemsList\(rows, \{ chip, search, category, sort, offset, now \}\)/)
    expect(route).toMatch(/hideProfit \? null : roundMoney\(products\.reduce\(\(s, p\) => s \+ stockPotentialProfit\(p, profitOpts\)/)
    expect(route).toMatch(/\$\{LINE_TAXABLE_SQL\}/)
    // The pickers' list shows stock the same way — one view, two routes.
    expect(products).toMatch(/withStockView\(/)
  })
  test('every Items word exists in English and Hindi', () => {
    const en = translations.en as unknown as Record<string, string>, hi = translations.hi as unknown as Record<string, string>
    const need = ['items.sort', 'items.show', ...ITEM_SORTS.map((s) => `items.sort.${s}`), ...ITEM_CHIPS.map((c) => `items.chip.${c}`)]
    expect(need.filter((k) => !en[k])).toEqual([])
    expect(need.filter((k) => !hi[k])).toEqual([])
  })
})
