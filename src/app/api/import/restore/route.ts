import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import {
  relinkTransactionItemsToProducts,
  rebuildProductStock,
} from '@/lib/restore-utils'

/**
 * POST /api/import/restore
 *
 * 🔒 V17 Audit Phase 9: Restore from a JSON backup file.
 *
 * Body: { backup: <JSON object from /api/export/full>, restoreSessionId?: string }
 *
 * Restores: products, parties, transactions (+ items), payments, settings, shops.
 * Skips: audit logs, field change logs (these are system-generated, not restorable).
 *
 * 🔒 V26 N5 (Option A): Restore is now a restore-INTO-EMPTY operation only.
 * Before importing, we assert the shop has zero transactions/product/parties/
 * payments. If non-empty, restore is rejected with a clear message pointing the
 * user to the Danger Zone reset flow. This stops the V24 §5 / V26 M6 defect
 * where restore silently merged into existing data: party balances
 * double-counted (recomputed from transactions), stock frozen (no rebuild),
 * products permanently unlinked (productId: null).
 *
 * 🔒 V26 R3 (Phase 5): Resume-after-kill.
 * The old restore was non-atomic + sequential per-row + capped at 60s. A
 * 500+ row backup timed out mid-restore, leaving partial books AND a retry
 * that was permanently blocked (assertShopIsEmpty fails because shop now has
 * 500 transactions). The only path forward was destructive account-reset — a
 * data-loss-equivalent outage for the user (migrating / recovering) whose
 * trust matters most.
 *
 * Fix:
 *   1. Kill the N+1: preload partyIdByName Map once (R19).
 *   2. Batch: chunks of 100 transactions per $transaction({ timeout: 20_000 }).
 *   3. Resume: client sends restoreSessionId (uuid). On first call, write it
 *      to Setting.lastRestoreSessionId before any work. On retry, if
 *      Setting.lastRestoreSessionId matches the incoming id → resume (skip
 *      rows whose invoiceNo+date+totalAmount already exist via a prebuilt Set
 *      from a single indexed query). Anything else → 409.
 *   4. Clear the marker on completion (success or fail).
 *
 * After import:
 *   1. Re-link TransactionItems to Products by productName (best-effort).
 *   2. Rebuild Product.currentStock from openingStock + Σ(purchase+credit-note)
 *      − Σ(sale+debit-note). Stock is always derived from transactions — never
 *      trusts the backup's stored currentStock.
 *
 * Auth: owner only.
 */
export const maxDuration = 60

// 🔒 V26 R3 (Phase 5): Chunk size for transaction batching.
// Each chunk runs inside a $transaction({ timeout: 20_000 }). 100 rows × ~80ms
// per row = ~8s per chunk, well within the 20s tx timeout. ~80 chunks for an
// 8,000-row backup → ~6-7s total (vs the old ~100-130s sequential path that
// hit the 60s function cap at row ~500-600).
const TXN_CHUNK_SIZE = 100

export async function POST(req: NextRequest) {
  // 🔒 V26 R3: Track the restoreSessionId so we can clear it on exit.
  // We use a single outer-scope object so the `finally` block can read the
  // values set inside `try` without TypeScript widening to `string | null`.
  // The `ctx` fields are mutated in `try` and read in `finally`.
  const ctx = { userId: '' as string, restoreSessionId: '' as string }

  try {
    const authResult = await getAuthUserIdOwnerOnly()
    ctx.userId = authResult.userId || ''
    if (authResult.error || !ctx.userId) return authResult.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId: string = ctx.userId  // const reference for TS narrowing

    const body = await req.json()
    const backup = body.backup || body  // accept { backup: {...} } or {...} directly
    // 🔒 V26 R3: restoreSessionId from client. If absent, generate one (so the
    // marker is always written — first attempt + retry use the same id).
    const restoreSessionId: string =
      body.restoreSessionId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? (body.restoreSessionId || crypto.randomUUID())
        : `restore-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    ctx.restoreSessionId = restoreSessionId  // expose to finally block

    if (!backup || !backup.data || !backup.app || backup.app !== 'EkBook') {
      return NextResponse.json({
        error: 'Invalid backup file',
        message: 'The uploaded file is not a valid EkBook backup. Make sure it was exported from Settings → Backup.',
      }, { status: 400 })
    }

    // 🔒 V26 R3 (Phase 5): Shop-empty check WITH resume support.
    // Was: assertShopIsEmpty fails on any non-empty shop → retry permanently
    //      blocked after a partial restore.
    // Now: empty shop → proceed (first attempt); non-empty BUT Setting.
    //      lastRestoreSessionId === incoming restoreSessionId → resume (skip
    //      already-imported rows); anything else → 409 (genuinely different
    //      shop, user must reset first).
    const shopCheck = await checkShopEmptyOrResume(db as any, userId, restoreSessionId)
    if (!shopCheck.ok) {
      return NextResponse.json(
        { error: shopCheck.error, message: shopCheck.message },
        { status: shopCheck.status },
      )
    }
    const isResume = shopCheck.isResume

    // 🔒 V26 R3: Write the resume marker BEFORE any work. If the function is
    // killed mid-restore, the marker survives → next retry resumes.
    await db.setting.upsert({
      where: { userId },
      update: { lastRestoreSessionId: restoreSessionId },
      create: { userId, lastRestoreSessionId: restoreSessionId },
    })

    const data = backup.data
    const results = {
      products: { imported: 0, skipped: 0 },
      parties: { imported: 0, skipped: 0 },
      // 🔒 AUDIT V24 §5: `quarantined` counts rows whose header money did NOT
      // reconcile with their own items (edited/corrupted/truncated backup).
      // They are skipped WITH a reason instead of being imported silently
      // wrong — a ledger must never accept numbers it can't verify.
      transactions: { imported: 0, skipped: 0, quarantined: 0, quarantineReasons: [] as string[] },
      payments: { imported: 0, skipped: 0 },
      shops: { imported: 0, skipped: 0 },
      settings: { updated: false },
      resumed: isResume,
    }

    // 🔒 AUDIT V24 §5: Integrity check — the header GST/total must tie to the
    // row's own items (within 5p float tolerance per component). The old code
    // copied whatever the JSON said; a hand-edited or schema-drifted backup
    // imported with header ≠ items and every report silently disagreed with
    // the invoice from day one.
    const TOLERANCE = 0.05
    const headerTiesToItems = (txn: any): string | null => {
      const items: any[] = Array.isArray(txn.items) ? txn.items : []
      if (txn.type === 'income' || txn.type === 'expense') return null  // no items to tie to
      if (items.length === 0) return 'no line items'
      const sum = (f: (i: any) => number) => items.reduce((s, i) => s + (Number(f(i)) || 0), 0)
      const itemCgst = sum(i => i.cgst)
      const itemSgst = sum(i => i.sgst)
      const itemIgst = sum(i => i.igst)
      const itemGross = sum(i => (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0))
      const header = {
        cgst: Number(txn.cgst) || 0,
        sgst: Number(txn.sgst) || 0,
        igst: Number(txn.igst) || 0,
        subtotal: Number(txn.subtotal) || 0,
        discountAmount: Number(txn.discountAmount) || 0,
        roundOff: Number(txn.roundOff) || 0,
        totalAmount: Number(txn.totalAmount) || 0,
      }
      if (Math.abs(header.cgst - itemCgst) > TOLERANCE) return `header CGST ${header.cgst} ≠ items ${itemCgst.toFixed(2)}`
      if (Math.abs(header.sgst - itemSgst) > TOLERANCE) return `header SGST ${header.sgst} ≠ items ${itemSgst.toFixed(2)}`
      if (Math.abs(header.igst - itemIgst) > TOLERANCE) return `header IGST ${header.igst} ≠ items ${itemIgst.toFixed(2)}`
      if (Math.abs(header.subtotal - itemGross) > TOLERANCE) return `header subtotal ${header.subtotal} ≠ items ${itemGross.toFixed(2)}`
      const expectedTotal = header.subtotal - header.discountAmount + itemCgst + itemSgst + itemIgst + header.roundOff
      if (Math.abs(header.totalAmount - expectedTotal) > TOLERANCE) return `total ${header.totalAmount} ≠ computed ${expectedTotal.toFixed(2)}`
      return null
    }

    // === Restore shops (first — other entities reference shopId) ===
    if (data.shops && Array.isArray(data.shops)) {
      for (const shop of data.shops) {
        try {
          await db.shop.create({
            data: {
              userId,
              name: shop.name || 'Restored Shop',
              gstin: shop.gstin || null,
              address: shop.address || null,
              phone: shop.phone || null,
              state: shop.state || null,
              isDefault: shop.isDefault || false,
            },
          })
          results.shops.imported++
        } catch (e: any) {
          results.shops.skipped++
          console.error(`[restore] shop skipped: ${shop?.name || 'unknown'} — ${e?.message || e}`)
        }
      }
    }

    // === Restore products ===
    if (data.products && Array.isArray(data.products)) {
      for (const product of data.products) {
        try {
          // Skip if SKU already exists for this user
          if (product.sku) {
            const existing = await db.product.findFirst({
              where: { userId, sku: product.sku },
            })
            if (existing) {
              results.products.skipped++
              continue
            }
          }
          await db.product.create({
            data: {
              userId,
              name: product.name || 'Unknown Product',
              sku: product.sku || null,
              hsn: product.hsn || null,
              category: product.category || null,
              unit: product.unit || 'pcs',
              purchasePrice: product.purchasePrice || 0,
              salePrice: product.salePrice || 0,
              mrp: product.mrp || null,
              gstRate: product.gstRate || 0,
              priceIncludesGst: product.priceIncludesGst || false,
              gstTreatment: product.gstTreatment || 'taxable',
              openingStock: product.openingStock || 0,
              currentStock: product.currentStock || product.openingStock || 0,
              lowStockThreshold: product.lowStockThreshold || 5,
              notes: product.notes || null,
            },
          })
          results.products.imported++
        } catch (e: any) {
          results.products.skipped++
          console.error(`[restore] product skipped: ${product?.name || 'unknown'} — ${e?.message || e}`)
        }
      }
    }

    // === Restore parties ===
    if (data.parties && Array.isArray(data.parties)) {
      for (const party of data.parties) {
        try {
          // Skip if phone+name already exists
          if (party.phone && party.name) {
            const existing = await db.party.findFirst({
              where: { userId, phone: party.phone, name: party.name, deletedAt: null },
            })
            if (existing) {
              results.parties.skipped++
              continue
            }
          }
          await db.party.create({
            data: {
              userId,
              name: party.name || 'Unknown Party',
              type: party.type || 'customer',
              phone: party.phone || null,
              email: party.email || null,
              gstin: party.gstin || null,
              address: party.address || null,
              state: party.state || null,
              openingBalance: party.openingBalance || 0,
            },
          })
          results.parties.imported++
        } catch (e: any) {
          results.parties.skipped++
          console.error(`[restore] party skipped: ${party?.name || 'unknown'} — ${e?.message || e}`)
        }
      }
    }

    // 🔒 V26 R19 (Phase 5): Preload partyIdByName Map ONCE — kill the N+1
    // per-row findFirst in the transactions loop below. Was: per-transaction
    // findFirst = ~80-100ms × N rows = the dominant cost for large restores.
    // Now: one findMany at the start, Map lookup is O(1).
    const partyIdByName = new Map<string, string>()
    const allParties = await db.party.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true },
    })
    for (const p of allParties) {
      partyIdByName.set(p.name, p.id)
    }

    // === Restore transactions (+ items) ===
    // 🔒 V26 R3 (Phase 5): Batch into chunks of TXN_CHUNK_SIZE per $transaction.
    // Was: sequential per-row create (each its own implicit tx) → ~100-130ms/row
    //      → 60s function cap kills at row ~500-600 → partial books.
    // Now: chunks of 100 inside one explicit $transaction({ timeout: 20_000 })
    //      → ~8s per chunk, ~6-7s total for 8k rows.
    if (data.transactions && Array.isArray(data.transactions)) {
      // 🔒 V26 R3: On resume, prebuild a Set of already-imported transaction
      // keys (invoiceNo|date|totalAmount) so we can skip them in O(1) per row.
      // Single indexed query instead of per-row findFirst.
      const importedKeys = new Set<string>()
      if (isResume) {
        const existingTxns = await db.transaction.findMany({
          where: { userId, deletedAt: null },
          select: { invoiceNo: true, date: true, totalAmount: true },
        })
        for (const t of existingTxns) {
          const key = `${t.invoiceNo || ''}|${new Date(t.date).toISOString().slice(0, 10)}|${t.totalAmount}`
          importedKeys.add(key)
        }
      }

      const txns = data.transactions as any[]
      // Pre-filter: skip quarantined rows + already-imported rows BEFORE chunking.
      const cleanTxns: any[] = []
      for (const txn of txns) {
        const integrityError = headerTiesToItems(txn)
        if (integrityError) {
          results.transactions.quarantined++
          if (results.transactions.quarantineReasons.length < 20) {
            results.transactions.quarantineReasons.push(
              `${txn.invoiceNo || txn.date || 'row ' + (results.transactions.imported + results.transactions.skipped + results.transactions.quarantined)}: ${integrityError}`,
            )
          }
          continue
        }
        if (isResume) {
          const key = `${txn.invoiceNo || ''}|${new Date(txn.date).toISOString().slice(0, 10)}|${txn.totalAmount || 0}`
          if (importedKeys.has(key)) {
            results.transactions.skipped++
            continue
          }
        }
        cleanTxns.push(txn)
      }

      // Chunk + insert.
      for (let i = 0; i < cleanTxns.length; i += TXN_CHUNK_SIZE) {
        const chunk = cleanTxns.slice(i, i + TXN_CHUNK_SIZE)
        try {
          await db.$transaction(async (tx) => {
            for (const txn of chunk) {
              // R19: Map lookup instead of findFirst.
              const partyName = txn.partyName || txn.party?.name
              const partyId = partyName ? (partyIdByName.get(partyName) || null) : null

              await tx.transaction.create({
                data: {
                  userId: userId!,
                  type: txn.type || 'sale',
                  partyId,
                  invoiceNo: txn.invoiceNo || null,
                  date: new Date(txn.date),
                  subtotal: txn.subtotal || 0,
                  discountAmount: txn.discountAmount || 0,
                  cgst: txn.cgst || 0,
                  sgst: txn.sgst || 0,
                  igst: txn.igst || 0,
                  totalAmount: txn.totalAmount || 0,
                  paidAmount: txn.paidAmount || 0,
                  paymentMode: txn.paymentMode || 'cash',
                  isInterState: txn.isInterState || false,
                  isReverseCharge: txn.isReverseCharge || false,
                  notes: txn.notes || null,
                  category: txn.category || null,
                  roundOff: txn.roundOff || 0,
                  grossProfit: txn.grossProfit || 0,
                  items: {
                    create: (txn.items || []).map((item: any) => ({
                      productName: item.productName || 'Unknown',
                      productId: null,  // don't link to products (IDs don't match)
                      quantity: item.quantity || 1,
                      unit: item.unit || 'pcs',
                      unitPrice: item.unitPrice || 0,
                      purchasePriceAtSale: item.purchasePriceAtSale || 0,
                      gstRate: item.gstRate || 0,
                      discountAmount: item.discountAmount || 0,
                      cgst: item.cgst || 0,
                      sgst: item.sgst || 0,
                      igst: item.igst || 0,
                      csamt: item.csamt || 0,
                      hsn: item.hsn || null,
                      total: item.total || 0,
                    })),
                  },
                },
              })
              results.transactions.imported++
            }
          }, { timeout: 20_000 })
        } catch (chunkErr) {
          // A chunk failed — count its rows as skipped and continue with the next
          // chunk. This is more resilient than the old behavior (whole restore
          // aborts on any error) and the resume marker means the user can retry
          // just the failed chunks.
          results.transactions.skipped += chunk.length
          console.warn(`[restore] chunk ${i / TXN_CHUNK_SIZE + 1} failed:`, chunkErr)
        }
      }
    }

    // === Restore payments ===
    // R19: same Map-based lookup pattern.
    if (data.payments && Array.isArray(data.payments)) {
      // Refresh the party map in case the parties loop above added new ones.
      const freshParties = await db.party.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, name: true },
      })
      partyIdByName.clear()
      for (const p of freshParties) partyIdByName.set(p.name, p.id)

      for (const payment of data.payments) {
        try {
          const partyId = payment.partyName ? (partyIdByName.get(payment.partyName) || null) : null
          if (!partyId) {
            results.payments.skipped++
            continue
          }
          await db.payment.create({
            data: {
              userId,
              partyId,
              amount: payment.amount || 0,
              date: new Date(payment.date),
              mode: payment.mode || 'cash',
              type: payment.type || 'received',
              notes: payment.notes || null,
            },
          })
          results.payments.imported++
        } catch (e: any) {
          // 🔒 P6-6 (Phase 6): Was: silent skip. Money silently lost on restore.
          // Now: log the reason so the user can see what failed.
          results.payments.skipped++
          console.error(`[restore] payment skipped: ${payment.type} ₹${payment.amount} for ${payment.partyName || 'unknown party'} — ${e?.message || e}`)
        }
      }
    }

    // === Restore settings (merge, don't overwrite) ===
    if (data.settings && typeof data.settings === 'object') {
      const existing = await db.setting.findUnique({ where: { userId } })
      if (existing) {
        // Only update fields that are not already set (don't overwrite user's current settings)
        const updateData: any = {}
        if (!existing.shopName && data.settings.shopName) updateData.shopName = data.settings.shopName
        if (!existing.gstin && data.settings.gstin) updateData.gstin = data.settings.gstin
        if (!existing.state && data.settings.state) updateData.state = data.settings.state
        if (!existing.upiId && data.settings.upiId) updateData.upiId = data.settings.upiId

        if (Object.keys(updateData).length > 0) {
          await db.setting.update({ where: { userId }, data: updateData })
          results.settings.updated = true
        }
      }
    }

    // 🔒 V26 N5 (Option A): Post-import integrity pass.
    //   1. Re-link TransactionItems to Products by productName (best-effort).
    //      Before this, every restored item was created with productId: null,
    //      so item-profit and stock-value reports computed against orphan rows.
    //   2. Rebuild Product.currentStock from openingStock + transactions.
    //      Before this, restore trusted the backup's stored currentStock —
    //      which could disagree with the restored transaction history (hand-
    //      edited/truncated/older-schema backup). After rebuild, stock is
    //      always derived from transactions (single source of truth).
    const relinkResult = await relinkTransactionItemsToProducts(db as any, userId)
    const rebuildResult = await rebuildProductStock(db as any, userId)

    // Audit log the restore
    await logAudit({
      userId,
      action: 'data.restore',
      entityType: 'user',
      entityId: userId,
      metadata: {
        version: backup.version,
        ...results,
        relinked: relinkResult.relinked,
        unmatched: relinkResult.unmatched,
        stockRebuilt: rebuildResult.rebuilt,
      },
    })

    // 🔒 V26 N5: Honest success message — explicitly state stock was rebuilt
    // and how many items were re-linked. If unmatched > 0, warn the user that
    // those items won't appear in product-linked reports.
    let message = `Restore complete — ${results.transactions.imported} transactions, ${results.products.imported} products, stock rebuilt for ${rebuildResult.rebuilt} products, ${relinkResult.relinked} items re-linked to catalog.`
    if (results.resumed) {
      message = `Restore resumed — ${results.transactions.imported} new transactions, ${results.transactions.skipped} already present, ${results.products.imported} products. Stock rebuilt for ${rebuildResult.rebuilt} products.`
    }
    if (relinkResult.unmatched > 0) {
      message += ` ${relinkResult.unmatched} item(s) could not be matched to a product by name and will not appear in product-linked reports (item-profit, stock-value).`
    }

    return NextResponse.json({
      success: true,
      message,
      results: {
        ...results,
        relinked: relinkResult.relinked,
        unmatched: relinkResult.unmatched,
        stockRebuilt: rebuildResult.rebuilt,
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to restore data', 500)
  } finally {
    // 🔒 V26 R3 (Phase 5): ALWAYS clear the resume marker — success OR failure.
    // If we don't clear it on failure, the next genuinely-different restore
    // would falsely match the stale session id and resume into a half-broken
    // state. The only way a marker stays set is if the function is KILLED
    // before reaching this finally block (timeout, OOM, deploy kill) — that's
    // exactly the case where resume SHOULD fire on the next retry.
    if (ctx.userId && ctx.restoreSessionId) {
      try {
        await db.setting.updateMany({
          where: { userId: ctx.userId, lastRestoreSessionId: ctx.restoreSessionId },
          data: { lastRestoreSessionId: null },
        })
      } catch (e: any) {
        // Non-fatal — marker cleanup is best-effort. A stale marker just means
        // the next restore with the same id (extremely unlikely with uuids)
        // would resume instead of starting fresh.
      }
    }
  }
}

/**
 * 🔒 V26 R3 (Phase 5): Shop-empty check with resume support.
 *
 * Returns:
 *   { ok: true, isResume: false } — shop is empty, proceed with first attempt.
 *   { ok: true, isResume: true }  — shop non-empty BUT Setting.lastRestoreSessionId
 *                                   matches incoming → resume (skip already-imported rows).
 *   { ok: false, ... }            — shop non-empty AND no matching marker → 409
 *                                   (genuinely different shop, user must reset first).
 */
async function checkShopEmptyOrResume(
  db: any,
  userId: string,
  restoreSessionId: string,
): Promise<{ ok: boolean; isResume?: boolean; status?: number; error?: string; message?: string }> {
  const [transactions, products, parties, payments, setting] = await Promise.all([
    db.transaction.count({ where: { userId, deletedAt: null } }),
    db.product.count({ where: { userId } }),
    db.party.count({ where: { userId, deletedAt: null } }),
    db.payment.count({ where: { userId, deletedAt: null } }),
    db.setting.findUnique({ where: { userId }, select: { lastRestoreSessionId: true } }),
  ])

  const total = transactions + products + parties + payments

  if (total === 0) {
    return { ok: true, isResume: false }
  }

  // Non-empty shop — check if this is a resume of an interrupted restore.
  if (setting?.lastRestoreSessionId && setting.lastRestoreSessionId === restoreSessionId) {
    return { ok: true, isResume: true }
  }

  return {
    ok: false,
    status: 400,
    error: 'Cannot restore into a non-empty shop',
    message:
      `This shop already has data (${transactions} transactions, ${products} products, ${parties} parties, ${payments} payments). ` +
      'Restore replaces ALL current data. To continue: go to Settings → Data → Danger Zone → Reset All Data first, then retry the restore.',
  }
}
