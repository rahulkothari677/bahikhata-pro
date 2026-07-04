import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { checkEntityLimit } from '@/lib/usage-limits'

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
    console.error('Products GET error:', error)
    console.error("[products] DB error:", error); return NextResponse.json({ products: [] })
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
    const product = await db.product.create({
      data: {
        userId,
        name: body.name,
        sku: body.sku || null,
        hsn: body.hsn || null,
        category: body.category || null,
        unit: body.unit || 'pcs',
        purchasePrice: parseFloat(body.purchasePrice) || 0,
        salePrice: parseFloat(body.salePrice) || 0,
        mrp: body.mrp ? parseFloat(body.mrp) : null,
        gstRate: parseFloat(body.gstRate) || 0,
        openingStock: parseFloat(body.openingStock) || 0,
        lowStockThreshold: parseFloat(body.lowStockThreshold) || 5,
        notes: body.notes || null,
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
    const product = await db.product.update({
      where: { id },
      data: {
        name: body.name,
        sku: body.sku || null,
        hsn: body.hsn || null,
        category: body.category || null,
        unit: body.unit || 'pcs',
        purchasePrice: parseFloat(body.purchasePrice) || 0,
        salePrice: parseFloat(body.salePrice) || 0,
        mrp: body.mrp ? parseFloat(body.mrp) : null,
        gstRate: parseFloat(body.gstRate) || 0,
        openingStock: parseFloat(body.openingStock) || 0,
        lowStockThreshold: parseFloat(body.lowStockThreshold) || 5,
        notes: body.notes || null,
      },
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
