/**
 * 🔒 GUARD: one rule for how long stock has sat unsold (Phase 5c-4).
 *
 * Inventory Aging aged stock by the item's created date — which the stock data
 * never carried — so every item read "Fresh" and Dead Stock was always empty,
 * while searching "dead stock" led there. Its CSV read two fields nothing set.
 * Insights counted "no sale in 90 days" with no added-date rule. Now one rule
 * (lib/stock-aging.ts) for the report, its CSV and the insights engine.
 */
import { describe, test, expect } from '@jest/globals'
import { ageBucket, stockAgeDays, DEAD_DAYS, SLOW_DAYS } from '@/lib/stock-aging'
import { agedStock } from '@/components/reports/InventoryAgingReport'
import { readCode } from '@/test-support/read-source'

const now = new Date('2026-10-19T06:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

describe('the rule', () => {
  test('age is days since the last sale; never sold → since it was added; neither → unknown', () => {
    expect(stockAgeDays(daysAgo(10), daysAgo(400), now)).toBe(10)
    expect(stockAgeDays(null, daysAgo(7), now)).toBe(7)
    expect(stockAgeDays(null, null, now)).toBeNull()
    expect(stockAgeDays('junk', null, now)).toBeNull()
  })
  test('buckets: under 30 fresh, 30–89 slow, 90 and over dead', () => {
    expect([0, 29, 30, 89, 90, 400].map(ageBucket)).toEqual(['fresh', 'fresh', 'slow', 'slow', 'dead', 'dead'])
    expect(ageBucket(null)).toBeNull()
    expect([SLOW_DAYS, DEAD_DAYS]).toEqual([30, 90])
  })
  test('the report ages only stock on the shelf, by its last sale — a best seller added long ago is fresh', () => {
    const rows = agedStock([
      { id: 'a', name: 'Atta', currentStock: 40, createdAt: daysAgo(400), lastSoldAt: daysAgo(1) },
      { id: 'b', name: 'Old soap', currentStock: 5, createdAt: daysAgo(400), lastSoldAt: daysAgo(120) },
      { id: 'c', name: 'New tea', currentStock: 9, createdAt: daysAgo(5), lastSoldAt: null },
      { id: 'd', name: 'Gone', currentStock: 0, createdAt: daysAgo(400), lastSoldAt: daysAgo(200) },
    ], now)
    expect(rows.map((r) => [r.id, r.bucket, r.neverSold])).toEqual([['a', 'fresh', false], ['b', 'dead', false], ['c', 'fresh', true]])
  })
})

describe('every place uses it', () => {
  test('the stock report sends the last sale and the added date', () => {
    const code = readCode('src/app/api/reports/route.ts')
    expect(code).toMatch(/AS "lastSoldAt"/)
    expect(code).toMatch(/lastSoldAt: p\.lastSoldAt/)
    expect(code).toMatch(/createdAt: p\.createdAt/)
  })
  test('the report, its CSV and the engine all take the shared rule', () => {
    expect(readCode('src/components/reports/InventoryAgingReport.tsx')).toMatch(/stockAgeDays\(p\.lastSoldAt, p\.createdAt, now\)/)
    expect(readCode('src/lib/csv-export.ts')).toMatch(/stockAgeDays\(p\.lastSoldAt, p\.createdAt, now\)/)
    const engine = readCode('src/app/api/insights/route.ts')
    expect(engine).toMatch(/DEAD_DAYS \* 86_400_000/)
    expect(engine.split('s90.pid IS NULL AND p."createdAt" < ${since90}').length - 1).toBe(2)
  })
})
