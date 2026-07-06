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
    const voided = searchParams.get('voided') === 'true'
    // 🔒 SECURITY (Audit fix Phase 1.5): Cap limit at 200 to prevent OOM.
    const requestedLimit = parseInt(searchParams.get('limit') || '100')
    const limit = Math.min(Math.max(1, isNaN(requestedLimit) ? 100 : requestedLimit), 200)
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    // 🔒 V8 U1: Support fetching voided (soft-deleted) transactions for the
    // "Voided" trail filter. Was: always filtered deletedAt: null. Now: if
    // voided=true, fetch ONLY deleted transactions (deletedAt: { not: null }).
    const where: any = voided
      ? { userId, deletedAt: { not: null } }
      : { userId, deletedAt: null }
    if (type && type !== 'all') where.type = type
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(to)
    }

    const transactions = await db.transaction.findMany({
      where,
      include: { items: true, party: true },
      orderBy: { date: 'desc' },
      take: limit,
    })

    return withCache({ transactions }, { maxAge: 30, swr: 300 })
  } catch (error) {
    // 🔒 V7 H4: Return 503 on DB error, NOT an empty 200. Was: returned
    // { transactions: [] } → user saw empty ledger during a DB blip and
    // panicked, possibly re-entering data. Now: return error so UI shows
    // retry state.
    console.error('Transactions GET error:', error)
    return NextResponse.json(
      {
        error: 'Failed to load transactions',
        message: 'Could not reach the database. Please retry.',
      },
      { status: 503 },
    )
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

    // 🔒 AUDIT FIX V5 MD: Negative-stock warning.
    // Was: sales decrement currentStock with no check — selling 100 units of
    // a product with 2 in stock succeeded silently and left currentStock = -98.
    // The auditor noted some kirana shops legitimately sell before recording
    // purchases, so BLOCKING may be wrong — but silently going negative with
    // no warning is also wrong for "the best ledger app."
    //
    // Approach: detect any sale item that would push stock below zero. Return
    // a `stockWarnings` array in the response (not an error — the sale still
    // goes through). The UI can show a visible warning toast/banner. The
    // warning includes the product name, current stock, requested quantity,
    // and the resulting (negative) stock — so the shopkeeper knows exactly
    // what happened and can fix it (record the missing purchase, etc.).
    //
    // If the request body includes `confirmOversell: true` (e.g. the user
    // clicked "Continue anyway" on a previous warning), we skip the warning
    // generation for that request — no need to warn twice.
    const stockWarnings: Array<{
      productId: string
      productName: string
      currentStock: number
      requestedQuantity: number
      resultingStock: number
    }> = []

    if (type === 'sale' && !body.confirmOversell) {
      for (const item of items) {
        if (!item.productId) continue
        const product = productMap.get(item.productId)
        if (!product) continue
        const requestedQty = Number(item.quantity) || 0
        const resultingStock = product.currentStock - requestedQty
        if (resultingStock < 0) {
          stockWarnings.push({
            productId: product.id,
            productName: product.name,
            currentStock: product.currentStock,
            requestedQuantity: requestedQty,
            resultingStock,
          })
        }
      }
    }

    const txItems = items.map((item: any) => {
      // 💰 MONEY (Audit fix Phase 4): Use roundMoney() at every calculation
      // step to prevent float precision drift. Was: raw arithmetic on Floats
      // which produced values like 9.000000000000002 from itemGst / 2.
      //
      // 🔒 V8 H1 FIX: GST is now computed on the POST-DISCOUNT taxable value.
      // Was: GST on pre-discount amount (quantity * unitPrice), discount
      // applied AFTER GST. This meant the stored cgst/sgst/igst didn't match
      // the GSTR export (which computes GST post-discount). Per GST law, the
      // taxable value is AFTER trade discount. Now: GST on (qty * unitPrice -
      // discount), matching the GSTR/reports SQL. All screens now agree.
      const grossAmount = roundMoney(item.quantity * item.unitPrice)
      const itemDiscount = roundMoney(item.discountAmount || 0)
      const taxableAmount = roundMoney(grossAmount - itemDiscount)  // post-discount
      const itemGst = calculateGst(taxableAmount, item.gstRate || 0)  // GST on post-discount
      const itemTotal = roundMoney(taxableAmount + itemGst)
      subtotal = roundMoney(subtotal + grossAmount)  // subtotal stays pre-discount (list price total)
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
        if (seqOverride) {
          invoiceSequence = seqOverride
        } else {
          // 🔒 V9 2.7 FIX: Was findFirst(orderBy desc) + 1 — a read-modify-write
          // race under READ COMMITTED. Two concurrent sales can read the same
          // max and both compute the same next number → P2002 collision → retry.
          // Now: use an atomic upsert on a per-user counter row. UPDATE SET
          // seq = seq + 1 RETURNING seq is atomic — no race, no gaps, no retry.
          const counter = await tx.invoiceCounter.upsert({
            where: { userId },
            update: { seq: { increment: 1 } },
            create: { userId, seq: 1 },
            select: { seq: true },
          })
          invoiceSequence = counter.seq
        }
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
      // 🔒 V9 2.1 FIX: Scope by userId to prevent cross-tenant stock manipulation.
      // Was: where: { id: item.productId } — no userId check. A client could
      // submit a foreign productId and modify another tenant's stock.
      // Now: updateMany with userId in the where clause → foreign IDs affect 0 rows.
      for (const item of txItems) {
        if (item.productId) {
          const qty = item.quantity || 0
          if (type === 'sale') {
            await tx.product.updateMany({
              where: { id: item.productId, userId },
              data: { currentStock: { decrement: qty } },
            })
          } else if (type === 'purchase') {
            await tx.product.updateMany({
              where: { id: item.productId, userId },
              data: { currentStock: { increment: qty } },
            })
          }
        }
      }

      return txn
    }

    // 🔒 V9 2.7: With the atomic InvoiceCounter upsert, the P2002 race should
    // never happen. Keep the retry loop as a safety net but it should be a no-op.
    let transaction
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        transaction = await db.$transaction(async (tx) => {
          return createTransactionWithStock(tx)
        })
        break
      } catch (err: any) {
        // P2002 = unique constraint violation on invoiceNo (extremely unlikely
        // with the atomic counter, but handle it just in case)
        if (err?.code === 'P2002' && attempt < 2) {
          // The counter already incremented, so the next attempt will get a
          // new sequence number automatically. Just retry.
          continue
        }
        throw err
      }
    }

    return NextResponse.json({
      transaction,
      // 🔒 V5 MD: Include stock warnings so the UI can surface them.
      // Empty array = no warnings. Non-empty = the UI should show a visible
      // banner ("⚠️ Sold 100 units of X but only 2 were in stock. Stock is
      // now -98. Record the missing purchase?").
      stockWarnings,
    })
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
