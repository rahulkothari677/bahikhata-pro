import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule, getAuthContextForWrite } from '@/lib/get-auth'
import { fromPaise, parseMoney } from '@/lib/money'
import { istMonthStartOffset, getISTDateParts } from '@/lib/timezone'
import { computePartyBalance } from '@/lib/party-balance'
import { encodeKeysetCursor, buildKeysetWhere } from '@/lib/pagination'

// GET /api/parties/[id] - get party with paginated transactions + SQL aggregates
// ⚡ PERFORMANCE (Audit fix H4): Was loading ALL transactions with items into
// memory and reducing in JS. Now: SQL aggregates for stats + cursor pagination
// for the transaction list (max 50 per page). Monthly chart via SQL groupBy.
//
// 🔒 AUDIT FIX V5 HA (auditor V5 verification): ALL transaction queries in this
// file now filter `deletedAt: null` via the `activeTransactionWhere`-style
// inline filter. Was: queries had `where: { userId, partyId: id, type: 'sale' }`
// with NO `deletedAt: null` → soft-deleted sales still counted in customer
// balances and statements → money-correctness bug in the exact screen
// shopkeepers use to chase payments. This was a regression caught by the V5
// auditor — my V4 report claimed it was done; it wasn't.
//
// 🔒 AUDIT FIX V5 MA (auditor V5 verification): Monthly chart was hardcoded
// to zero (dead `monthlyAgg` query, hardcoded `sales: 0, purchases: 0` for
// every month). Now: real monthly data via `$queryRaw` with `date_trunc`.
//
// 🔒 AUDIT FIX V5 MB (auditor V5 verification): Top products showed `amount: 0`
// for every row. Now: real `_sum` of line total (quantity × unitPrice) via
// a `groupBy` that includes the line-amount sum.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('parties')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const url = new URL(req.url)
    const cursor = url.searchParams.get('cursor') // cursor for pagination
    const PAGE_SIZE = 50

    // 🔒 V17-Ext §1 FIX: Parse the composite cursor BEFORE the Promise.all so
    // we can return 400 on a malformed/legacy cursor without starting the
    // parallel queries. Uses the shared keyset helpers from src/lib/pagination.ts.
    //
    // WAS: Prisma native cursor `cursor: { id }, skip: 1` with `orderBy: { date: 'desc' }`
    // (no id tiebreak). Same bug class as the main ledger — a backdated
    // transaction (high id, low date) could be silently skipped, and same-date
    // entries had unstable ordering across pages. Now: composite keyset + id
    // tiebreak gives total ordering with no skips or duplicates.
    let cursorCondition: { OR: any[] } | null = null
    if (cursor) {
      cursorCondition = buildKeysetWhere(cursor)
      if (!cursorCondition) {
        return NextResponse.json(
          { error: 'Invalid cursor format. Please refresh.' },
          { status: 400 },
        )
      }
    }

    // Build the where clause for the paginated transaction list.
    // Base filters + optional cursor condition (composed via AND).
    const txListWhere: any = { userId, partyId: id, deletedAt: null }
    if (cursorCondition) {
      txListWhere.AND = [cursorCondition]
    }

    // 1. Fetch party record (without loading all transactions)
    const party = await db.party.findFirst({
      where: { id, userId, deletedAt: null },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 🔒 V17 §3.1 FIX: Eliminated duplicate aggregation + parallelized all
    // independent queries into a single Promise.all wave.
    //
    // BEFORE: ~17 queries in ~7 serialization points.
    //   1. party.findFirst (serialized)
    //   2. Wave 1: salesAgg + purchaseAgg + countAgg + dateRangeAgg (4 queries)
    //   3. computePartyBalance (serialized after wave 1) — internally re-ran
    //      salesAgg + purchaseAgg (DUPLICATES of wave 1) + 3 payment aggregates
    //   4. transactions.findMany (serialized)
    //   5. topProductsAgg $queryRaw (serialized)
    //   6. monthlyRows $queryRaw (serialized)
    //   7. In response JSON: statementTransactions + statementPayments + paymentTotal
    //      (3 serialized awaits)
    //
    // AFTER: ~16 queries in 2 serialization points (party fetch + one big wave).
    //   - Dropped salesAgg + purchaseAgg (redundant — computePartyBalance returns
    //     totalSales, totalPurchases, totalReceived, totalPaid, salesOutstanding,
    //     purchaseOutstanding).
    //   - Replaced them with ONE groupBy query for salesCount + purchasesCount
    //     (not returned by the helper).
    //   - ALL remaining queries run in a single Promise.all — they're all
    //     independent (only need userId + id, available from the start).
    //
    // Wall-clock: ~7 round-trips → ~4 (party + max of computePartyBalance's 3
    // internal waves and the 9 single queries). On a cold Neon connection
    // (50-100ms per round-trip), this saves 150-300ms per page load.

    const now = new Date()
    const sixMonthsAgo = istMonthStartOffset(now, -5)

    const [
      partyBalance,
      typeCountRows,
      countAgg,
      dateRangeAgg,
      transactions,
      topProductsAgg,
      monthlyRows,
      statementTransactions,
      statementPayments,
      paymentTotal,
    ] = await Promise.all([
      // 🔒 V15 §1: Single source of truth for balance + money breakdown.
      // Internally does ~6 queries in 2 sub-waves (party.findFirst + 3
      // aggregates + 2 per-type payment aggregates). The internal party
      // fetch is a minor duplicate of query 1 above, but changing the
      // helper's signature would affect 3 callers — not worth the risk
      // for 1 round-trip.
      computePartyBalance(userId, id),

      // 🔒 V17 §3.1: Single groupBy for per-type counts (was: 2 separate
      // aggregate queries with _count). Returns [{ type: 'sale', _count: N },
      // { type: 'purchase', _count: M }, ...]. Also returns 'income'/'expense'
      // types if present — we only read sale + purchase.
      db.transaction.groupBy({
        by: ['type'],
        where: { userId, partyId: id, deletedAt: null },
        _count: { _all: true },
      }),

      // Total transaction count (for the "N transactions" badge)
      db.transaction.count({ where: { userId, partyId: id, deletedAt: null } }),

      // First + last transaction date (for the "customer since" display)
      db.transaction.aggregate({
        where: { userId, partyId: id, deletedAt: null },
        _min: { date: true },
        _max: { date: true },
      }),

      // Paginated transaction list (keyset cursor pagination, max 50 per page)
      // 🔒 V5 HA: filter deletedAt: null on the list too.
      // 🔒 V17-Ext §1: Composite keyset cursor (date|id) + id tiebreak in orderBy.
      // Was: Prisma native cursor on id only, orderBy date desc with no tiebreak.
      db.transaction.findMany({
        where: txListWhere,
        include: { items: true },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1, // fetch one extra to check if there's a next page
      }),

      // Top products via raw SQL (not JS reduce on all transactions)
      // 🔒 V5 MB: was `amount: 0` for every row. Now: real line-amount sum.
      // 🔒 V17 PAISE MIGRATION Phase 2E: SQL returns paise. JS converts via fromPaise().
      db.$queryRaw<Array<{ productName: string; totalQuantity: bigint; totalAmountPaise: string }>>`
        SELECT
          ti."productName",
          SUM(ti."quantity") AS "totalQuantity",
          SUM(ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric)::numeric, 0)) AS "totalAmountPaise"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        WHERE t."userId" = ${userId}
          AND t."partyId" = ${id}
          AND t."deletedAt" IS NULL
        GROUP BY ti."productName"
        ORDER BY "totalQuantity" DESC
        LIMIT 5
      `,

      // Monthly chart via raw SQL (last 6 months) — REAL data, not hardcoded zeros.
      // 🔒 V10 FIX: Group by IST month (AT TIME ZONE 'Asia/Kolkata'), not UTC.
      // 🔒 V17 PAISE MIGRATION Phase 2E: SQL returns paise for the total.
      // totalAmount is always >= 0, so positive nudge is fine.
      // Sign-aware nudge not needed because sales/purchases are always positive.
      db.$queryRaw<Array<{ monthStart: Date; type: string; totalPaise: number }>>`
        SELECT
          DATE_TRUNC('month', t.date AT TIME ZONE 'Asia/Kolkata') AS "monthStart",
          t.type,
          SUM(t."totalAmount"::numeric) AS "totalPaise"
        FROM "Transaction" t
        WHERE t."userId" = ${userId}
          AND t."partyId" = ${id}
          AND t."deletedAt" IS NULL
          AND t.date >= ${sixMonthsAgo}
        GROUP BY DATE_TRUNC('month', t.date AT TIME ZONE 'Asia/Kolkata'), t.type
        ORDER BY "monthStart" ASC
      `,

      // 🔒 V15 M-2 + V17 §2.2: Statement-grade transactions (newest 500).
      db.transaction.findMany({
        where: { userId, partyId: id, deletedAt: null },
        select: {
          id: true,
          date: true,
          type: true,
          totalAmount: true,
          paidAmount: true,
          invoiceNo: true,
          _count: { select: { items: true } },
        },
        orderBy: { date: 'desc' },
        take: 500,
      }),

      // 🔒 V15 M-2 + V17 §2.2: Statement-grade payments (newest 500).
      db.payment.findMany({
        where: { userId, partyId: id, deletedAt: null },
        select: {
          id: true,
          date: true,
          type: true,
          amount: true,
          mode: true,
          notes: true,
        },
        orderBy: { date: 'desc' },
        take: 500,
      }),

      // True payment count (not capped) — for the "showing 500 of N" banner.
      db.payment.count({ where: { userId, partyId: id, deletedAt: null } }),
    ])

    // === Process results (all in JS — no more DB queries) ===

    // Extract per-type counts from the groupBy result.
    // Result shape: [{ type: 'sale', _count: { _all: 5 } }, { type: 'purchase', _count: { _all: 3 } }, ...]
    const salesCount = typeCountRows.find(r => r.type === 'sale')?._count?._all ?? 0
    const purchasesCount = typeCountRows.find(r => r.type === 'purchase')?._count?._all ?? 0

    // Paginated transaction list: trim the extra row used for hasMore detection.
    const hasMore = transactions.length > PAGE_SIZE
    const pagedTransactions = hasMore ? transactions.slice(0, PAGE_SIZE) : transactions
    // 🔒 V17-Ext §1: Composite cursor "date|id" via the shared helper.
    const lastTxn = pagedTransactions[pagedTransactions.length - 1]
    const nextCursor = hasMore && lastTxn
      ? encodeKeysetCursor(lastTxn.date, lastTxn.id)
      : null

    // Normalize top products (Prisma raw returns bigint for SUM(quantity) and
    // string for SUM(numeric) — convert both to number for the frontend).
    // 🔒 V17 PAISE MIGRATION Phase 2E: SQL returns paise; convert to rupees via fromPaise().
    const topProducts = topProductsAgg.map(p => ({
      name: p.productName,
      quantity: Number(p.totalQuantity),
      amount: fromPaise(Number(p.totalAmountPaise)),
    }))

    // Build 6-month chart data, filling missing months with zeros.
    // 🔒 V10 FIX: The SQL returns naive timestamps at IST month-start (interpreted
    // as UTC by JS). The JS month keys must use the same IST-aligned logic.
    // 🔒 V11 §4.6: Uses centralized istMonthStartOffset helper.
    // 🔒 V17 PAISE MIGRATION Phase 2E: SQL returns paise; convert to rupees via fromPaise().
    const monthlyMap = new Map<string, { sales: number; purchases: number }>()
    for (const row of monthlyRows) {
      const key = new Date(row.monthStart).toISOString().slice(0, 7) // YYYY-MM
      const entry = monthlyMap.get(key) || { sales: 0, purchases: 0 }
      if (row.type === 'sale') entry.sales = fromPaise(Number(row.totalPaise))
      if (row.type === 'purchase') entry.purchases = fromPaise(Number(row.totalPaise))
      monthlyMap.set(key, entry)
    }

    const monthlyData: { month: string; sales: number; purchases: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = istMonthStartOffset(now, -i)
      const key = monthStart.toISOString().slice(0, 7)
      const entry = monthlyMap.get(key) || { sales: 0, purchases: 0 }
      monthlyData.push({
        month: monthStart.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
        sales: entry.sales,
        purchases: entry.purchases,
      })
    }

    return NextResponse.json({
      party,
      stats: {
        totalSales: partyBalance.totalSales,
        totalPurchases: partyBalance.totalPurchases,
        totalReceived: partyBalance.totalReceived,
        totalPaid: partyBalance.totalPaid,
        salesOutstanding: partyBalance.salesOutstanding,
        purchaseOutstanding: partyBalance.purchaseOutstanding,
        paymentsReceived: partyBalance.paymentsReceived,
        paymentsPaid: partyBalance.paymentsPaid,
        balance: partyBalance.balance,
        transactionCount: countAgg,
        salesCount,
        purchasesCount,
        firstTransactionDate: dateRangeAgg._min.date,
        lastTransactionDate: dateRangeAgg._max.date,
      },
      topProducts,
      monthlyData,
      transactions: pagedTransactions,
      pagination: {
        hasMore,
        nextCursor,
        pageSize: PAGE_SIZE,
      },
      // 🔒 V15 M-2 + V17 §2.2: Statement-grade data (newest 500, desc order).
      statementTransactions,
      statementPayments,
      statementTotals: {
        transactionTotal: countAgg,
        paymentTotal,
        cap: 500,
      },
    })
  } catch (error) {
    console.error('Party GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch party' }, { status: 500 })
  }
}

// PUT /api/parties/[id] - update party
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 🔒 V17-Ext Tier 3 Step 3: getAuthContextForWrite blocks CAs (read-only)
    const authCtx = await getAuthContextForWrite('parties')
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { id } = await params
    // Verify ownership
    const existing = await db.party.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()

    // 🔒 FIX H6: Was `openingBalance: parseFloat(body.openingBalance) || 0`
    // which silently reset openingBalance to 0 when the client sent an edit
    // without that field (e.g., just renaming the party). parseFloat(undefined)
    // is NaN, and NaN || 0 = 0 — overwriting the real opening balance.
    // Now: only update fields that are explicitly provided. Same pattern as
    // the products PUT handler. Prevents silent data corruption.
    const updateData: any = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.type !== undefined) updateData.type = body.type
    if (body.phone !== undefined) updateData.phone = body.phone || null
    if (body.email !== undefined) updateData.email = body.email || null
    if (body.gstin !== undefined) updateData.gstin = body.gstin || null
    if (body.address !== undefined) updateData.address = body.address || null
    if (body.state !== undefined) updateData.state = body.state || null
    if (body.openingBalance !== undefined) {
      // 🔒 BUG-004 FIX (V17 Phase 2E): Was `parseFloat(body.openingBalance) || 0`
      // without roundMoney — could store float drift values like 1.005 as
      // 1.00499999... The CREATE handler (parties/route.ts:115) correctly uses
      // roundMoney. Now uses parseMoney() which applies roundMoney internally,
      // matching the CREATE path. This prevents 1-paisa discrepancies between
      // dashboard and party-detail balances.
      updateData.openingBalance = parseMoney(body.openingBalance)
    }

    const party = await db.party.update({
      where: { id },
      data: updateData,
    })
    return NextResponse.json({ party })
  } catch (error) {
    console.error('Party PUT error:', error)
    return NextResponse.json({ error: 'Failed to update party' }, { status: 500 })
  }
}

// DELETE /api/parties/[id]
// 🔒 AUDIT FIX M8 (v2 audit): Handle party with payments gracefully.
// Was: db.party.delete threw a FK violation (Payment.partyId has no onDelete)
// → generic 500 error. Now: checks for dependent records first, returns a
// friendly 409 message if the party has payments/transactions.
//
// 🔒 V5 HA: dependent-record count now filters deletedAt: null so a party
// with only soft-deleted transactions can be deleted cleanly.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 🔒 V17-Ext Tier 3 Step 3: getAuthContextForWrite blocks CAs (read-only)
    const authCtx = await getAuthContextForWrite('parties')
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { id } = await params
    // Verify ownership
    const existing = await db.party.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 🔒 M8: Check for dependent ACTIVE records before deleting
    // 🔒 V16 C2: Filter deletedAt: null on the Payment count too — was
    // counting soft-deleted payments as "active", which permanently blocked
    // party deletion even after the user soft-deleted every payment. The
    // Transaction count on the next line already filtered deletedAt: null;
    // the Payment count didn't, which was an oversight when V15 M-3 added
    // Payment.deletedAt.
    const [paymentCount, transactionCount] = await Promise.all([
      db.payment.count({ where: { partyId: id, deletedAt: null } }).catch(() => 0),
      db.transaction.count({ where: { partyId: id, deletedAt: null } }),
    ])

    if (paymentCount > 0 || transactionCount > 0) {
      const parts: string[] = []
      if (transactionCount > 0) parts.push(`${transactionCount} active transaction(s)`)
      if (paymentCount > 0) parts.push(`${paymentCount} payment(s)`)
      return NextResponse.json({
        error: 'Cannot delete party with existing records',
        message: `This party has ${parts.join(' and ')}. Please delete or reassign those records first, or rename the party instead of deleting it.`,
        transactionCount,
        paymentCount,
      }, { status: 409 })
    }

    // 🔒 M7: Soft delete — set deletedAt, don't actually delete the row
    await db.party.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return NextResponse.json({ success: true, message: 'Party deleted (soft delete — can be restored)' })
  } catch (error) {
    console.error('Party DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete party' }, { status: 500 })
  }
}
