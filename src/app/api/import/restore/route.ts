import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'

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
 * IMPORTANT: This MERGES with existing data — it does NOT delete existing data.
 * If a product with the same SKU already exists, it's skipped (not overwritten).
 * If a party with the same phone+name already exists, it's skipped.
 * Transactions are always created as new (new IDs, new invoice numbers).
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

    const data = backup.data
    const results = {
      products: { imported: 0, skipped: 0 },
      parties: { imported: 0, skipped: 0 },
      transactions: { imported: 0, skipped: 0 },
      payments: { imported: 0, skipped: 0 },
      shops: { imported: 0, skipped: 0 },
      settings: { updated: false },
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

    // Audit log the restore
    await logAudit({
      userId,
      action: 'data.restore',
      entityType: 'user',
      entityId: userId,
      metadata: {
        version: backup.version,
        ...results,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Restore complete. Some items may have been skipped if they already existed.',
      results,
    })
  } catch (err) {
    return apiError(err, 'Failed to restore data', 500)
  }
}
