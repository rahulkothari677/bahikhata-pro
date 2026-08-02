/**
 * 🔒 AUDIT PASS-1 N6 — "stock value" must mean the same thing on every screen.
 *
 * The consolidated (multi-shop) report computed stock value WITHOUT the
 * Math.max(0, currentStock) clamp that the dashboard (V11) and the stock report
 * both apply. A product sold below zero has already had its value realised
 * through the sale; counting it as NEGATIVE inventory understates what is
 * actually on the shelves.
 *
 * The visible consequence: a shop with any oversold line saw a LOWER stock
 * value in the consolidated report than on its own dashboard, with nothing to
 * explain the gap. For a multi-shop owner comparing outlets, that reads as a
 * real business signal rather than an arithmetic inconsistency.
 *
 * No existing test covered negative stock here, which is exactly why the
 * divergence survived — the suite was green before and after the fix.
 */

import { buildConsolidatedReport } from '@/lib/consolidated-reports'
import { roundMoney } from '@/lib/money'

const from = new Date('2026-01-01')
const to = new Date('2026-12-31')

/** The canonical definition, as used by the dashboard and the stock report. */
function canonicalStockValue(products: Array<{ currentStock: number; purchasePrice: number }>) {
  return roundMoney(
    products.reduce((s, p) => s + roundMoney(Math.max(0, p.currentStock) * p.purchasePrice), 0),
  )
}

describe('N6 — consolidated stock value matches the canonical definition', () => {
  const shops = [{ id: 'shop1', name: 'Main Shop' }]

  test('oversold stock contributes ZERO, never a negative amount', () => {
    const products = [
      { shopId: 'shop1', currentStock: 10, purchasePrice: 100 },   // ₹1,000
      { shopId: 'shop1', currentStock: -5, purchasePrice: 100 },   // oversold → ₹0
    ]

    const report = buildConsolidatedReport(shops, [], products, from, to)

    // Correct: 1000 + 0. The pre-fix code produced 1000 + (-500) = 500.
    expect(report.shops[0].stockValue).toBe(1000)
    expect(report.shops[0].stockValue).toBe(canonicalStockValue(products))
  })

  test('a single oversold product cannot drive stock value below zero', () => {
    const products = [{ shopId: 'shop1', currentStock: -40, purchasePrice: 25 }]
    const report = buildConsolidatedReport(shops, [], products, from, to)

    expect(report.shops[0].stockValue).toBe(0)
    expect(report.shops[0].stockValue).toBeGreaterThanOrEqual(0)
  })

  test('agrees with the canonical definition across a mixed catalogue', () => {
    const products = [
      { shopId: 'shop1', currentStock: 3.5, purchasePrice: 19.99 },
      { shopId: 'shop1', currentStock: 0, purchasePrice: 500 },
      { shopId: 'shop1', currentStock: -2, purchasePrice: 45.5 },
      { shopId: 'shop1', currentStock: 120, purchasePrice: 7.25 },
      { shopId: null, currentStock: 8, purchasePrice: 12.1 },   // shared across shops
    ]

    const report = buildConsolidatedReport(shops, [], products, from, to)
    expect(report.shops[0].stockValue).toBe(canonicalStockValue(products))
  })

  test('shopId: null products are counted for every shop (unchanged behaviour)', () => {
    // Guard against the fix accidentally changing WHICH products a shop sees.
    const twoShops = [
      { id: 'shop1', name: 'A' },
      { id: 'shop2', name: 'B' },
    ]
    const products = [
      { shopId: null, currentStock: 10, purchasePrice: 100 },     // both shops
      { shopId: 'shop1', currentStock: 5, purchasePrice: 100 },   // shop1 only
    ]

    const report = buildConsolidatedReport(twoShops, [], products, from, to)
    expect(report.shops[0].stockValue).toBe(1500)  // 1000 shared + 500 own
    expect(report.shops[1].stockValue).toBe(1000)  // shared only
  })
})
