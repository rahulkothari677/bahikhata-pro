import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'

// GET /api/transactions - list with filters (type, from, to, limit)
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')
    // 🔒 SECURITY (Audit fix Phase 1.5): Cap limit at 200 to prevent OOM.
    // Without this, a client could request ?limit=99999999 and force the
    // serverless function to load the entire table into memory → crash.
    // 200 is enough for any realistic list view; longer lists use pagination.
    const requestedLimit = parseInt(searchParams.get('limit') || '100')
    const limit = Math.min(Math.max(1, isNaN(requestedLimit) ? 100 : requestedLimit), 200)
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const where: any = { userId }
    if (type && type !== 'all') where.type = type
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(to)
    }

    const transactions = await db.transaction.findMany({
      where,
      include: {
        items: true,
        party: true,
      },
      orderBy: { date: 'desc' },
      take: limit,
    })

    return withCache({ transactions }, { maxAge: 30, swr: 300 })
  } catch (error) {
    console.error('Transactions GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  }
}

// POST /api/transactions - create new transaction (sale, purchase, income, expense)
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { type, partyId, date, items, discountAmount, paymentMode, isInterState, notes, invoiceNo, category, paidAmount, payeeName, payeePhone } = body

    // Verify party ownership (if provided)
    if (partyId) {
      const party = await db.party.findFirst({ where: { id: partyId, userId } })
      if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // Calculate totals
    let subtotal = 0
    let cgst = 0, sgst = 0, igst = 0
    let grossProfit = 0

    // For income/expense - just total amount
    if (type === 'income' || type === 'expense') {
      const amount = parseFloat(body.totalAmount) || 0
      const transaction = await db.transaction.create({
        data: {
          userId,
          type,
          category: category || null,
          date: new Date(date || new Date()),
          subtotal: amount,
          totalAmount: amount,
          paidAmount: amount,
          paymentMode: paymentMode || 'cash',
          notes: notes || null,
          invoiceNo: invoiceNo || null,
          payeeName: payeeName || null,
          payeePhone: payeePhone || null,
        },
        include: { items: true, party: true },
      })
      return NextResponse.json({ transaction })
    }

    // For sale/purchase - compute from items
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }

    // Get product details for profit calc (for sales)
    const productIds = items.map((i: any) => i.productId).filter(Boolean)
    const products = productIds.length > 0 ? await db.product.findMany({ where: { id: { in: productIds }, userId } }) : []
    const productMap = new Map(products.map(p => [p.id, p]))

    const txItems = items.map((item: any) => {
      const amount = item.quantity * item.unitPrice
      const itemGst = amount * (item.gstRate || 0) / 100
      const itemTotal = amount - (item.discountAmount || 0) + itemGst
      subtotal += amount
      if (isInterState) {
        igst += itemGst
      } else {
        cgst += itemGst / 2
        sgst += itemGst / 2
      }
      // Profit calculation for sales
      if (type === 'sale' && item.productId) {
        const product = productMap.get(item.productId)
        if (product) {
          grossProfit += (item.unitPrice - product.purchasePrice) * item.quantity
        }
      }
      return {
        productId: item.productId || null,
        productName: item.productName,
        quantity: parseFloat(item.quantity),
        unitPrice: parseFloat(item.unitPrice),
        gstRate: parseFloat(item.gstRate) || 0,
        discountAmount: parseFloat(item.discountAmount) || 0,
        total: itemTotal,
      }
    })

    const discount = parseFloat(discountAmount) || 0
    const totalAmount = subtotal - discount + cgst + sgst + igst
    const paid = parseFloat(paidAmount)
    const finalPaid = isNaN(paid) ? totalAmount : paid

    const transaction = await db.transaction.create({
      data: {
        userId,
        type,
        partyId: partyId || null,
        date: new Date(date || new Date()),
        subtotal,
        discountAmount: discount,
        cgst,
        sgst,
        igst,
        totalAmount,
        paidAmount: finalPaid,
        paymentMode: paymentMode || 'cash',
        isInterState: !!isInterState,
        notes: notes || null,
        invoiceNo: invoiceNo || null,
        grossProfit,
        items: { create: txItems },
      },
      include: { items: true, party: true },
    })

    return NextResponse.json({ transaction })
  } catch (error) {
    console.error('Transactions POST error:', error)
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
  }
}

// DELETE /api/transactions?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    // Verify ownership
    const existing = await db.transaction.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.transaction.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Transactions DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 })
  }
}
