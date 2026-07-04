import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { roundMoney, calculateGst, splitGst } from '@/lib/money'
import { deriveInterStateStatus } from '@/lib/gst'

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
    const { type, partyId, date, items, discountAmount, paymentMode, notes, invoiceNo, category, paidAmount, payeeName, payeePhone } = body

    // 🔒 IDEMPOTENCY (Audit fix N1): Check for clientMutationId to prevent
    // duplicate transactions from offline sync replays. The client generates
    // a UUID per logical mutation and sends it as a header. If we've already
    // processed this mutation, return the existing transaction instead of
    // creating a duplicate.
    const clientMutationId = req.headers.get('x-client-mutation-id')
    if (clientMutationId) {
      const existing = await db.transaction.findUnique({
        where: { clientMutationId },
        include: { items: true, party: true },
      })
      if (existing) {
        // Already processed — return the existing transaction (idempotent)
        return NextResponse.json({ transaction: existing, idempotent: true })
      }
    }

    // 🔒 GST CORRECTNESS (Audit fix H3 v2): Derive isInterState server-side
    // using the shared helper (same logic for both POST and PUT).
    // Was: POST derived it server-side, PUT trusted the client flag.
    // Now: both use deriveInterStateStatus() from lib/gst.ts.
    const { isInterState, party } = await deriveInterStateStatus(userId, partyId)
    if (partyId && !party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
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
      // 💰 MONEY (Audit fix Phase 4): Use roundMoney() at every calculation
      // step to prevent float precision drift. Was: raw arithmetic on Floats
      // which produced values like 9.000000000000002 from itemGst / 2.
      const amount = roundMoney(item.quantity * item.unitPrice)
      const itemGst = calculateGst(amount, item.gstRate || 0)
      const itemTotal = roundMoney(amount - (item.discountAmount || 0) + itemGst)
      subtotal = roundMoney(subtotal + amount)
      if (isInterState) {
        igst = roundMoney(igst + itemGst)
      } else {
        // splitGst returns { cgst, sgst } both rounded to 2 decimal places,
        // and cgst + sgst === itemGst exactly (no drift)
        const { cgst: c, sgst: s } = splitGst(itemGst)
        cgst = roundMoney(cgst + c)
        sgst = roundMoney(sgst + s)
      }
      // Profit calculation for sales
      if (type === 'sale' && item.productId) {
        const product = productMap.get(item.productId)
        if (product) {
          grossProfit = roundMoney(grossProfit + (item.unitPrice - product.purchasePrice) * item.quantity)
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
    const totalAmount = roundMoney(subtotal - discount + cgst + sgst + igst)
    const paid = parseFloat(paidAmount)
    const finalPaid = isNaN(paid) ? totalAmount : paid

    const transaction = await db.transaction.create({
      data: {
        userId,
        type,
        partyId: partyId || null,
        date: new Date(date || new Date()),
        subtotal: roundMoney(subtotal),
        discountAmount: roundMoney(discount),
        cgst: roundMoney(cgst),
        sgst: roundMoney(sgst),
        igst: roundMoney(igst),
        totalAmount,
        paidAmount: roundMoney(finalPaid),
        paymentMode: paymentMode || 'cash',
        isInterState: !!isInterState,
        notes: notes || null,
        invoiceNo: invoiceNo || null,
        grossProfit: roundMoney(grossProfit),
        clientMutationId: clientMutationId || null,  // 🔒 N1: save for idempotency
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
