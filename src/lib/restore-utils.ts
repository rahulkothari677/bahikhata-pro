/**
 * V26 N5 — Restore integrity helpers.
 *
 * Three pure-ish helpers used by the restore route to enforce Option A
 * (restore-into-empty with full stock rebuild + product re-linking):
 *
 *   1. assertShopIsEmpty — blocks restore into a non-empty shop. Restore
 *      silently merging into existing data was the V24 §5 / V26 M6 defect:
 *      party balances double-counted (recomputed from transactions), stock
 *      frozen (no rebuild), products permanently unlinked (productId: null).
 *      The honest fix is to require an empty shop; if the user wants to wipe
 *      first, the existing Danger Zone "Reset All Data" does that explicitly.
 *
 *   2. relinkTransactionItemsToProducts — best-effort re-link by productName
 *      (case-insensitive exact match). Items whose name doesn't match any
 *      Product stay unlinked (productId: null) — same as today, but now we
 *      actually try to link first. Restored reports that join items ↔
 *      products (item-profit, stock-value) start working again.
 *
 *   3. rebuildProductStock — for every Product, recompute currentStock from
 *      openingStock + Σ(purchase + credit-note-with-affectsStock)
 *      − Σ(sale + debit-note-with-affectsStock). Uses the same direction
 *      logic as the transaction lifecycle so stock can't drift.
 *
 * All three are exported as testable functions with an injected db handle
 * (the same pattern as note-validation.ts and linked-notes-guard.ts).
 */

export interface RestoreDb {
  transaction: {
    count: (args: { where: any }) => Promise<number>
    findMany: (args: { where: any; select?: any }) => Promise<any[]>
    updateMany: (args: { where: any; data: any }) => Promise<{ count: number }>
  }
  product: {
    count: (args: { where: any }) => Promise<number>
    findMany: (args: { where: any; select?: any }) => Promise<any[]>
    updateMany: (args: { where: any; data: any }) => Promise<{ count: number }>
  }
  party: {
    count: (args: { where: any }) => Promise<number>
  }
  payment: {
    count: (args: { where: any }) => Promise<number>
  }
  transactionItem: {
    findMany: (args: { where: any; select?: any }) => Promise<any[]>
    updateMany: (args: { where: any; data: any }) => Promise<{ count: number }>
  }
}

export interface ShopIsEmptyResult {
  ok: boolean
  status?: number
  error?: string
  message?: string
  counts?: { transactions: number; products: number; parties: number; payments: number }
}

/**
 * Block restore into a non-empty shop. The user must either:
 *   - Use a fresh account, OR
 *   - Reset all data first via Settings → Danger Zone → Reset All Data
 *
 * Auto-wiping is destructive and must require explicit confirmation, which
 * the existing handleResetData flow already does.
 */
export async function assertShopIsEmpty(
  db: RestoreDb,
  userId: string,
): Promise<ShopIsEmptyResult> {
  const [transactions, products, parties, payments] = await Promise.all([
    db.transaction.count({ where: { userId, deletedAt: null } }),
    db.product.count({ where: { userId } }),
    db.party.count({ where: { userId, deletedAt: null } }),
    db.payment.count({ where: { userId, deletedAt: null } }),
  ])

  const counts = { transactions, products, parties, payments }
  const total = transactions + products + parties + payments

  if (total > 0) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot restore into a non-empty shop',
      message:
        `This shop already has data (${transactions} transactions, ${products} products, ${parties} parties, ${payments} payments). ` +
        'Restore replaces ALL current data. To continue: go to Settings → Data → Danger Zone → Reset All Data first, then retry the restore.',
      counts,
    }
  }

  return { ok: true, counts }
}

export interface RelinkResult {
  relinked: number
  unmatched: number
}

/**
 * Best-effort re-link of restored TransactionItems to Products by name.
 *
 * For each TransactionItem with productId: null, look up a Product (same
 * userId) whose name matches case-insensitively. If found, set productId.
 * Items with no match stay null (same as today's behavior — but now we
 * actually try first).
 *
 * Match strategy: case-insensitive exact match on productName. Not fuzzy
 * (Levenshtein etc.) — too risky for an accounting context, and the backup
 * was exported from the same product catalog so exact name matches should
 * be the norm.
 */
export async function relinkTransactionItemsToProducts(
  db: RestoreDb,
  userId: string,
): Promise<RelinkResult> {
  // Build a productName (lowercase) → productId lookup from the restored catalog.
  const products = await db.product.findMany({
    where: { userId },
    select: { id: true, name: true },
  })
  const nameToId = new Map<string, string>()
  for (const p of products) {
    // First-wins on duplicate names — same behavior as the original create flow.
    const key = p.name.toLowerCase()
    if (!nameToId.has(key)) nameToId.set(key, p.id)
  }

  // Find all restored items with null productId.
  const items = await db.transactionItem.findMany({
    where: { productId: null, transaction: { userId } },
    select: { id: true, productName: true },
  })

  let relinked = 0
  let unmatched = 0
  // Group updates by productId to minimize round-trips.
  const updatesByProductId = new Map<string, string[]>()
  for (const item of items) {
    const match = nameToId.get(item.productName.toLowerCase())
    if (match) {
      const list = updatesByProductId.get(match) || []
      list.push(item.id)
      updatesByProductId.set(match, list)
      relinked++
    } else {
      unmatched++
    }
  }

  for (const [productId, itemIds] of updatesByProductId) {
    await db.transactionItem.updateMany({
      where: { id: { in: itemIds } },
      data: { productId },
    })
  }

  return { relinked, unmatched }
}

export interface RebuildStockResult {
  /**
   * Products EXAMINED — i.e. every product whose stock was recomputed from its
   * transaction history. Unchanged from the original meaning, deliberately:
   * it feeds the user-facing "stock rebuilt for N products" message, and
   * switching it to a change-count would report "rebuilt for 0 products" on a
   * perfectly healthy backup (where the recomputed value matches what was
   * already there) — reading as though the rebuild never ran.
   */
  rebuilt: number
  /**
   * 🔒 AUDIT R1: products whose stock was actually DIFFERENT and had to be
   * written. This is the number that says something happened: a non-zero
   * `corrected` means the backup's stored stock disagreed with its own
   * transaction history, which is exactly the corruption this rebuild exists
   * to repair.
   */
  corrected: number
}

/**
 * Recompute currentStock for every Product from its transaction history.
 *
 * Formula per product:
 *   currentStock = openingStock
 *     + Σ(quantity of purchase items + credit-note items where affectsStock)
 *     − Σ(quantity of sale items + debit-note items where affectsStock)
 *
 * Same direction logic as the transaction lifecycle (PUT/DELETE/restore in
 * transactions/[id]/route.ts): sale and debit-note-with-affectsStock decrement;
 * purchase and credit-note-with-affectsStock increment.
 *
 * This is the V26 N5 fix for the V24 §5 / V26 M6 defect: restore trusted the
 * backup's stored currentStock, which could disagree with the transaction
 * history (hand-edited/truncated/older-schema backup). After this rebuild,
 * stock is always derived from the restored transactions — single source of
 * truth.
 */
export async function rebuildProductStock(
  db: RestoreDb,
  userId: string,
): Promise<RebuildStockResult> {
  // 🔒 AUDIT R1: currentStock is selected so unchanged products can be skipped
  // entirely (see the apply loop below).
  const products = await db.product.findMany({
    where: { userId },
    select: { id: true, openingStock: true, currentStock: true },
  })

  // One aggregate query per direction — far cheaper than per-product loops.
  // We sum quantity across TransactionItem rows joined to Transaction, grouped
  // by productId, filtered by type + affectsStock + not-deleted.
  //
  // The raw SQL is written defensively so it works on both Postgres (prod)
  // and SQLite (jest tests): the column names are double-quoted to match
  // Prisma's default naming, and we use SUM with COALESCE for zero-row safety.
  //
  // But: we can't run raw SQL through the injected db handle (the handle
  // mimics the Prisma client API). So we do this with findMany + JS reduce —
  // more round-trips but portable + testable.
  //
  // For 10K-transaction backups this is O(products × items); acceptable for
  // a one-time restore operation. If restore latency becomes an issue, swap
  // to a raw SQL aggregate without changing the public contract.
  const allItems = await db.transactionItem.findMany({
    where: { transaction: { userId, deletedAt: null } },
    select: {
      productId: true,
      quantity: true,
      transaction: {
        select: { type: true, affectsStock: true },
      },
    },
  })

  // Aggregate per product: net stock change.
  const stockDelta = new Map<string, number>()
  for (const item of allItems) {
    if (!item.productId) continue
    const t = item.transaction
    // Direction logic — mirror transactions/[id]/route.ts PUT handler.
    let direction: 1 | -1 | 0 = 0
    if (t.type === 'sale') {
      direction = -1
    } else if (t.type === 'purchase') {
      direction = 1
    } else if (t.type === 'credit-note' && t.affectsStock) {
      direction = 1  // credit note reverses a sale → adds stock back
    } else if (t.type === 'debit-note' && t.affectsStock) {
      direction = -1  // debit note reverses a purchase → removes stock
    }
    if (direction === 0) continue
    const current = stockDelta.get(item.productId) || 0
    stockDelta.set(item.productId, current + direction * item.quantity)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Apply: currentStock = openingStock + delta.
  //
  // 🔒 AUDIT R1 — two fixes here.
  //
  // (a) TENANT SCOPING. The update was `where: { id: p.id }` with no userId.
  //     Safe today only because `products` was fetched scoped — i.e. safe
  //     because of something that happened forty lines earlier. This is a
  //     WRITE, in the restore path, so it gets the same treatment as every
  //     other scoped write in the codebase.
  //
  // (b) SEQUENTIAL ROUND-TRIPS. This was `for (...) { await update }` — one
  //     round-trip PER PRODUCT, in series. A 20,000-product catalogue meant
  //     20,000 sequential queries.
  //
  //     That matters more here than almost anywhere else. rebuildProductStock
  //     runs AFTER the chunked import transactions have already committed, so
  //     if the function is killed part-way the transactions are in and the
  //     stock is not — silently wrong stock on a shop that believes its
  //     restore succeeded. This is the same N1 bug class, in the one place
  //     where a timeout does the most damage.
  //
  //     Now: skip products whose stock is already correct (in a typical
  //     restore most are), then issue the remainder with bounded concurrency.
  //     The bound keeps the connection pool safe — unbounded Promise.all over
  //     20,000 updates would simply move the failure.
  //
  // `rebuilt` keeps its original meaning (products examined) because it feeds
  // the user-facing restore message; `corrected` is the new number that says
  // whether anything was actually wrong.
  // ═══════════════════════════════════════════════════════════════════════
  const REBUILD_CONCURRENCY = 10

  const pending: Array<{ id: string; newStock: number }> = []
  for (const p of products) {
    const delta = stockDelta.get(p.id) || 0
    const newStock = (p.openingStock || 0) + delta
    // Skip no-ops. Restores commonly leave most of the catalogue untouched.
    if (p.currentStock === newStock) continue
    pending.push({ id: p.id, newStock })
  }

  for (let i = 0; i < pending.length; i += REBUILD_CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + REBUILD_CONCURRENCY).map(({ id, newStock }) =>
        db.product.updateMany({
          where: { id, userId },   // 🔒 R1(a): tenant-scoped
          data: { currentStock: newStock },
        }),
      ),
    )
  }

  return { rebuilt: products.length, corrected: pending.length }
}
