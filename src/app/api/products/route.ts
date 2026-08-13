import { NextRequest, NextResponse } from 'next/server'
import { suggestGstTreatment } from '@/lib/gst-treatment'
import { defaultTracksInventory, tracksStock } from '@/lib/inventory-tracking'
import { findUnknownFields, schemaFields } from '@/lib/unknown-fields'
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
    // 🔒 #71: same as parties — the fuse stays, the silence goes. See the
    // comment there for why removing the cap would be the wrong fix.
    const products = await withConnectionRetry(() => db.product.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      take: 5000,
    }))

    const productsWithStock = products.map(p => {
      /*
       * A service has no stock, so every stock-derived flag must be OFF.
       *
       * Derived HERE rather than in each screen on purpose. currentStock for a
       * service is a permanent 0, and 0 <= lowStockThreshold is true — so
       * without this, the moment a salon adds "Haircut" it is reported as low
       * stock forever, and the dashboard, the low-stock filter, SmartInsights,
       * the notification bell and the CSV export ALL inherit that from these
       * three fields. One correction at the source fixes every one of them,
       * and no future screen can miss it.
       *
       * stockValue is 0 rather than absent: a service genuinely contributes
       * nothing to what the shop's stock is worth, and the totals that sum
       * this field must keep summing a number.
       */
      const counts = tracksStock(p)
      const base: any = {
        ...p,
        currentStock: p.currentStock,
        stockValue: counts ? roundMoney(Math.max(0, p.currentStock) * p.purchasePrice) : 0,
        isLowStock: counts && p.currentStock <= p.lowStockThreshold,
        isOversold: counts && p.currentStock < 0,
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
    const totalProducts = await db.product.count({ where: { userId } })
    return noStore({
      products: productsWithStock,
      total: totalProducts,
      truncated: totalProducts > products.length,
    })
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

    /*
     * A field we do not understand is an error, not a shrug.
     *
     * `{ name: 'Rice', stock: 100 }` used to return 200 and create the product
     * with ZERO stock — the field is `openingStock`, and zod dropped `stock`
     * without a word. The shopkeeper found out when the till said there was
     * nothing to sell.
     *
     * No allowed extras here: this route reads nothing off the body that the
     * schema does not declare.
     */
    const unknownFields = findUnknownFields(body, schemaFields(createProductSchema))
    if (unknownFields) {
      return NextResponse.json({
        error: 'Unknown field',
        message: unknownFields.message,
        unknownFields: unknownFields.unknown,
        suggestions: unknownFields.suggestions,
      }, { status: 400 })
    }

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
        barcode: v.barcode || null,
        hsn: v.hsn || null,
        category: v.category || null,
        unit: v.unit || 'pcs',
        purchasePrice: v.purchasePrice,
        salePrice: v.salePrice,
        mrp: v.mrp ?? null,
        gstRate: v.gstRate,
        openingStock: v.openingStock,
        currentStock: v.openingStock,  // currentStock starts at openingStock
        /*
         * Goods unless the shopkeeper says otherwise, or the code says so.
         *
         * The same "only ever fill a gap" rule as gstTreatment below: an
         * explicit choice from the client always wins — `?? ` only fires on
         * undefined, so a deliberate `false` survives — and the SAC prefix
         * merely supplies a sensible default for someone who typed 9971 and
         * has no idea the app has a stock model at all.
         *
         * Deliberately NOT defaulted in the zod schema: a zod `.default()`
         * would turn "the client said nothing" into "the client said true"
         * before this line could tell the two apart.
         */
        tracksInventory: v.tracksInventory ?? defaultTracksInventory(v.hsn),
        lowStockThreshold: v.lowStockThreshold,
        notes: v.notes || null,
        // 🔒 V17 Audit Phase 5: priceIncludesGst was in the schema but NOT persisted
        // (pre-existing bug — the checkbox had no effect on the stored product).
        // Now persisted. Also persist gstTreatment (§4.2).
        priceIncludesGst: v.priceIncludesGst,
        /*
         * Suggest the treatment from the HSN when the client did not state one.
         *
         * gstTreatment defaults to 'taxable' in the schema, and nothing ever
         * set it — so every zero-tax product a shopkeeper created sat in the
         * wrong Table 8 box until they thought to change it. A kirana owner has
         * no reason to know that milk is "exempt" while a 0% cereal is
         * "nil-rated"; the distinction is real in law and invisible in a shop.
         *
         * Only ever fills a gap: an explicit choice from the client wins, and
         * the suggester returns null wherever it is not confident.
         */
        gstTreatment: v.gstTreatment && v.gstTreatment !== 'taxable'
          ? v.gstTreatment
          : (suggestGstTreatment(v.hsn, v.gstRate ?? 0) ?? v.gstTreatment),
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

    // Same rejection as POST. `updatedAt` is read straight off the body for the
    // concurrent-edit check below and is not a schema field, so it is named
    // here rather than left to be silently tolerated.
    const unknownFields = findUnknownFields(body, schemaFields(updateProductSchema), ['id', 'updatedAt'])
    if (unknownFields) {
      return NextResponse.json({
        error: 'Unknown field',
        message: unknownFields.message,
        unknownFields: unknownFields.unknown,
        suggestions: unknownFields.suggestions,
      }, { status: 400 })
    }

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
    if (v.barcode !== undefined) updateData.barcode = v.barcode || null
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
    // No HSN fallback on edit, unlike create. Once a product exists, its
    // goods/service nature is a decision someone made; re-deriving it from a
    // code they happened to edit could silently flip a tracked product to
    // untracked and strand its stock. Only an explicit value changes it.
    if (v.tracksInventory !== undefined) updateData.tracksInventory = v.tracksInventory
    if (v.notes !== undefined) updateData.notes = v.notes
    // 🔒 V17 Audit Phase 5: Persist priceIncludesGst (was missing) + gstTreatment
    if (v.priceIncludesGst !== undefined) updateData.priceIncludesGst = v.priceIncludesGst
    if (v.gstTreatment !== undefined) {
      // Same rule on edit: an explicit non-default choice is respected; the
      // untouched 'taxable' default on a zero-tax good gets the suggestion.
      updateData.gstTreatment = v.gstTreatment !== 'taxable'
        ? v.gstTreatment
        : (suggestGstTreatment(v.hsn, v.gstRate ?? 0) ?? v.gstTreatment)
    }

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
