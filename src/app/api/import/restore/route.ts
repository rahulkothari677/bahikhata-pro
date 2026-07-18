import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import {
  assertShopIsEmpty,
  relinkTransactionItemsToProducts,
  rebuildProductStock,
} from '@/lib/restore-utils'

/**
 * POST /api/import/restore
 *
 * 🔒 V17 Audit Phase 9: Restore from a JSON backup file.
 *
 * Body: { backup: <JSON object from /api/export/full> }
 *
 * Restores: products, parties, transactions (+ items), payments, settings, shops.
 * Skips: audit logs, field change logs (these are system-generated, not restorable).
 *
 * 🔒 V26 N5 (Option A): Restore is now a restore-INTO-EMPTY operation only.
 * Before importing, we assert the shop has zero transactions/products/parties/
 * payments. If non-empty, restore is rejected with a clear message pointing the
 * user to the Danger Zone reset flow. This stops the V24 §5 / V26 M6 defect
 * where restore silently merged into existing data: party balances
 * double-counted (recomputed from transactions), stock frozen (no rebuild),
 * products permanently unlinked (productId: null).
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

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const backup = body.backup || body  // accept { backup: {...} } or {...} directly

    if (!backup || !backup.data || !backup.app || backup.app !== 'EkBook') {
      return NextResponse.json({
        error: 'Invalid backup file',
        message: 'The uploaded file is not a valid EkBook backup. Make sure it was exported from Settings → Backup.',
      }, { status: 400 })
    }

    // 🔒 V26 N5: Block restore into a non-empty shop. Option A per the masterplan.
    const shopCheck = await assertShopIsEmpty(db as any, userId)
    if (!shopCheck.ok) {
      return NextResponse.json(
        { error: shopCheck.error, message: shopCheck.message },
        { status: shopCheck.status },
      )
    }

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
        } catch {
          results.shops.skipped++
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
        } catch {
          results.products.skipped++
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
        } catch {
          results.parties.skipped++
        }
      }
    }

    // === Restore transactions (+ items) ===
    if (data.transactions && Array.isArray(data.transactions)) {
      for (const txn of data.transactions) {
        try {
          // 🔒 AUDIT V24 §5: quarantine rows whose header doesn't tie to items
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

          // Find matching party by name (best effort — IDs don't match)
          let partyId: string | null = null
          if (txn.partyName || txn.partyId) {
            const party = await db.party.findFirst({
              where: {
                userId,
                name: txn.partyName || txn.party?.name,
                deletedAt: null,
              },
            })
            partyId = party?.id || null
          }

          await db.transaction.create({
            data: {
              userId,
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
        } catch {
          results.transactions.skipped++
        }
      }
    }

    // === Restore payments ===
    if (data.payments && Array.isArray(data.payments)) {
      for (const payment of data.payments) {
        try {
          // Find matching party by name (best effort)
          let partyId: string | null = null
          if (payment.partyName) {
            const party = await db.party.findFirst({
              where: { userId, name: payment.partyName, deletedAt: null },
            })
            partyId = party?.id || null
          }
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
        } catch {
          results.payments.skipped++
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
  }
}
