import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { checkEntityLimit } from '@/lib/usage-limits'
import { validateBody, createProductSchema, updateProductSchema } from '@/lib/validation'

export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 🔒 AUDIT FIX N2 (v3): Read currentStock directly from the Product column
    // instead of re-deriving it from ALL transaction items on every page load.
    // Was: O(all transaction items) per request — fetch all items, compute stock.
    // Now: O(1) — just read the column. The column is maintained atomically
    // on every transaction create/edit/delete (inside $transaction).
    const products = await db.product.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    })

    const productsWithStock = products.map(p => ({
      ...p,
      currentStock: p.currentStock,  // 🔒 N2: read directly from column
      stockValue: p.currentStock * p.purchasePrice,
      isLowStock: p.currentStock <= p.lowStockThreshold,
    }))

    return withCache({ products: productsWithStock }, { maxAge: 60, swr: 300 })
  } catch (error) {
    // 🔒 V7 H4: Return 503 on DB error, NOT an empty 200. Was: returned
    // { products: [] } → user saw empty inventory during a DB blip and
    // panicked. Now: return error so UI shows retry state.
    console.error('Products GET error:', error)
    return NextResponse.json(
      {
        error: 'Failed to load products',
        message: 'Could not reach the database. Please retry.',
      },
      { status: 503 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
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
      },
    })
    return NextResponse.json({ product })
  } catch (error) {
    console.error('Products POST error:', error)
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
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
      // If openingStock changes, adjust currentStock by the same delta
      const delta = v.openingStock - existing.openingStock
      updateData.currentStock = { increment: delta }
    }
    if (v.lowStockThreshold !== undefined) updateData.lowStockThreshold = v.lowStockThreshold
    if (v.notes !== undefined) updateData.notes = v.notes

    const product = await db.product.update({
      where: { id },
      data: updateData,
    })
    return NextResponse.json({ product })
  } catch (error) {
    console.error('Products PUT error:', error)
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
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
    console.error('Products DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 })
  }
}
