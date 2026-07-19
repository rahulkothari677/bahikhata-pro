import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { computeLineItems } from '@/lib/line-items'
import { normalizeToUnit } from '@/lib/units'
import { roundMoney, toMoney } from '@/lib/money'
import { deriveInterStateStatus } from '@/lib/gst'
import { assertPeriodNotLocked, PeriodLockedError } from '@/lib/period-lock'
import { apiError } from '@/lib/api-error'

/**
 * POST /api/transactions/[id]/convert
 *
 * 🔒 V26 F1 FIX: Server-side atomic estimate→sale conversion.
 * Was: client-side prefill (TransactionDetail.tsx sets __ledgerPreset and
 * navigates to the sale form). The estimate stayed open with no "converted"
 * status → unlimited re-conversion → duplicate sales, double stock decrement,
 * double billing.
 *
 * Now: this endpoint creates the sale from the estimate's stored items in
 * a single $transaction, AND marks the estimate as converted. The UI calls
 * this instead of pre-filling the sale form.
 *
 * Auth: owner or staff with sales module access.
 */
export const maxDuration = 30

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'sales')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const { id } = await params

    // 1. Fetch the estimate
    const estimate = await db.transaction.findFirst({
      where: { id, userId, type: 'estimate', deletedAt: null },
      include: { items: true, party: { select: { name: true, gstin: true, state: true } } },
    })

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    // 2. Check if already converted
    if (estimate.convertedToTransactionId) {
      return NextResponse.json({
        error: 'Already converted',
        message: `This estimate was already converted to a sale. Converted at ${estimate.convertedAt ? new Date(estimate.convertedAt).toLocaleDateString('en-IN') : 'unknown date'}.`,
        convertedToTransactionId: estimate.convertedToTransactionId,
      }, { status: 409 })
    }

    // 3. Period lock check
    try {
      await assertPeriodNotLocked(userId, estimate.date)
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return NextResponse.json({ error: e.message, code: 'PERIOD_LOCKED' }, { status: 403 })
      }
      throw e
    }

    // 4. Fetch products for the estimate's items
    const productIds = estimate.items.map(i => i.productId).filter(Boolean) as string[]
    const products = productIds.length > 0
      ? await db.product.findMany({ where: { id: { in: productIds }, userId } })
      : []
    const productMap = new Map(products.map(p => [p.id, p]))

    // 5. Fetch settings for stock policy + round-off
    const setting = await db.setting.findUnique({
      where: { userId },
      select: { stockPolicy: true, roundOffEnabled: true, state: true, gstin: true },
    })

    // 6. Compute line items (same as POST /api/transactions)
    const { isInterState } = await deriveInterStateStatus(userId, estimate.partyId)

    const items = estimate.items.map(item => {
      const product = item.productId ? productMap.get(item.productId) : undefined
      return {
        productId: item.productId || '',
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate,
        unit: product?.unit || item.unit || 'pcs',
      }
    })

    const orderDiscount = toMoney(estimate.discountAmount)
    const computed = computeLineItems({
      items,
      productMap,
      isInterState,
      orderDiscount,
      type: 'sale',
    })

    let totalAmount = computed.totalBeforeRoundOff
    let roundOff = 0
    if (setting?.roundOffEnabled) {
      const rounded = Math.round(totalAmount)
      roundOff = roundMoney(rounded - totalAmount)
      totalAmount = rounded
    }

    // 7. Create the sale + mark estimate as converted (atomic)
    const sale = await db.$transaction(async (tx) => {
      // Generate invoice number
      const counter = await tx.invoiceCounter.upsert({
        where: { userId },
        update: { seq: { increment: 1 } },
        create: { userId, seq: 1 },
        select: { seq: true },
      })
      const invoiceNo = `INV-${String(counter.seq).padStart(4, '0')}`

      // Create the sale from the estimate's items
      const newSale = await tx.transaction.create({
        data: {
          userId,
          type: 'sale',
          partyId: estimate.partyId,
          date: new Date(),
          subtotal: roundMoney(computed.subtotal),
          discountAmount: roundMoney(orderDiscount),
          cgst: roundMoney(computed.cgst),
          sgst: roundMoney(computed.sgst),
          igst: roundMoney(computed.igst),
          totalAmount,
          roundOff: roundMoney(roundOff),
          paidAmount: 0,  // new sale starts unpaid
          paymentMode: 'cash',
          isInterState,
          invoiceNo,
          invoiceSequence: counter.seq,
          grossProfit: roundMoney(computed.grossProfit),
          createdByUserId: authCtx.actingUserId,
          items: { create: computed.txItems },
        },
        include: { items: true, party: true },
      })

      // Mark the estimate as converted
      await tx.transaction.update({
        where: { id: estimate.id },
        data: {
          convertedToTransactionId: newSale.id,
          convertedAt: new Date(),
        },
      })

      // Apply stock adjustments for the new sale
      const stockPolicy = setting?.stockPolicy || 'allow'
      if (stockPolicy === 'block') {
        for (const item of computed.txItems) {
          if (!item.productId) continue
          const qty = item.quantity || 0
          const result = await tx.product.updateMany({
            where: { id: item.productId, userId, currentStock: { gte: qty } },
            data: { currentStock: { decrement: qty } },
          })
          if (result.count === 0) {
            const err: any = new Error('STOCK_BLOCK')
            err.code = 'STOCK_BLOCK'
            err.productName = item.productName
            err.requestedQty = qty
            throw err
          }
        }
      } else {
        await Promise.all(
          computed.txItems
            .filter(i => i.productId)
            .map(item => tx.product.updateMany({
              where: { id: item.productId!, userId },
              data: { currentStock: { decrement: item.quantity || 0 } },
            }))
        )
      }

      return newSale
    })

    return NextResponse.json({
      transaction: sale,
      estimateId: estimate.id,
      message: 'Estimate converted to sale successfully.',
    })
  } catch (err: any) {
    if (err?.code === 'STOCK_BLOCK') {
      return NextResponse.json({
        error: 'Not enough stock',
        message: `Cannot convert — not enough stock for ${err.productName} (need ${err.requestedQty} units). Record a purchase first or enable "Allow overselling" in Settings.`,
      }, { status: 400 })
    }
    return apiError(err, 'Failed to convert estimate', 500)
  }
}
