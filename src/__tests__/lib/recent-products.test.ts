/**
 * Unit tests for recent products utility.
 */

import {
  trackRecentProduct,
  getRecentProductIds,
  getRecentProducts,
  clearRecentProducts,
} from '@/lib/recent-products'

describe('recent-products', () => {
  beforeEach(() => {
    clearRecentProducts()
  })

  test('starts empty', () => {
    expect(getRecentProductIds()).toHaveLength(0)
    expect(getRecentProducts()).toHaveLength(0)
  })

  test('tracks a product', () => {
    trackRecentProduct('prod-1', 'Rice')
    expect(getRecentProductIds()).toHaveLength(1)
    expect(getRecentProductIds()[0]).toBe('prod-1')
  })

  test('tracks multiple products (most recent first)', () => {
    trackRecentProduct('prod-1', 'Rice')
    trackRecentProduct('prod-2', 'Wheat')
    trackRecentProduct('prod-3', 'Sugar')

    const ids = getRecentProductIds()
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe('prod-3') // most recent first
    expect(ids[1]).toBe('prod-2')
    expect(ids[2]).toBe('prod-1')
  })

  test('bumps existing product to top (no duplicates)', () => {
    trackRecentProduct('prod-1', 'Rice')
    trackRecentProduct('prod-2', 'Wheat')
    trackRecentProduct('prod-1', 'Rice') // track again

    const ids = getRecentProductIds()
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('prod-1') // bumped to top
    expect(ids[1]).toBe('prod-2')
  })

  test('limits to 8 items', () => {
    for (let i = 1; i <= 10; i++) {
      trackRecentProduct(`prod-${i}`, `Product ${i}`)
    }
    expect(getRecentProductIds()).toHaveLength(8)
  })

  test('clears all products', () => {
    trackRecentProduct('prod-1', 'Rice')
    trackRecentProduct('prod-2', 'Wheat')
    expect(getRecentProductIds()).toHaveLength(2)

    clearRecentProducts()
    expect(getRecentProductIds()).toHaveLength(0)
  })

  test('getRecentProducts returns objects with productId, productName, usedAt', () => {
    trackRecentProduct('prod-1', 'Rice')
    const products = getRecentProducts()
    expect(products).toHaveLength(1)
    expect(products[0].productId).toBe('prod-1')
    expect(products[0].productName).toBe('Rice')
    expect(products[0].usedAt).toBeDefined()
  })

  test('ignores empty productId', () => {
    trackRecentProduct('', 'Empty')
    expect(getRecentProductIds()).toHaveLength(0)
  })
})
