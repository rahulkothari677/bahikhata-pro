/**
 * 🔒 Phase 7a — Behavioral tests for enrichScannedItems.
 *
 * This function was a closure inside BillScanner.tsx with zero tests.
 * It directly computes unit price, GST, and line totals that become the
 * stored invoice. A bug here means wrong invoice amounts.
 */

import { enrichScannedItems } from '@/lib/scanner-enrich'

const catalog = [
  { id: 'p1', name: 'Basmati Rice 1kg', unit: 'kg', salePrice: 120, purchasePrice: 90, gstRate: 0 },
  { id: 'p2', name: 'Cooking Oil 1L', unit: 'ltr', salePrice: 150, purchasePrice: 110, gstRate: 5 },
  { id: 'p3', name: 'LED Bulb', unit: 'pcs', salePrice: 100, purchasePrice: 60, gstRate: 18 },
]

describe('🔒 Phase 7a — enrichScannedItems behavioral tests', () => {

  test('exact name match links to catalog product', () => {
    const result = enrichScannedItems([
      { name: 'Basmati Rice 1kg', quantity: 2, unitPrice: 120, gstRate: 0, total: 240 },
    ], catalog, 'sale')

    expect(result[0].productId).toBe('p1')
    expect(result[0].quantity).toBe(2)
    expect(result[0].unitPrice).toBe(120)
    expect(result[0].total).toBe(240)
  })

  test('partial name match links to catalog product', () => {
    const result = enrichScannedItems([
      { name: 'Basmati', quantity: 1, unitPrice: 120, gstRate: 0, total: 120 },
    ], catalog, 'sale')

    expect(result[0].productId).toBe('p1')
  })

  test('unit normalization: 500 gm on kg product → 0.5 kg', () => {
    const result = enrichScannedItems([
      { name: 'Basmati Rice 1kg', quantity: 500, unit: 'gm', unitPrice: 120, gstRate: 0, total: 60 },
    ], catalog, 'sale')

    expect(result[0].quantity).toBe(0.5)
    expect(result[0].unit).toBe('kg')
  })

  test('derives unit price from printed total when AI mis-read the rate', () => {
    // AI read: qty=2, unitPrice=10, total=240 (clearly wrong — 2×10=20≠240)
    // Should derive: unitPrice = 240 / (1+0/100) / 2 = 120
    const result = enrichScannedItems([
      { name: 'Basmati Rice 1kg', quantity: 2, unitPrice: 10, gstRate: 0, total: 240 },
    ], catalog, 'sale')

    expect(result[0].unitPrice).toBe(120)
    expect(result[0].total).toBe(240)
  })

  test('derives unit price from printed total with GST', () => {
    // AI read: qty=1, unitPrice=0, gstRate=18, total=118
    // Should derive: unitPrice = 118 / (1+18/100) / 1 = 100
    const result = enrichScannedItems([
      { name: 'LED Bulb', quantity: 1, unitPrice: 0, gstRate: 18, total: 118 },
    ], catalog, 'sale')

    expect(result[0].unitPrice).toBe(100)
    expect(result[0].total).toBe(118)
  })

  test('falls back to catalog salePrice when unitPrice is 0 and no printed total', () => {
    const result = enrichScannedItems([
      { name: 'LED Bulb', quantity: 1, unitPrice: 0, gstRate: 18, total: 0 },
    ], catalog, 'sale')

    expect(result[0].unitPrice).toBe(100) // from catalog.salePrice
  })

  test('falls back to catalog purchasePrice for purchase bills', () => {
    const result = enrichScannedItems([
      { name: 'LED Bulb', quantity: 1, unitPrice: 0, gstRate: 18, total: 0 },
    ], catalog, 'purchase')

    expect(result[0].unitPrice).toBe(60) // from catalog.purchasePrice
  })

  test('fills gstRate from catalog when bill omits it', () => {
    const result = enrichScannedItems([
      { name: 'Cooking Oil 1L', quantity: 1, unitPrice: 150, gstRate: 0, total: 157.50 },
    ], catalog, 'sale')

    // gstRate should come from catalog (5%) since bill had 0
    expect(result[0].gstRate).toBe(5)
  })

  test('no match: keeps item as-is with no productId', () => {
    const result = enrichScannedItems([
      { name: 'Unknown Product', quantity: 1, unitPrice: 50, gstRate: 0, total: 50 },
    ], catalog, 'sale')

    expect(result[0].productId).toBeUndefined()
    expect(result[0].unitPrice).toBe(50)
    expect(result[0].total).toBe(50)
  })

  test('empty input returns empty array', () => {
    expect(enrichScannedItems([], catalog, 'sale')).toEqual([])
    expect(enrichScannedItems(null as any, catalog, 'sale')).toEqual([])
  })

  test('trusts printed total over AI unit price when mismatch >20%', () => {
    // AI read: qty=3, unitPrice=50, gstRate=0, total=120
    // Expected: 3×50=150, but printed total is 120 → 20% mismatch
    // Should derive: unitPrice = 120 / 1 / 3 = 40
    const result = enrichScannedItems([
      { name: 'Test Item', quantity: 3, unitPrice: 50, gstRate: 0, total: 120 },
    ], catalog, 'sale')

    expect(result[0].unitPrice).toBe(40)
    expect(result[0].total).toBe(120)
  })
})
