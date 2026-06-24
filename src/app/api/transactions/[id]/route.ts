import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'

// GET /api/transactions/[id] - get single transaction with all details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const transaction = await db.transaction.findFirst({
      where: { id, userId },
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
    console.error('Transaction GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch transaction' }, { status: 500 })
  }
}

// PUT /api/transactions/[id] - update transaction
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Verify ownership
    const existing = await db.transaction.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const { type, partyId, date, items, discountAmount, paymentMode, isInterState, notes, invoiceNo, category, paidAmount } = body

    // Verify party ownership (if provided)
    if (partyId) {
      const party = await db.party.findFirst({ where: { id: partyId, userId } })
      if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })
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

    let subtotal = 0
    let cgst = 0, sgst = 0, igst = 0
    let grossProfit = 0

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

    // Delete old items, then create new
    await db.transactionItem.deleteMany({ where: { transactionId: id } })

    const transaction = await db.transaction.update({
      where: { id },
      data: {
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
    console.error('Transaction PUT error:', error)
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
  }
}

// DELETE /api/transactions/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Verify ownership
    const existing = await db.transaction.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.transaction.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Transaction DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 })
  }
}
