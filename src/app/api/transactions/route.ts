import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { roundMoney, calculateGst, splitGst } from '@/lib/money'
import { deriveInterStateStatus } from '@/lib/gst'
import { validateBody, createTransactionSchema } from '@/lib/validation'

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

    // 🔒 BUG FIX V5: Use deletedAt filter only if the column exists.
    // If the migration hasn't run yet, querying deletedAt crashes with 500.
    // Fallback: query without deletedAt (soft-delete won't work until migration runs).
    const where: any = { userId }
    if (type && type !== 'all') where.type = type
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(to)
    }

    let transactions
    try {
      // Try with deletedAt filter (migration has run)
      transactions = await db.transaction.findMany({
        where: { ...where, deletedAt: null },
        include: { items: true, party: true },
        orderBy: { date: 'desc' },
        take: limit,
      })
    } catch {
      // Fallback: without deletedAt (migration hasn't run yet)
      transactions = await db.transaction.findMany({
        where,
        include: { items: true, party: true },
        orderBy: { date: 'desc' },
        take: limit,
      })
    }

    return withCache({ transactions }, { maxAge: 30, swr: 300 })
  } catch (error) {
    console.error('Transactions GET error:', error)
    console.error("[transactions] DB error:", error); return NextResponse.json({ transactions: [] })
  }
}

// POST /api/transactions - create new transaction (sale, purchase, income, expense)
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()

    // 🔒 AUDIT FIX H7: Validate request body with zod before processing.
    // Was: raw parseFloat on untrusted input — NaN prices, missing fields,
    // 10MB notes could crash or store garbage.
    const validation = validateBody(createTransactionSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', detail: validation.error }, { status: 400 })
    }

    const { type, partyId, date, items, discountAmount, paymentMode, notes, invoiceNo, category, paidAmount, payeeName, payeePhone } = validation.data as any

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
      // 💰 MONEY + COGS (Audit fix M4): Profit calculation uses the product's
      // CURRENT purchasePrice (snapshotted into purchasePriceAtSale for future
      // reference). Historical profit is now immutable — changing the product's
      // purchasePrice later won't distort old profit numbers.
      let purchasePriceAtSale = 0
      if (type === 'sale' && item.productId) {
        const product = productMap.get(item.productId)
        if (product) {
          purchasePriceAtSale = product.purchasePrice
          grossProfit = roundMoney(grossProfit + (item.unitPrice - product.purchasePrice) * item.quantity)
        }
      }
      return {
        productId: item.productId || null,
        productName: item.productName,
        quantity: parseFloat(item.quantity),
        unitPrice: parseFloat(item.unitPrice),
        purchasePriceAtSale,  // 🔒 M4: COGS snapshot
        gstRate: parseFloat(item.gstRate) || 0,
        discountAmount: parseFloat(item.discountAmount) || 0,
        total: itemTotal,
      }
    })

    const discount = parseFloat(discountAmount) || 0
    const totalAmount = roundMoney(subtotal - discount + cgst + sgst + igst)
    const paid = parseFloat(paidAmount)
    const finalPaid = isNaN(paid) ? totalAmount : paid

    // 🔒 AUDIT FIX N3 (v3): Invoice sequence generation is now INSIDE the
    // $transaction with retry-on-P2002. Was: max()+1 OUTSIDE the transaction
    // → race condition → duplicate invoiceNo → P2002 → 500 → sale lost.
    // Now: if invoiceNo is needed, generate it inside the transaction. If
    // P2002 (duplicate), retry with next sequence number (up to 3 attempts).

    const createTransactionWithStock = async (tx: any, invoiceNoOverride?: string, seqOverride?: number) => {
      let finalInvoiceNo = invoiceNo || invoiceNoOverride || null
      let invoiceSequence: number | null = seqOverride || null

      if (!finalInvoiceNo && (type === 'sale' || type === 'purchase')) {
        // Find the highest existing sequence INSIDE the transaction
        const lastTxn = await tx.transaction.findFirst({
          where: { userId, invoiceSequence: { not: null } },
          orderBy: { invoiceSequence: 'desc' },
          select: { invoiceSequence: true },
        })
        invoiceSequence = (lastTxn?.invoiceSequence || 0) + 1
        if (seqOverride) invoiceSequence = seqOverride
        finalInvoiceNo = `INV-${String(invoiceSequence).padStart(4, '0')}`
      }

      const txn = await tx.transaction.create({
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
          invoiceNo: finalInvoiceNo,
          invoiceSequence,
          grossProfit: roundMoney(grossProfit),
          clientMutationId: clientMutationId || null,
          items: { create: txItems },
        },
        include: { items: true, party: true },
      })

      // Update product stock for each item with a productId
      for (const item of txItems) {
        if (item.productId) {
          const qty = item.quantity || 0
          if (type === 'sale') {
            await tx.product.update({
              where: { id: item.productId },
              data: { currentStock: { decrement: qty } },
            })
          } else if (type === 'purchase') {
            await tx.product.update({
              where: { id: item.productId },
              data: { currentStock: { increment: qty } },
            })
          }
        }
      }

      return txn
    }

    // Try up to 3 times (in case of P2002 duplicate invoiceNo race condition)
    let transaction
    let lastSeq = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        transaction = await db.$transaction(async (tx) => {
          return createTransactionWithStock(tx, undefined, lastSeq || undefined)
        })
        break
      } catch (err: any) {
        // P2002 = unique constraint violation on invoiceNo
        if (err?.code === 'P2002' && attempt < 2) {
          // Get the current max sequence and try again with next number
          const lastTxn = await db.transaction.findFirst({
            where: { userId, invoiceSequence: { not: null } },
            orderBy: { invoiceSequence: 'desc' },
            select: { invoiceSequence: true },
          })
          lastSeq = (lastTxn?.invoiceSequence || 0) + attempt + 2
          continue
        }
        throw err
      }
    }

    return NextResponse.json({ transaction })
  } catch (error) {
    console.error('Transactions POST error:', error)
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
  }
}

// DELETE /api/transactions?id=xxx
// 🔒 AUDIT FIX N4 (v3): This query-param DELETE handler has been removed.
// It was a HARD delete (db.transaction.delete) that bypassed soft-delete,
// didn't reverse stock, and had no audit trail. The correct delete path
// is /api/transactions/[id] DELETE which does soft-delete + stock reversal.
// Any client calling this endpoint should be updated to use /api/transactions/[id].
export async function DELETE(req: NextRequest) {
  return NextResponse.json({
    error: 'This endpoint is deprecated. Use DELETE /api/transactions/[id] instead.',
  }, { status: 410 })  // 410 Gone
}
