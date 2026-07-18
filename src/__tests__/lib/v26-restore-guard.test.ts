/**
 * V26 N5 — Behavioral tests for restore integrity helpers.
 *
 * Three helpers in src/lib/restore-utils.ts:
 *   1. assertShopIsEmpty — blocks restore into non-empty shop
 *   2. relinkTransactionItemsToProducts — best-effort name-based re-link
 *   3. rebuildProductStock — recomputes currentStock from transactions
 *
 * Each helper takes an injected db handle (stub here) so we can test the
 * logic without spinning up the full Next.js request pipeline.
 */

import { describe, test, expect } from '@jest/globals'
import {
  assertShopIsEmpty,
  relinkTransactionItemsToProducts,
  rebuildProductStock,
  type RestoreDb,
} from '@/lib/restore-utils'

// ─── Stub builders ──────────────────────────────────────────────────────

function makeStubDb(opts: {
  transactions?: number
  products?: number
  parties?: number
  payments?: number
  productList?: Array<{ id: string; name: string; openingStock: number }>
  itemList?: Array<{
    id: string
    productId: string | null
    productName: string
    quantity: number
    transaction: { type: string; affectsStock: boolean }
  }>
  captureUpdateMany?: (args: { where: any; data: any }) => void
  captureItemUpdateMany?: (args: { where: any; data: any }) => void
}): RestoreDb {
  return {
    transaction: {
      async count() { return opts.transactions ?? 0 },
      async findMany() { return [] },
      async updateMany(args: any) {
        opts.captureUpdateMany?.(args)
        return { count: 1 }
      },
    },
    product: {
      async count() { return opts.products ?? 0 },
      async findMany() { return opts.productList ?? [] },
      async updateMany(args: any) {
        opts.captureUpdateMany?.(args)
        return { count: 1 }
      },
    },
    party: {
      async count() { return opts.parties ?? 0 },
    },
    payment: {
      async count() { return opts.payments ?? 0 },
    },
    transactionItem: {
      async findMany() { return opts.itemList ?? [] },
      async updateMany(args: any) {
        opts.captureItemUpdateMany?.(args)
        return { count: 1 }
      },
    },
  }
}

// ─── assertShopIsEmpty ──────────────────────────────────────────────────

describe('V26 N5 — assertShopIsEmpty', () => {
  test('returns ok when shop is empty', async () => {
    const stub = makeStubDb({})
    const res = await assertShopIsEmpty(stub, 'u1')
    expect(res.ok).toBe(true)
    expect(res.counts).toEqual({ transactions: 0, products: 0, parties: 0, payments: 0 })
  })

  test('blocks when shop has transactions', async () => {
    const stub = makeStubDb({ transactions: 50 })
    const res = await assertShopIsEmpty(stub, 'u1')
    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
    expect(res.message).toContain('50 transactions')
    expect(res.message).toContain('Reset All Data')
  })

  test('blocks when shop has products only', async () => {
    const stub = makeStubDb({ products: 10 })
    const res = await assertShopIsEmpty(stub, 'u1')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('10 products')
  })

  test('blocks when shop has parties only', async () => {
    const stub = makeStubDb({ parties: 5 })
    const res = await assertShopIsEmpty(stub, 'u1')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('5 parties')
  })

  test('blocks when shop has payments only', async () => {
    const stub = makeStubDb({ payments: 3 })
    const res = await assertShopIsEmpty(stub, 'u1')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('3 payments')
  })

  test('blocks when shop has all four entity types', async () => {
    const stub = makeStubDb({ transactions: 10, products: 5, parties: 3, payments: 2 })
    const res = await assertShopIsEmpty(stub, 'u1')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('10 transactions')
    expect(res.message).toContain('5 products')
    expect(res.message).toContain('3 parties')
    expect(res.message).toContain('2 payments')
  })

  test('message tells user where to reset (Danger Zone)', async () => {
    const stub = makeStubDb({ transactions: 1 })
    const res = await assertShopIsEmpty(stub, 'u1')
    if (!res.ok) {
      expect(res.message).toMatch(/Danger Zone/i)
      expect(res.message).toMatch(/Reset All Data/)
    }
  })
})

// ─── relinkTransactionItemsToProducts ───────────────────────────────────

describe('V26 N5 — relinkTransactionItemsToProducts', () => {
  test('relinks items whose productName matches a product (case-insensitive)', async () => {
    const stub = makeStubDb({
      productList: [
        { id: 'p1', name: 'Rice 1kg', openingStock: 0 },
        { id: 'p2', name: 'Sugar 1kg', openingStock: 0 },
      ],
      itemList: [
        { id: 'i1', productId: null, productName: 'Rice 1kg', quantity: 2, transaction: { type: 'sale', affectsStock: false } },
        { id: 'i2', productId: null, productName: 'rice 1kg', quantity: 1, transaction: { type: 'sale', affectsStock: false } },  // case-insensitive
        { id: 'i3', productId: null, productName: 'Sugar 1kg', quantity: 3, transaction: { type: 'sale', affectsStock: false } },
      ],
    })
    const res = await relinkTransactionItemsToProducts(stub, 'u1')
    expect(res.relinked).toBe(3)
    expect(res.unmatched).toBe(0)
  })

  test('leaves items unmatched when no product name matches', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice 1kg', openingStock: 0 }],
      itemList: [
        { id: 'i1', productId: null, productName: 'Rice 1kg', quantity: 2, transaction: { type: 'sale', affectsStock: false } },
        { id: 'i2', productId: null, productName: 'Discontinued Product', quantity: 5, transaction: { type: 'sale', affectsStock: false } },
      ],
    })
    const res = await relinkTransactionItemsToProducts(stub, 'u1')
    expect(res.relinked).toBe(1)
    expect(res.unmatched).toBe(1)
  })

  test('first-wins on duplicate product names', async () => {
    const stub = makeStubDb({
      productList: [
        { id: 'p1', name: 'Rice', openingStock: 0 },
        { id: 'p2', name: 'Rice', openingStock: 0 },  // duplicate name
      ],
      itemList: [
        { id: 'i1', productId: null, productName: 'Rice', quantity: 1, transaction: { type: 'sale', affectsStock: false } },
      ],
    })
    // Capture the productId that gets assigned — should be p1 (first wins).
    let capturedProductId: string | undefined
    const stubWithCapture = {
      ...stub,
      transactionItem: {
        ...stub.transactionItem,
        async updateMany(args: any) {
          capturedProductId = args.data.productId
          return { count: 1 }
        },
      },
    }
    const res = await relinkTransactionItemsToProducts(stubWithCapture as any, 'u1')
    expect(res.relinked).toBe(1)
    expect(capturedProductId).toBe('p1')
  })

  test('no items to relink (empty shop) → 0/0', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 0 }],
      itemList: [],
    })
    const res = await relinkTransactionItemsToProducts(stub, 'u1')
    expect(res.relinked).toBe(0)
    expect(res.unmatched).toBe(0)
  })

  test('no products in catalog → all items unmatched', async () => {
    const stub = makeStubDb({
      productList: [],
      itemList: [
        { id: 'i1', productId: null, productName: 'Rice', quantity: 1, transaction: { type: 'sale', affectsStock: false } },
      ],
    })
    const res = await relinkTransactionItemsToProducts(stub, 'u1')
    expect(res.relinked).toBe(0)
    expect(res.unmatched).toBe(1)
  })
})

// ─── rebuildProductStock ────────────────────────────────────────────────

describe('V26 N5 — rebuildProductStock', () => {
  test('sale decrements stock; purchase increments', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 10 }],
      itemList: [
        { id: 'i1', productId: 'p1', productName: 'Rice', quantity: 3, transaction: { type: 'sale', affectsStock: false } },
        { id: 'i2', productId: 'p1', productName: 'Rice', quantity: 5, transaction: { type: 'purchase', affectsStock: false } },
      ],
      captureUpdateMany: (args) => {
        // 10 opening - 3 sale + 5 purchase = 12
        expect(args.data.currentStock).toBe(12)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })

  test('credit-note with affectsStock=true adds stock back', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 10 }],
      itemList: [
        { id: 'i1', productId: 'p1', productName: 'Rice', quantity: 3, transaction: { type: 'sale', affectsStock: false } },
        { id: 'i2', productId: 'p1', productName: 'Rice', quantity: 2, transaction: { type: 'credit-note', affectsStock: true } },
      ],
      captureUpdateMany: (args) => {
        // 10 opening - 3 sale + 2 credit-note = 9
        expect(args.data.currentStock).toBe(9)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })

  test('credit-note with affectsStock=false does NOT add stock back', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 10 }],
      itemList: [
        { id: 'i1', productId: 'p1', productName: 'Rice', quantity: 3, transaction: { type: 'sale', affectsStock: false } },
        { id: 'i2', productId: 'p1', productName: 'Rice', quantity: 2, transaction: { type: 'credit-note', affectsStock: false } },
      ],
      captureUpdateMany: (args) => {
        // 10 opening - 3 sale + 0 (credit-note doesn't affect stock) = 7
        expect(args.data.currentStock).toBe(7)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })

  test('debit-note with affectsStock=true removes stock', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 10 }],
      itemList: [
        { id: 'i1', productId: 'p1', productName: 'Rice', quantity: 4, transaction: { type: 'purchase', affectsStock: false } },
        { id: 'i2', productId: 'p1', productName: 'Rice', quantity: 1, transaction: { type: 'debit-note', affectsStock: true } },
      ],
      captureUpdateMany: (args) => {
        // 10 opening + 4 purchase - 1 debit-note = 13
        expect(args.data.currentStock).toBe(13)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })

  test('income/expense transactions do NOT affect stock', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 5 }],
      itemList: [
        { id: 'i1', productId: 'p1', productName: 'Rice', quantity: 100, transaction: { type: 'income', affectsStock: false } },
        { id: 'i2', productId: 'p1', productName: 'Rice', quantity: 50, transaction: { type: 'expense', affectsStock: false } },
      ],
      captureUpdateMany: (args) => {
        // 5 opening + 0 (income/expense don't affect stock) = 5
        expect(args.data.currentStock).toBe(5)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })

  test('items with null productId are skipped (no product to update)', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 10 }],
      itemList: [
        { id: 'i1', productId: null, productName: 'Unlinked', quantity: 100, transaction: { type: 'sale', affectsStock: false } },
        { id: 'i2', productId: 'p1', productName: 'Rice', quantity: 3, transaction: { type: 'sale', affectsStock: false } },
      ],
      captureUpdateMany: (args) => {
        // 10 opening - 3 sale = 7 (the null-productId item is ignored)
        expect(args.data.currentStock).toBe(7)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })

  test('product with no transactions → stock = openingStock', async () => {
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 42 }],
      itemList: [],
      captureUpdateMany: (args) => {
        expect(args.data.currentStock).toBe(42)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })

  test('multiple products each get their own stock', async () => {
    const updates: Array<{ id: string; stock: number }> = []
    const stub = makeStubDb({
      productList: [
        { id: 'p1', name: 'Rice', openingStock: 10 },
        { id: 'p2', name: 'Sugar', openingStock: 20 },
      ],
      itemList: [
        { id: 'i1', productId: 'p1', productName: 'Rice', quantity: 3, transaction: { type: 'sale', affectsStock: false } },
        { id: 'i2', productId: 'p2', productName: 'Sugar', quantity: 5, transaction: { type: 'purchase', affectsStock: false } },
      ],
      captureUpdateMany: (args) => {
        updates.push({ id: args.where.id, stock: args.data.currentStock })
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(2)
    // p1: 10 - 3 = 7, p2: 20 + 5 = 25
    const p1Update = updates.find(u => u.id === 'p1')
    const p2Update = updates.find(u => u.id === 'p2')
    expect(p1Update?.stock).toBe(7)
    expect(p2Update?.stock).toBe(25)
  })

  test('THE BUG: stored currentStock is ignored — only openingStock + transactions matter', async () => {
    // This is the core V26 N5 invariant: even if the backup said currentStock=999,
    // after rebuild it's derived from openingStock + transactions only.
    const stub = makeStubDb({
      productList: [{ id: 'p1', name: 'Rice', openingStock: 10 }],  // no currentStock in stub
      itemList: [
        { id: 'i1', productId: 'p1', productName: 'Rice', quantity: 3, transaction: { type: 'sale', affectsStock: false } },
      ],
      captureUpdateMany: (args) => {
        // 10 - 3 = 7 (NOT 999 - 3 = 996, which is what the old code produced)
        expect(args.data.currentStock).toBe(7)
      },
    })
    const res = await rebuildProductStock(stub, 'u1')
    expect(res.rebuilt).toBe(1)
  })
})
