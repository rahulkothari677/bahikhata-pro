/**
 * Phase 7a — one item search everywhere, every item reachable, the catalog kept
 * on the phone. Guards the WIRING; lib/item-search.ts's behaviour is tested in
 * item-search.test.ts.
 */
import { describe, test, expect } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import { readCode } from '@/test-support/read-source'
import { catalogEtag, CATALOG_FUSE } from '@/lib/catalog-etag'

const at = (code: string, s: string) => { const i = code.indexOf(s); expect({ s, found: i >= 0 }).toEqual({ s, found: true }); return i }

describe('every screen searches items with the one rule (#296)', () => {
  test('the bill screen ranks with itemSearch, lifting the shop\'s best sellers', () => {
    const te = readCode('src/components/ledger/TransactionEntry.tsx')
    expect(te).toContain('itemSearch(productsInCategory, productSearch, { boost: searchBoost })')
    expect(te).toContain('const filteredProducts = productSearchResult.items')
    expect(te).not.toMatch(/matchesProductSearch|\.name\.toLowerCase\(\)\.includes\(/)
    // Close matches are labelled, never passed off as matches.
    expect(te.split('productSearchResult.close &&').length - 1).toBe(2)
  })
  test('the search box finds items on the phone and asks the server only for customers and bills (#287)', () => {
    const gs = readCode('src/components/common/GlobalSearch.tsx')
    expect(gs).toContain("itemSearch((catalogData?.products as any[]) ?? [], query)")
    expect(gs).toContain('&types=parties,transactions')
    expect(gs).toContain("queryKey: ['products', 'for-entry']") // the bill screen's cache, one copy
    // The "Searching…" wall only when there is nothing at all to show yet.
    expect(gs).toContain('searchLoading && q && allResults.length === 0')
    expect(gs).not.toMatch(/productsData/)
    const route = readCode('src/app/api/search/route.ts')
    expect(route).toContain("types.has('products') && canAccessModule(role, permissions, 'inventory')")
  })
  test('the Items list filters with the same rule, not letters anywhere', () => {
    const list = readCode('src/lib/items-list.ts')
    expect(list).toContain('(!opts.search.trim() || matchesProductSearch(p, opts.search)')
    // Phase 7b: a size is also found by its brand's name — through the same rule.
    expect(list).toContain('matchesProductSearch({ id: p.id, name: p.family.name }, opts.search)')
    expect(list).not.toMatch(/\.toLowerCase\(\)\.includes\(/)
  })
  test('matchesProductSearch (the door other code and the scan guard use) is the same rule', () => {
    const fp = readCode('src/lib/find-product-by-code.ts')
    const body = fp.slice(at(fp, 'export function matchesProductSearch'))
    expect(body).toContain('return itemMatches(')
    expect(body).not.toMatch(/\.includes\(q\)/)
  })
})

describe('brands never carry prices (Phase 7b)', () => {
  test('productFamily-include: no query reads sizes THROUGH a brand (they would come back in paise)', () => {
    // ProductFamily has no money handler (audit-money-relations-coverage.test.ts): sizes are read via db.product.
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : [])
    const offenders: string[] = []
    let calls = 0
    for (const f of walk(path.join(process.cwd(), 'src')).filter((f) => !f.includes('__tests__'))) {
      const src = fs.readFileSync(f, 'utf8').replace(/_count:\s*\{\s*select:\s*\{\s*products:\s*true\s*\}\s*\}/g, '')
      for (const m of src.matchAll(/productFamily\.\w+\(/g)) {
        calls++
        const window = src.slice(m.index, (m.index ?? 0) + 500)
        if (/\bproducts\s*:\s*(true|\{)/.test(window)) offenders.push(path.relative(process.cwd(), f))
      }
    }
    expect(calls).toBeGreaterThan(3) // the families routes really are scanned
    expect(offenders).toEqual([])
  })
})

describe('every item reachable, and the catalog kept on the phone (#297)', () => {
  test('the version tag changes with the shop, the count, the newest change and who asks — and only then', () => {
    const d = new Date('2026-10-22T04:00:00Z')
    expect(catalogEtag('u1', 10, d, false)).toBe(catalogEtag('u1', 10, new Date(d), false))
    expect(catalogEtag('u1', 11, d, false)).not.toBe(catalogEtag('u1', 10, d, false))
    expect(catalogEtag('u1', 10, new Date(d.getTime() + 1), false)).not.toBe(catalogEtag('u1', 10, d, false))
    expect(catalogEtag('u1', 10, d, true)).not.toBe(catalogEtag('u1', 10, d, false))
    expect(catalogEtag('u2', 10, d, false)).not.toBe(catalogEtag('u1', 10, d, false)) // two accounts, one phone
    expect(catalogEtag('u1', 0, null, false)).toMatch(/^W\/"items-u1-0-0-full"$/)
    // Phase 7b: a brand renamed (newest change) or deleted (count) changes the tag.
    const fam = (count: number, t: number) => catalogEtag('u1', 10, d, false, { count, newest: new Date(t) })
    expect(fam(2, 1)).toBe(fam(2, 1))
    expect(fam(2, 2)).not.toBe(fam(2, 1))
    expect(fam(1, 1)).not.toBe(fam(2, 1))
  })
  test('the route versions the list by its brands as well, and sends each size its brand', () => {
    const r = readCode('src/app/api/products/route.ts')
    expect(r).toContain('db.productFamily.aggregate({ where: { userId }, _count: { _all: true }, _max: { updatedAt: true } })')
    expect(r).toContain('{ count: famStamp._count._all, newest: famStamp._max.updatedAt }')
    expect(r).toContain('include: { family: { select: { id: true, name: true } } }')
  })
  test('the phone sends its kept copy\'s tag and answers a 304 from that copy', () => {
    const of = readCode('src/lib/offline-fetch.ts')
    const get = of.slice(at(of, 'async function handleGet('))
    expect(of).toContain("const REVALIDATED_PREFIXES = ['/api/products']")
    expect(get).toContain("headers.set('If-None-Match', kept.etag)")
    expect(get).toContain('if (res.status === 304 && kept) {')
    expect(get).toContain("cacheResponse(cacheKey, body, res.headers.get('etag'))")
    expect(readCode('src/lib/offline-db.ts')).toContain('...(etag ? { etag } : {})')
  })
  test('the route answers 304 when the tag matches, and revalidates every time otherwise', () => {
    const r = readCode('src/app/api/products/route.ts')
    const get = r.slice(at(r, 'export async function GET(req: NextRequest)'), at(r, 'export async function POST'))
    expect(get).toContain("if (req.headers.get('if-none-match') === etag)")
    expect(get).toContain('status: 304, headers: cacheHeaders')
    expect(get).toContain("const cacheHeaders = { ETag: etag, 'Cache-Control': CATALOG_CACHE_CONTROL }")
    expect(get).toContain('}, { headers: cacheHeaders })')
    expect(get).not.toMatch(/take:\s*5000|noStore\(/)
    expect(CATALOG_FUSE).toBe(20_000)
  })
})
