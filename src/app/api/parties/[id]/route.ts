import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'

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
    const { userId, error } = await getAuthUserId()
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
    // 🔒 V5 HA: All four queries now filter deletedAt: null.
    const [salesAgg, purchaseAgg, countAgg, firstLastAgg, lastTxn] = await Promise.all([
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
      db.transaction.findFirst({
        where: { userId, partyId: id, deletedAt: null },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      db.transaction.findFirst({
        where: { userId, partyId: id, deletedAt: null },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ])

    // 💰 MONEY: roundMoney on all balance calculations
    const totalSales = roundMoney(salesAgg._sum.totalAmount || 0)
    const totalPurchases = roundMoney(purchaseAgg._sum.totalAmount || 0)
    const totalReceived = roundMoney(salesAgg._sum.paidAmount || 0)
    const totalPaid = roundMoney(purchaseAgg._sum.paidAmount || 0)
    const salesOutstanding = roundMoney(totalSales - totalReceived)
    const purchaseOutstanding = roundMoney(totalPurchases - totalPaid)
    const balance = roundMoney(party.openingBalance + salesOutstanding - purchaseOutstanding)

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
    const topProductsAgg = await db.$queryRaw<Array<{ productName: string; totalQuantity: bigint; totalAmount: number }>>`
      SELECT
        ti."productName",
        SUM(ti.quantity) AS "totalQuantity",
        SUM ROUND(ti.quantity * ti."unitPrice", 2) AS "totalAmount"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."partyId" = ${id}
        AND t."deletedAt" IS NULL
      GROUP BY ti."productName"
      ORDER BY "totalQuantity" DESC
      LIMIT 5
    `

    // Normalize top products (Prisma raw returns bigint for SUM, convert to number)
    const topProducts = topProductsAgg.map(p => ({
      name: p.productName,
      quantity: Number(p.totalQuantity),
      amount: roundMoney(Number(p.totalAmount)),
    }))

    // 5. Monthly chart via SQL (last 6 months) — REAL data, not hardcoded zeros.
    // 🔒 V5 MA: was a dead `monthlyAgg` groupBy + hardcoded `sales: 0, purchases: 0`.
    // Now: raw SQL with date_trunc('month', date) grouped by type, joined to
    // produce a 6-row result set with real sales + purchases per month.
    const now = new Date()
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const monthlyRows = await db.$queryRaw<Array<{ monthStart: Date; type: string; total: number }>>`
      SELECT
        DATE_TRUNC('month', t.date) AS "monthStart",
        t.type,
        SUM(t."totalAmount") AS total
      FROM "Transaction" t
      WHERE t."userId" = ${userId}
        AND t."partyId" = ${id}
        AND t."deletedAt" IS NULL
        AND t.date >= ${sixMonthsAgo}
      GROUP BY DATE_TRUNC('month', t.date), t.type
      ORDER BY "monthStart" ASC
    `

    // Build 6-month chart data, filling missing months with zeros.
    const monthlyMap = new Map<string, { sales: number; purchases: number }>()
    for (const row of monthlyRows) {
      const key = new Date(row.monthStart).toISOString().slice(0, 7) // YYYY-MM
      const entry = monthlyMap.get(key) || { sales: 0, purchases: 0 }
      if (row.type === 'sale') entry.sales = roundMoney(Number(row.total))
      if (row.type === 'purchase') entry.purchases = roundMoney(Number(row.total))
      monthlyMap.set(key, entry)
    }

    const monthlyData: { month: string; sales: number; purchases: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = monthStart.toISOString().slice(0, 7)
      const entry = monthlyMap.get(key) || { sales: 0, purchases: 0 }
      monthlyData.push({
        month: monthStart.toLocaleDateString('en-IN', { month: 'short' }),
        sales: entry.sales,
        purchases: entry.purchases,
      })
    }

    return NextResponse.json({
      party,
      stats: {
        totalSales,
        totalPurchases,
        totalReceived,
        totalPaid,
        salesOutstanding,
        purchaseOutstanding,
        balance,
        transactionCount: countAgg,
        salesCount: salesAgg._count,
        purchasesCount: purchaseAgg._count,
        firstTransactionDate: firstLastAgg?.date,
        lastTransactionDate: lastTxn?.date,
      },
      topProducts,
      monthlyData,
      transactions: pagedTransactions,
      pagination: {
        hasMore,
        nextCursor,
        pageSize: PAGE_SIZE,
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
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Verify ownership
    const existing = await db.party.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const party = await db.party.update({
      where: { id },
      data: {
        name: body.name,
        type: body.type || 'customer',
        phone: body.phone || null,
        email: body.email || null,
        gstin: body.gstin || null,
        address: body.address || null,
        state: body.state || null,
        openingBalance: parseFloat(body.openingBalance) || 0,
      },
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
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Verify ownership
    const existing = await db.party.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 🔒 M8: Check for dependent ACTIVE records before deleting
    const [paymentCount, transactionCount] = await Promise.all([
      db.payment.count({ where: { partyId: id } }).catch(() => 0),
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
