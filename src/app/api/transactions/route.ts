import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { roundMoney, calculateGst, splitGst, distributeDiscountProportionally, toMoney } from '@/lib/money'
import { deriveInterStateStatus } from '@/lib/gst'
import { validateBody, createTransactionSchema } from '@/lib/validation'
import { apiError } from '@/lib/api-error'
import { computeLineItems, buildPriceWarnings } from '@/lib/line-items'
import { normalizeToUnit } from '@/lib/units'

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

    // 🔒 FIX M5: Was `include: { items: true, party: true }` — loaded ALL item
    // fields for all 200 transactions (~1000 rows × 15 columns each). The list
    // view only needs: productName + quantity (for the 4-item preview) + count.
    // Now: uses `select` to fetch only the fields the list view actually uses.
    // Full item details are fetched via /api/transactions/[id] when expanded.
    const transactions = await db.transaction.findMany({
      where,
      include: {
        items: { select: { productName: true, quantity: true } },
        party: { select: { name: true, phone: true, gstin: true } },
      },
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

    // 🔒 V11 STOCK POLICY: Fetch the shop's stock policy early so we can
    // block or warn before computing anything. Also fetches roundOffEnabled
    // (used later for invoice round-off). Single PK lookup on Setting (~1-2ms).
    const setting = await db.setting.findUnique({
      where: { userId },
      select: { roundOffEnabled: true, stockPolicy: true },
    })
    const stockPolicy = setting?.stockPolicy || 'block'  // default: block

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
        // 🔒 V12: Convert the requested quantity into the product's unit before
        // comparing to stock, so "500 gm" of a kg-tracked product checks against
        // 0.5 kg — not 500. Without this the warning fired on every gm sale.
        const requestedQty = normalizeToUnit(
          Number(item.quantity) || 0,
          item.unit || product.unit,
          product.unit,
        ).quantity
        const resultingStock = roundMoney(product.currentStock - requestedQty)
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

    // 🔒 V11 STOCK POLICY: If policy is 'block' and there are stock warnings,
    // REJECT the sale with 400. The user must either:
    //   (a) record a purchase to replenish stock, OR
    //   (b) toggle "Allow overselling" in Settings, OR
    //   (c) send confirmOversell: true (for the "are you sure?" flow — but
    //       only if the client explicitly implements this override).
    //
    // If policy is 'allow' (kirana mode), proceed with the current behavior —
    // the sale goes through and stockWarnings[] is returned in the response.
    if (type === 'sale' && stockPolicy === 'block' && stockWarnings.length > 0 && !body.confirmOversell) {
      const lines = stockWarnings.map(w =>
        `• ${w.productName}: have ${w.currentStock}, selling ${w.requestedQuantity}, would go to ${w.resultingStock}`
      ).join('\n')
      return NextResponse.json({
        error: 'Not enough stock',
        message: `This sale would push stock below zero:\n${lines}\n\nRecord a purchase first, or enable "Allow overselling" in Settings.`,
        stockWarnings,
        hint: 'To allow overselling, go to Settings and turn on "Allow overselling (kirana mode)".',
      }, { status: 400 })
    }

    // 🔒 V12: Price/unit anomaly guardrail (defense-in-depth). Non-blocking —
    // warns on implausible lines like "₹20/kg entered as ₹20/gm → ₹10,000".
    const priceWarnings = body.confirmOversell ? [] : buildPriceWarnings(items, productMap)

    // 🔒 V12: Line-item money math is centralized in computeLineItems() so POST
    // and PUT share ONE implementation. It folds in: unit normalization (500 gm
    // on a ₹20/kg product → 0.5 kg), GST-inclusive back-calculation (MRP), and
    // the V10 proportional discount distribution.
    const orderDiscount = toMoney(discountAmount)

    // 🔒 AUDITOR FIX: Was a duplicated preSubtotal block that re-implemented
    // the GST-inclusive back-calc + unit normalization (the exact duplication
    // line-items.ts warns against). Now: call computeLineItems FIRST, then use
    // computed.subtotal for the over-discount check. This guarantees the check
    // uses the exact same number as the real computation — no drift possible.
    // distributeDiscountProportionally already clamps safely if discount >
    // subtotal, so computing first is fine (the rejection below prevents the
    // bad state from being stored).
    const computed = computeLineItems({ items, productMap, isInterState, orderDiscount, type })
    const txItems = computed.txItems
    subtotal = computed.subtotal
    cgst = computed.cgst
    sgst = computed.sgst
    igst = computed.igst
    grossProfit = computed.grossProfit

    // 🔒 V11 §4.3: Reject over-discount (discount > subtotal). Keep the
    // rejection (return 400) — don't silently clamp.
    if (orderDiscount > computed.subtotal) {
      return NextResponse.json({
        error: 'Discount cannot exceed subtotal',
        message: `The discount (₹${orderDiscount.toFixed(2)}) is greater than the subtotal (₹${computed.subtotal.toFixed(2)}). Please reduce the discount and try again.`,
      }, { status: 400 })
    }

    // 🔒 V12: Invoice round-off (nearest rupee) when the user has enabled it.
    // 🔒 V11: `setting` was fetched earlier (with stockPolicy). Reuse it here.
    let totalAmount = computed.totalBeforeRoundOff
    let roundOff = 0
    if (setting?.roundOffEnabled) {
      const rounded = Math.round(totalAmount)
      roundOff = roundMoney(rounded - totalAmount)
      totalAmount = rounded
    }

    const discount = orderDiscount  // stored in the header; already folded into per-item taxable
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
          roundOff: roundMoney(roundOff),  // 🔒 V12
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
      // 🔒 FIX H1+H12: In 'block' mode, the stock check is done INSIDE the
      // $transaction using a conditional WHERE clause (currentStock >= qty).
      // This closes the race condition. In 'allow' mode and for purchases,
      // we batch the updates with Promise.all (H12 — was sequential, N round-trips).
      if (type === 'sale' && stockPolicy === 'block') {
        // Block mode: must check each item individually (needs result.count)
        for (const item of txItems) {
          if (!item.productId) continue
          const qty = item.quantity || 0
          const result = await tx.product.updateMany({
            where: { id: item.productId, userId, currentStock: { gte: qty } },
            data: { currentStock: { decrement: qty } },
          })
          if (result.count === 0) {
            const err: any = new Error('STOCK_BLOCK')
            err.code = 'STOCK_BLOCK'
            err.productName = item.productName
            err.requestedQty = qty
            throw err
          }
        }
      } else {
        // 🔒 FIX H12: Allow mode + purchases — batch with Promise.all instead
        // of sequential loop. N items → 1 parallel batch (was N sequential round-trips).
        await Promise.all(txItems.filter(i => i.productId).map(item => {
          const qty = item.quantity || 0
          if (type === 'sale') {
            return tx.product.updateMany({
              where: { id: item.productId!, userId },
              data: { currentStock: { decrement: qty } },
            })
          } else {
            return tx.product.updateMany({
              where: { id: item.productId!, userId },
              data: { currentStock: { increment: qty } },
            })
          }
        }))
      }

      return txn
    }

    // 🔒 V9 2.7: With the atomic InvoiceCounter upsert, the P2002 race should
    // never happen. Keep the retry loop as a safety net but it should be a no-op.
    let transaction
    try {
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
    } catch (err: any) {
      // 🔒 FIX H1: Catch the STOCK_BLOCK error from inside the $transaction.
      // This happens when a concurrent sale took the stock between our pre-check
      // and the actual decrement. The $transaction has already rolled back.
      if (err?.code === 'STOCK_BLOCK') {
        return NextResponse.json({
          error: 'Not enough stock',
          message: `Another sale just took the last ${err.requestedQty} units of ${err.productName}. Please try again or record a purchase first.`,
          hint: 'To allow overselling, go to Settings and turn on "Allow overselling (kirana mode)".',
        }, { status: 400 })
      }
      throw err
    }

    return NextResponse.json({
      transaction,
      // 🔒 V5 MD: Include stock warnings so the UI can surface them.
      // Empty array = no warnings. Non-empty = the UI should show a visible
      // banner ("⚠️ Sold 100 units of X but only 2 were in stock. Stock is
      // now -98. Record the missing purchase?").
      stockWarnings,
      // 🔒 V12: Non-blocking price/unit anomaly warnings.
      priceWarnings,
    })
  } catch (error) {
    return apiError(error, 'Failed to create transaction', 500)
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
