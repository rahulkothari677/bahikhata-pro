import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney, toMoney } from '@/lib/money'
import { deriveInterStateStatus } from '@/lib/gst'
import { validateBody, updateTransactionSchema } from '@/lib/validation'
import { computeLineItems } from '@/lib/line-items'
import { normalizeToUnit } from '@/lib/units'
import { apiError } from '@/lib/api-error'

// GET /api/transactions/[id] - get single transaction with all details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // 🔒 V7 L1: Filter deletedAt on GET so a soft-deleted transaction
    // returns 404 (not the deleted record). Was: returned the deleted
    // transaction by ID — viewing/editing a deleted txn would re-apply
    // stock without un-deleting it.
    const transaction = await db.transaction.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        items: true,
        party: true,
      },
    })
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    return NextResponse.json({ transaction })
  } catch (error) {
    return apiError(error, 'Failed to fetch transaction', 500)
  }
}

// PUT /api/transactions/[id] - update transaction
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Verify ownership + not soft-deleted (🔒 V7 L1)
    const existing = await db.transaction.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()

    // 🔒 AUDIT FIX H7: Validate request body with zod
    const validation = validateBody(updateTransactionSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', detail: validation.error }, { status: 400 })
    }

    const { type, partyId, date, items, discountAmount, paymentMode, notes, invoiceNo, category, paidAmount } = validation.data as any

    // 🔒 AUDIT FIX N6 (v3): Forbid changing transaction type.
    // Was: editing a sale→income would orphan items and leak stock (no reversal).
    // Now: reject type changes with a clear error. Users must delete and re-create
    // if they need a different type (the delete path handles stock reversal correctly).
    if (existing.type !== type) {
      return NextResponse.json({
        error: 'Cannot change transaction type',
        message: `This transaction is a ${existing.type}. To convert it to a ${type}, please delete this transaction and create a new one.`,
      }, { status: 400 })
    }

    // 🔒 GST CORRECTNESS (Audit fix H3 v2): Derive isInterState server-side
    // using the shared helper — same logic as POST. Was: trusted the client
    // isInterState flag (user could flip CGST/SGST ↔ IGST → wrong GST return).
    // Now: client flag is IGNORED, server derives from shop state vs party state.
    const { isInterState, party } = await deriveInterStateStatus(userId, partyId)
    if (partyId && !party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // For income/expense - simple update
    if (type === 'income' || type === 'expense') {
      const amount = parseFloat(body.totalAmount) || 0
      const transaction = await db.transaction.update({
        where: { id },
        data: {
          category: category || null,
          date: new Date(date || new Date()),
          subtotal: amount,
          totalAmount: amount,
          paidAmount: amount,
          paymentMode: paymentMode || 'cash',
          notes: notes || null,
          invoiceNo: invoiceNo || null,
        },
        include: { items: true, party: true },
      })
      return NextResponse.json({ transaction })
    }

    // For sale/purchase - recompute from items
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }

    const productIds = items.map((i: any) => i.productId).filter(Boolean)
    const products = productIds.length > 0 ? await db.product.findMany({ where: { id: { in: productIds }, userId } }) : []
    const productMap = new Map(products.map(p => [p.id, p]))

    // 🔒 V11 STOCK POLICY: Fetch the shop's stock policy + roundOffEnabled early.
    // Also fetch old items BEFORE the $transaction so we can compute the NET
    // stock impact (old items reversed + new items applied) and block/warn.
    const [setting, oldItems] = await Promise.all([
      db.setting.findUnique({
        where: { userId },
        select: { roundOffEnabled: true, stockPolicy: true },
      }),
      db.transactionItem.findMany({ where: { transactionId: id } }),
    ])
    const stockPolicy = setting?.stockPolicy || 'block'

    // 🔒 V11 STOCK POLICY: For sale edits, compute the NET stock impact per
    // product. Old sale items are added back (stock increases), new sale items
    // are decremented (stock decreases). If any product's resulting stock < 0:
    //   - 'block' mode → return 400 (reject the edit)
    //   - 'allow' mode → add to stockWarnings (sale goes through with warning)
    //
    // For purchase edits, we DON'T block (purchases add stock; reversing a
    // purchase that was already sold is an edge case — not handled here).
    const stockWarnings: Array<{
      productId: string
      productName: string
      currentStock: number
      requestedQuantity: number
      resultingStock: number
    }> = []

    if (type === 'sale' && existing.type === 'sale') {
      // Build a map of productId → net qty change (negative = stock decreases)
      const netChangeMap = new Map<string, number>()

      // Old items: add back (positive change)
      for (const oldItem of oldItems) {
        if (!oldItem.productId) continue
        const product = productMap.get(oldItem.productId)
        const oldQty = product?.unit
          ? normalizeToUnit(Number(oldItem.quantity) || 0, oldItem.unit || product.unit, product.unit).quantity
          : Number(oldItem.quantity) || 0
        netChangeMap.set(oldItem.productId, (netChangeMap.get(oldItem.productId) || 0) + oldQty)
      }

      // New items: subtract (negative change)
      for (const item of items) {
        if (!item.productId) continue
        const product = productMap.get(item.productId)
        if (!product) continue
        const newQty = normalizeToUnit(
          Number(item.quantity) || 0,
          item.unit || product.unit,
          product.unit,
        ).quantity
        netChangeMap.set(item.productId, (netChangeMap.get(item.productId) || 0) - newQty)
      }

      // Check each affected product
      for (const [productId, netChange] of netChangeMap.entries()) {
        const product = productMap.get(productId)
        if (!product) continue
        const resultingStock = roundMoney(product.currentStock + netChange)
        if (resultingStock < 0) {
          stockWarnings.push({
            productId: product.id,
            productName: product.name,
            currentStock: product.currentStock,
            requestedQuantity: -netChange,  // the net qty being sold
            resultingStock,
          })
        }
      }

      // Block mode: reject if any product would go negative
      if (stockPolicy === 'block' && stockWarnings.length > 0 && !body.confirmOversell) {
        const lines = stockWarnings.map(w =>
          `• ${w.productName}: have ${w.currentStock}, would go to ${w.resultingStock}`
        ).join('\n')
        return NextResponse.json({
          error: 'Not enough stock',
          message: `This edit would push stock below zero:\n${lines}\n\nRecord a purchase first, or enable "Allow overselling" in Settings.`,
          stockWarnings,
          hint: 'To allow overselling, go to Settings and turn on "Allow overselling (kirana mode)".',
        }, { status: 400 })
      }
    }

    // 🔒 V12: Same centralized line-item math as POST (computeLineItems) — unit
    // normalization + GST-inclusive + proportional discount, single source of
    // truth so edit and create can never drift apart.
    const orderDiscount = toMoney(discountAmount)

    // 🔒 AUDITOR FIX: Was a duplicated preSubtotal block (same as POST). Now:
    // call computeLineItems FIRST, then use computed.subtotal for the
    // over-discount check. Same pattern, same guarantee — no drift possible.
    const computed = computeLineItems({ items, productMap, isInterState, orderDiscount, type })
    const txItems = computed.txItems
    const subtotal = computed.subtotal
    const cgst = computed.cgst
    const sgst = computed.sgst
    const igst = computed.igst
    const grossProfit = computed.grossProfit
    const discount = orderDiscount

    // 🔒 V11 §4.3: Reject over-discount (discount > subtotal). Keep the
    // rejection (return 400) — don't silently clamp.
    if (orderDiscount > computed.subtotal) {
      return NextResponse.json({
        error: 'Discount cannot exceed subtotal',
        message: `The discount (₹${orderDiscount.toFixed(2)}) is greater than the subtotal (₹${computed.subtotal.toFixed(2)}). Please reduce the discount and try again.`,
      }, { status: 400 })
    }

    // 🔒 V12: Invoice round-off (nearest rupee) when enabled.
    // 🔒 V11: `setting` was fetched earlier (with stockPolicy). Reuse it here.
    let totalAmount = computed.totalBeforeRoundOff
    let roundOff = 0
    if (setting?.roundOffEnabled) {
      const rounded = Math.round(totalAmount)
      roundOff = roundMoney(rounded - totalAmount)
      totalAmount = rounded
    }

    const paid = parseFloat(paidAmount)
    const finalPaid = isNaN(paid) ? totalAmount : paid

    // 🔒 ATOMICITY (Audit fix C3) + STOCK (Audit fix H1):
    // Wrap delete + update + stock adjustments in $transaction.
    // Step 1: Reverse old items' stock impact (add back sales, subtract purchases)
    // Step 2: Delete old items
    // Step 3: Update transaction + create new items
    // Step 4: Apply new items' stock impact (decrement sales, increment purchases)
    const transaction = await db.$transaction(async (tx) => {
      // Step 1: Reverse old items' stock impact
      // 🔒 V9 2.1 FIX: Scope by userId (same as POST)
      // 🔒 V11: oldItems was fetched earlier (before the $transaction) for the
      // stock policy check. Reuse it here — no concurrent writes to the same
      // transaction ID, so the snapshot is still valid.
      for (const oldItem of oldItems) {
        if (oldItem.productId) {
          if (existing.type === 'sale') {
            // Reverse sale: add stock back
            await tx.product.updateMany({
              where: { id: oldItem.productId, userId },
              data: { currentStock: { increment: oldItem.quantity } },
            })
          } else if (existing.type === 'purchase') {
            // Reverse purchase: subtract stock
            await tx.product.updateMany({
              where: { id: oldItem.productId, userId },
              data: { currentStock: { decrement: oldItem.quantity } },
            })
          }
        }
      }

      // Step 2: Delete old items
      await tx.transactionItem.deleteMany({ where: { transactionId: id } })

      // Step 3: Update transaction + create new items
      const txn = await tx.transaction.update({
        where: { id },
        data: {
          type,
          partyId: partyId || null,
          date: new Date(date || new Date()),
          subtotal: roundMoney(subtotal),
          discountAmount: roundMoney(discount),
          cgst: roundMoney(cgst),
          sgst: roundMoney(sgst),
          igst: roundMoney(igst),
          totalAmount,
          roundOff: roundMoney(roundOff),  // 🔒 V12
          paidAmount: roundMoney(finalPaid),
          paymentMode: paymentMode || 'cash',
          isInterState: !!isInterState,
          notes: notes || null,
          invoiceNo: invoiceNo || null,
          grossProfit: roundMoney(grossProfit),
          items: { create: txItems },
        },
        include: { items: true, party: true },
      })

      // Step 4: Apply new items' stock impact
      // 🔒 V9 2.1 FIX: Scope by userId (same as POST)
      for (const item of txItems) {
        if (item.productId) {
          const qty = item.quantity || 0
          if (type === 'sale') {
            await tx.product.updateMany({
              where: { id: item.productId, userId },
              data: { currentStock: { decrement: qty } },
            })
          } else if (type === 'purchase') {
            await tx.product.updateMany({
              where: { id: item.productId, userId },
              data: { currentStock: { increment: qty } },
            })
          }
        }
      }

      return txn
    })

    return NextResponse.json({ transaction })
  } catch (error) {
    return apiError(error, 'Failed to update transaction', 500)
  }
}

// DELETE /api/transactions/[id]
// 🔒 AUDIT FIX M7+N5 (v3): Soft delete + stock reversal, wrapped in $transaction.
// Was: soft-delete and stock reversal were separate awaits (not atomic).
// Now: all operations in a single $transaction — all succeed or all roll back.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Verify ownership (exclude already soft-deleted)
    const existing = await db.transaction.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 🔒 N5: Wrap soft-delete + stock reversal in $transaction
    await db.$transaction(async (tx) => {
      // Step 1: Soft delete
      await tx.transaction.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      // Step 2: Reverse stock impact (same as edit — add back sales, subtract purchases)
      // 🔒 V9 2.1 FIX: Scope by userId (same as POST/PUT)
      if (existing.type === 'sale' || existing.type === 'purchase') {
        const items = await tx.transactionItem.findMany({ where: { transactionId: id } })
        for (const item of items) {
          if (item.productId) {
            if (existing.type === 'sale') {
              await tx.product.updateMany({
                where: { id: item.productId, userId },
                data: { currentStock: { increment: item.quantity } },
              })
            } else {
              await tx.product.updateMany({
                where: { id: item.productId, userId },
                data: { currentStock: { decrement: item.quantity } },
              })
            }
          }
        }
      }
    })

    return NextResponse.json({ success: true, message: 'Transaction deleted (soft delete — can be restored)' })
  } catch (error) {
    return apiError(error, 'Failed to delete transaction', 500)
  }
}
