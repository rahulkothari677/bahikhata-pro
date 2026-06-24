import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'

export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const products = await db.product.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    })

    const transactions = await db.transaction.findMany({
      where: { userId, items: { some: {} } },
      include: { items: true },
    })

    const stockMap = new Map<string, number>()
    products.forEach(p => stockMap.set(p.id, p.openingStock))
    transactions.forEach(t => {
      t.items.forEach(item => {
        if (item.productId) {
          const current = stockMap.get(item.productId) || 0
          if (t.type === 'purchase') stockMap.set(item.productId, current + item.quantity)
          else if (t.type === 'sale') stockMap.set(item.productId, current - item.quantity)
        }
      })
    })

    const productsWithStock = products.map(p => ({
      ...p,
      currentStock: stockMap.get(p.id) || 0,
      stockValue: (stockMap.get(p.id) || 0) * p.purchasePrice,
      isLowStock: (stockMap.get(p.id) || 0) <= p.lowStockThreshold,
    }))

    return NextResponse.json({ products: productsWithStock })
  } catch (error) {
    console.error('Products GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
