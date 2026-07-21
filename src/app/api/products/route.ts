import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthContext, getAuthUserIdWithModule } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { withCache, noStore } from '@/lib/cache'
import { checkEntityLimit } from '@/lib/usage-limits'
import { roundMoney } from '@/lib/money'
import { validateBody, createProductSchema, updateProductSchema } from '@/lib/validation'
import { apiError } from '@/lib/api-error'

export async function GET() {
  try {
    // 🔒 R15 v2 (Verification Ledger): Switch from getAuthUserIdWithModule to
    // getAuthContext so we can check hideProfit + role. The earlier fix only
    // hid profit in the UI (Inventory.tsx); this endpoint still returned
    // purchasePrice (cost price) to staff, letting them compute margins.
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'inventory')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = authCtx.userId
    const hideProfit = await shouldHideProfit(userId, authCtx.role)

    // 🔒 AUDIT FIX N2 (v3): Read currentStock directly from the Product column
    // instead of re-deriving it from ALL transaction items on every page load.
    // Was: O(all transaction items) per request — fetch all items, compute stock.
    // Now: O(1) — just read the column. The column is maintained atomically
    // on every transaction create/edit/delete (inside $transaction).
    // 🔒 V26 R15 (Phase 5): Wrapped in withConnectionRetry for Neon cold-start.
    const products = await withConnectionRetry(() => db.product.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      take: 5000,  // 🔒 V26 R20 (Phase 5): fuse — not pagination. Kirana scale ≤2k products.
    }))

    const productsWithStock = products.map(p => {
      const base: any = {
        ...p,
        currentStock: p.currentStock,
        stockValue: roundMoney(Math.max(0, p.currentStock) * p.purchasePrice),
        isLowStock: p.currentStock <= p.lowStockThreshold,
        isOversold: p.currentStock < 0,
      }
      // 🔒 R15 v2 (Verification Ledger): Strip purchasePrice + stockValue for
      // staff+hideProfit. purchasePrice is the cost price — combined with
      // salePrice (which staff need for billing), it reveals the margin.
      if (hideProfit) {
        base.purchasePrice = undefined
        base.stockValue = undefined
      }
      return base
    })

    // 🔒 AUDIT V25 FIX BUG-031 (Batch 5): Was withCache({ maxAge: 60, swr: 300 }).
    // Money-bearing endpoint — stock counts + sale prices must always be fresh.
    // A shopkeeper who just made a sale would see stale stock for up to 60s.
    return noStore({ products: productsWithStock })
  } catch (error) {
    // 🔒 V11 §4.2: Use apiError() for consistent errorId logging.
    // Was: console.error + generic 503 with no errorId.
    return apiError(error, 'Failed to load products. The database might be warming up — please retry.', 503)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 🔒 AUDIT FIX H2: Enforce plan limit on product count (was: no check)
    const limitCheck = await checkEntityLimit(userId, 'products')
    if (!limitCheck.allowed) {
      return NextResponse.json({
        error: 'plan_limit_reached',
        message: limitCheck.upgradeMessage,
        used: limitCheck.used,
        limit: limitCheck.limit,
      }, { status: 402 })
    }

    const body = await req.json()

    // 🔒 AUDIT FIX V7 M4: Validate with zod. Was: parseFloat(body.x) || 0
    // with no validation → negative prices accepted, missing name → 500.
    // Now: zod rejects negative prices/stock/GST and missing name with 400.
    const validation = validateBody(createProductSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', detail: validation.error }, { status: 400 })
    }
    const v = validation.data

    const product = await db.product.create({
      data: {
        userId,
        name: v.name,
        sku: v.sku || null,
        hsn: v.hsn || null,
        category: v.category || null,
        unit: v.unit || 'pcs',
        purchasePrice: v.purchasePrice,
        salePrice: v.salePrice,
        mrp: v.mrp ?? null,
        gstRate: v.gstRate,
        openingStock: v.openingStock,
        currentStock: v.openingStock,  // currentStock starts at openingStock
        lowStockThreshold: v.lowStockThreshold,
        notes: v.notes || null,
        // 🔒 V17 Audit Phase 5: priceIncludesGst was in the schema but NOT persisted
        // (pre-existing bug — the checkbox had no effect on the stored product).
        // Now persisted. Also persist gstTreatment (§4.2).
        priceIncludesGst: v.priceIncludesGst,
        gstTreatment: v.gstTreatment,
      },
    })
    return NextResponse.json({ product })
  } catch (error) {
    return apiError(error, 'Failed to create product', 500)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    // Verify ownership
    const existing = await db.product.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()

    // 🔒 AUDIT FIX V7 M4: Validate with zod on update too.
    const validation = validateBody(updateProductSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', detail: validation.error }, { status: 400 })
    }
    const v = validation.data

    // Only update fields that were actually provided (zod makes them optional)
    const updateData: any = {}
    if (v.name !== undefined) updateData.name = v.name
    if (v.sku !== undefined) updateData.sku = v.sku
    if (v.hsn !== undefined) updateData.hsn = v.hsn
    if (v.category !== undefined) updateData.category = v.category
    if (v.unit !== undefined) updateData.unit = v.unit
    if (v.purchasePrice !== undefined) updateData.purchasePrice = v.purchasePrice
    if (v.salePrice !== undefined) updateData.salePrice = v.salePrice
    if (v.mrp !== undefined) updateData.mrp = v.mrp
    if (v.gstRate !== undefined) updateData.gstRate = v.gstRate
    if (v.openingStock !== undefined) {
      updateData.openingStock = v.openingStock
      // 🔒 V26 H8 FIX: If openingStock changes, adjust currentStock by the
      // same delta. Was: read existing.openingStock → compute delta → increment.
      // Race: between read and update, a concurrent sale could decrement
      // currentStock, making the delta wrong. Now: use a conditional update
      // that reads openingStock inside the same atomic operation via a
      // $transaction. The increment is still correct because we re-read
      // the current openingStock inside the transaction.
      const delta = v.openingStock - existing.openingStock
      // Wrap in $transaction to make the read+write atomic
      await db.$transaction(async (tx) => {
        const fresh = await tx.product.findFirst({ where: { id, userId }, select: { openingStock: true } })
        if (!fresh) throw new Error('Product not found')
        const freshDelta = v.openingStock! - fresh.openingStock
        await tx.product.update({
          where: { id },
          data: {
            openingStock: v.openingStock,
            currentStock: { increment: freshDelta },
          },
        })
      })
      // Don't include openingStock/currentStock in the outer updateData —
      // they were already updated inside the transaction above.
      delete updateData.openingStock
    }
    if (v.lowStockThreshold !== undefined) updateData.lowStockThreshold = v.lowStockThreshold
    if (v.notes !== undefined) updateData.notes = v.notes
    // 🔒 V17 Audit Phase 5: Persist priceIncludesGst (was missing) + gstTreatment
    if (v.priceIncludesGst !== undefined) updateData.priceIncludesGst = v.priceIncludesGst
    if (v.gstTreatment !== undefined) updateData.gstTreatment = v.gstTreatment

    // 🔒 V26 R11 (Phase 5): Concurrent-edit warning (same pattern as parties PUT).
    // Client sends `updatedAt` as loaded. Server compares; on mismatch, still
    // applies the write but returns a `conflictWarning`.
    const clientUpdatedAt = body.updatedAt ? new Date(body.updatedAt) : null
    let conflictWarning: string | null = null
    if (clientUpdatedAt && existing.updatedAt && clientUpdatedAt.getTime() !== existing.updatedAt.getTime()) {
      const serverTime = new Date(existing.updatedAt).toLocaleString('en-IN')
      conflictWarning = `This product was also edited on another device at ${serverTime} — please verify the details.`
    }

    const product = await db.product.update({
      where: { id },
      data: updateData,
    })
    const response: any = { product }
    if (conflictWarning) response.conflictWarning = conflictWarning
    return NextResponse.json(response)
  } catch (error) {
    return apiError(error, 'Failed to update product', 500)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('inventory')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    // Verify ownership
    const existing = await db.product.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.product.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Failed to delete product', 500)
  }
}
