/**
 * 🔒 AUDIT R1 — rebuildProductStock: tenant scoping, no-op skipping, and
 * bounded concurrency.
 *
 * rebuildProductStock runs AFTER the chunked import transactions have already
 * committed. If it is killed part-way, the transactions are in the database and
 * the stock is not — a shop that believes its restore succeeded, holding wrong
 * stock. That makes this one of the worst places in the app for a slow loop.
 *
 * The original wrote one product per round-trip, in series: a 20,000-product
 * catalogue meant 20,000 sequential queries. It also wrote with
 * `where: { id }` and no userId.
 */

import { rebuildProductStock } from '@/lib/restore-utils'

type Update = { where: any; data: any }

/**
 * Minimal RestoreDb stub. Records every update so the test can assert on the
 * WHERE clauses, not just the outcome.
 */
function makeDb(opts: {
  products: Array<{ id: string; openingStock: number; currentStock: number }>
  items?: Array<{ productId: string | null; quantity: number; type: string; affectsStock?: boolean }>
}) {
  const updates: Update[] = []
  let inFlight = 0
  let maxInFlight = 0

  const db: any = {
    product: {
      findMany: async () => opts.products.map(p => ({ ...p })),
      updateMany: async (args: Update) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(r => setTimeout(r, 1))
        updates.push(args)
        inFlight--
        return { count: 1 }
      },
      count: async () => opts.products.length,
    },
    transactionItem: {
      findMany: async () =>
        (opts.items ?? []).map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          transaction: { type: i.type, affectsStock: i.affectsStock ?? false },
        })),
      updateMany: async () => ({ count: 0 }),
    },
    transaction: { count: async () => 0, findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    party: { count: async () => 0 },
    payment: { count: async () => 0 },
  }

  return { db, updates, getMaxInFlight: () => maxInFlight }
}

describe('R1 — rebuildProductStock', () => {
  test('every write is scoped by userId, not just by id', async () => {
    const { db, updates } = makeDb({
      products: [{ id: 'p1', openingStock: 10, currentStock: 0 }],
      items: [{ productId: 'p1', quantity: 3, type: 'sale' }],
    })

    await rebuildProductStock(db, 'user-1')

    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) {
      // Pre-fix this was `{ id }` alone — safe only because the products were
      // fetched scoped forty lines earlier. A write in the restore path should
      // not rely on that.
      expect(u.where.userId).toBe('user-1')
      expect(u.where.id).toBeDefined()
    }
  })

  test('computes openingStock + net movement correctly', async () => {
    const { db, updates } = makeDb({
      products: [{ id: 'p1', openingStock: 100, currentStock: 0 }],
      items: [
        { productId: 'p1', quantity: 30, type: 'sale' },                          // −30
        { productId: 'p1', quantity: 50, type: 'purchase' },                      // +50
        { productId: 'p1', quantity: 10, type: 'credit-note', affectsStock: true },  // +10
        { productId: 'p1', quantity: 5, type: 'debit-note', affectsStock: true },    // −5
        { productId: 'p1', quantity: 99, type: 'credit-note', affectsStock: false }, // ignored
        { productId: 'p1', quantity: 99, type: 'income' },                        // ignored
      ],
    })

    await rebuildProductStock(db, 'u1')

    // 100 − 30 + 50 + 10 − 5 = 125
    expect(updates[0].data.currentStock).toBe(125)
  })

  test('skips products whose stock is already correct', async () => {
    const { db, updates } = makeDb({
      products: [
        { id: 'ok', openingStock: 10, currentStock: 7 },     // 10 − 3 = 7, already right
        { id: 'stale', openingStock: 10, currentStock: 999 }, // needs correcting
      ],
      items: [
        { productId: 'ok', quantity: 3, type: 'sale' },
        { productId: 'stale', quantity: 3, type: 'sale' },
      ],
    })

    const result = await rebuildProductStock(db, 'u1')

    expect(updates).toHaveLength(1)
    expect(updates[0].where.id).toBe('stale')
    expect(updates[0].data.currentStock).toBe(7)

    // `rebuilt` = examined (drives the user-facing message);
    // `corrected` = actually wrong in the backup.
    expect(result.rebuilt).toBe(2)
    expect(result.corrected).toBe(1)
  })

  test('a self-consistent backup triggers no writes at all', async () => {
    const { db, updates } = makeDb({
      products: [
        { id: 'a', openingStock: 5, currentStock: 5 },
        { id: 'b', openingStock: 0, currentStock: 0 },
      ],
    })

    const result = await rebuildProductStock(db, 'u1')

    expect(updates).toHaveLength(0)
    expect(result.corrected).toBe(0)
    // Still reports the products examined, so the restore message does not
    // read as though the rebuild never ran.
    expect(result.rebuilt).toBe(2)
  })

  test('writes concurrently, but stays bounded', async () => {
    // 50 products all needing correction.
    const products = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`, openingStock: 1, currentStock: 999,
    }))
    const { db, updates, getMaxInFlight } = makeDb({ products })

    await rebuildProductStock(db, 'u1')

    expect(updates).toHaveLength(50)
    // Pre-fix: strictly 1 (serial), which is what blew the timeout.
    expect(getMaxInFlight()).toBeGreaterThan(1)
    // Unbounded Promise.all over the whole catalogue would just move the
    // failure to the connection pool.
    expect(getMaxInFlight()).toBeLessThanOrEqual(10)
  })

  test('items with no productId are ignored', async () => {
    const { db, updates } = makeDb({
      products: [{ id: 'p1', openingStock: 10, currentStock: 0 }],
      items: [
        { productId: null, quantity: 999, type: 'sale' },
        { productId: 'p1', quantity: 4, type: 'sale' },
      ],
    })

    await rebuildProductStock(db, 'u1')
    expect(updates[0].data.currentStock).toBe(6)
  })
})
