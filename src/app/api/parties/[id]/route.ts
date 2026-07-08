import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { istMonthStartOffset, getISTDateParts } from '@/lib/timezone'
import { computePartyBalance } from '@/lib/party-balance'

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

    // 1. Fetch party record (without loading all transactions)
    const party = await db.party.findFirst({
      where: { id, userId, deletedAt: null },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 2. SQL aggregates for stats (O(1) memory regardless of transaction count)
    // 🔒 V5 HA: All queries now filter deletedAt: null.
    // 🔒 V6 PP3: Was 2 separate findFirst queries for first/last transaction date
    // (orderBy asc + desc). Now: 1 aggregate query with _min + _max — same result,
    // half the round-trips, simpler code.
    const [salesAgg, purchaseAgg, countAgg, dateRangeAgg] = await Promise.all([
      db.transaction.aggregate({
        where: { userId, partyId: id, type: 'sale', deletedAt: null },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: { userId, partyId: id, type: 'purchase', deletedAt: null },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      db.transaction.count({ where: { userId, partyId: id, deletedAt: null } }),
      // 🔒 V6 PP3: Single aggregate for first + last transaction date
      // (replaces 2 separate findFirst queries)
      db.transaction.aggregate({
        where: { userId, partyId: id, deletedAt: null },
        _min: { date: true },
        _max: { date: true },
      }),
    ])

    // 🔒 FIX V15 §1: Use computePartyBalance() — the single source of truth
    // that includes standalone payments. Was: inline math that ignored payments,
    // causing the party-detail headline to show a different (higher) balance
    // than the dashboard and party list.
    const partyBalance = await computePartyBalance(userId, id)

    // 3. Paginated transaction list (cursor-based, max 50 per page)
    // 🔒 V5 HA: filter deletedAt: null on the list too.
    const transactions = await db.transaction.findMany({
      where: { userId, partyId: id, deletedAt: null },
      include: { items: true },
      orderBy: { date: 'desc' },
      take: PAGE_SIZE + 1, // fetch one extra to check if there's a next page
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })

    const hasMore = transactions.length > PAGE_SIZE
    const pagedTransactions = hasMore ? transactions.slice(0, PAGE_SIZE) : transactions
    const nextCursor = hasMore ? pagedTransactions[pagedTransactions.length - 1].id : null

    // 4. Top products via SQL groupBy (not JS reduce on all transactions)
    // 🔒 V5 MB: was `amount: 0` for every row. Now: real line-amount sum via
    // a raw SQL query that sums (quantity * unitPrice) per productName, filtered
    // to non-deleted transactions for this party.
    //
    // 🔒 AUDIT FIX V6 PP2: Type annotation is now accurate. Postgres SUM(numeric)
    // returns a `string` (Prisma raw SQL deserializes numeric/decimal as strings
    // to avoid precision loss). We convert with Number() below, which is safe for
    // display. The previous `number` type annotation was misleading — it implied
    // the value was already a number, but it was actually a string at runtime.
    const topProductsAgg = await db.$queryRaw<Array<{ productName: string; totalQuantity: bigint; totalAmount: string }>>`
      SELECT
        ti."productName",
        SUM(ti."quantity") AS "totalQuantity",
        SUM(ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric)::numeric, 2)) AS "totalAmount"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."partyId" = ${id}
        AND t."deletedAt" IS NULL
      GROUP BY ti."productName"
      ORDER BY "totalQuantity" DESC
      LIMIT 5
    `

    // Normalize top products (Prisma raw returns bigint for SUM(quantity) and
    // string for SUM(numeric) — convert both to number for the frontend)
    const topProducts = topProductsAgg.map(p => ({
      name: p.productName,
      quantity: Number(p.totalQuantity),
      amount: roundMoney(Number(p.totalAmount)),
    }))

    // 5. Monthly chart via SQL (last 6 months) — REAL data, not hardcoded zeros.
    // 🔒 V5 MA: was a dead `monthlyAgg` groupBy + hardcoded `sales: 0, purchases: 0`.
    // Now: raw SQL with date_trunc('month', date) grouped by type, joined to
    // produce a 6-row result set with real sales + purchases per month.
    // 🔒 V10 FIX: Group by IST month (AT TIME ZONE 'Asia/Kolkata'), not UTC month.
    // Was: DATE_TRUNC('month', t.date) which groups by UTC month → a transaction
    // on July 1, 2 AM IST (= June 30, 20:30 UTC) appeared in June's bucket.
    // Now: the grouping matches the user's local (IST) month.
    const now = new Date()
    // 🔒 FIX H3: Was `new Date(now.getFullYear(), now.getMonth() - 5, 1)` which
    // uses server-local time (UTC on Vercel). The istMonthStartOffset helper
    // was imported but not used. Now: uses istMonthStartOffset(now, -5) for
    // correct IST month boundary.
    const sixMonthsAgo = istMonthStartOffset(now, -5)

    const monthlyRows = await db.$queryRaw<Array<{ monthStart: Date; type: string; total: number }>>`
      SELECT
        DATE_TRUNC('month', t.date AT TIME ZONE 'Asia/Kolkata') AS "monthStart",
        t.type,
        SUM(t."totalAmount") AS total
      FROM "Transaction" t
      WHERE t."userId" = ${userId}
        AND t."partyId" = ${id}
        AND t."deletedAt" IS NULL
        AND t.date >= ${sixMonthsAgo}
      GROUP BY DATE_TRUNC('month', t.date AT TIME ZONE 'Asia/Kolkata'), t.type
      ORDER BY "monthStart" ASC
    `

    // Build 6-month chart data, filling missing months with zeros.
    // 🔒 V10 FIX: The SQL returns naive timestamps at IST month-start (interpreted
    // as UTC by JS). The JS month keys must use the same IST-aligned logic.
    // 🔒 V11 §4.6: Uses centralized getISTDateParts + istMonthStartOffset.
    const monthlyMap = new Map<string, { sales: number; purchases: number }>()
    for (const row of monthlyRows) {
      // row.monthStart is a naive timestamp at IST month-start (interpreted as UTC by JS).
      // Convert to YYYY-MM key — this matches the JS-generated keys below.
      const key = new Date(row.monthStart).toISOString().slice(0, 7) // YYYY-MM
      const entry = monthlyMap.get(key) || { sales: 0, purchases: 0 }
      if (row.type === 'sale') entry.sales = roundMoney(Number(row.total))
      if (row.type === 'purchase') entry.purchases = roundMoney(Number(row.total))
      monthlyMap.set(key, entry)
    }

    const monthlyData: { month: string; sales: number; purchases: number }[] = []
    // 🔒 V11 §4.6: Generate month buckets using istMonthStartOffset helper.
    for (let i = 5; i >= 0; i--) {
      // istMonthStartOffset returns a UTC Date at IST month-start. The JS Date's
      // toISOString().slice(0,7) gives the correct YYYY-MM key that matches the SQL.
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
        salesCount: salesAgg._count,
        purchasesCount: purchaseAgg._count,
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
      // 🔒 V15 M-2: Statement-grade data — separate from the paginated
      // `transactions` list above. The previous design reused the paginated
      // list (max 50 newest) for the account statement AND merged it with
      // ALL payments — so a party with >50 transactions had older invoices
      // silently disappear from the statement while their payments remained,
      // making the statement look unbalanced.
      //
      // 🔒 V17 §2.2 FIX: Both arrays are now `orderBy: 'desc'` (NEWEST first),
      // capped at 500. Was: `orderBy: 'asc'` (OLDEST first) + `take: 500` →
      // for a party with >500 transactions, the statement showed the 500
      // OLDEST entries (ancient history) and the closing balance on the last
      // visible row didn't match the headline. Now: the newest 500 are shown,
      // and the client walks backward from `stats.balance` so the top row
      // always ties to the headline regardless of truncation.
      //
      //   - statementTransactions: most recent 500 non-deleted transactions.
      //   - statementPayments: most recent 500 non-soft-deleted payments.
      // The client merges, then walks newest→oldest computing running balance
      // from stats.balance backward.
      statementTransactions: await db.transaction.findMany({
        where: { userId, partyId: id, deletedAt: null },
        select: {
          id: true,
          date: true,
          type: true,
          totalAmount: true,
          paidAmount: true,
          invoiceNo: true,
          // 🔒 V16 M1: _count uses a subquery (not a JOIN), so it doesn't
          // fan out. Returns the number of TransactionItem rows for each
          // transaction — used by the statement bubble to show "N items".
          // Was: missing, so the bubble showed "0 items" on every transaction
          // after V15 M-2 slimmed the payload.
          _count: { select: { items: true } },
        },
        orderBy: { date: 'desc' },
        take: 500,
      }),
      statementPayments: await db.payment.findMany({
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
      // True totals (not capped) — used by the UI to show a "showing 500 of N"
      // banner if the statement was truncated.
      statementTotals: {
        transactionTotal: countAgg,
        paymentTotal: await db.payment.count({ where: { userId, partyId: id, deletedAt: null } }),
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
    const { userId, error } = await getAuthUserIdWithModule('parties')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      updateData.openingBalance = parseFloat(body.openingBalance) || 0
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
    const { userId, error } = await getAuthUserIdWithModule('parties')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
