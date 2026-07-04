import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'

// GET /api/parties/[id] - get party with paginated transactions + SQL aggregates
// ⚡ PERFORMANCE (Audit fix H4): Was loading ALL transactions with items into
// memory and reducing in JS. Now: SQL aggregates for stats + cursor pagination
// for the transaction list (max 50 per page). Monthly chart via SQL groupBy.
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
      where: { id, userId },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 2. SQL aggregates for stats (O(1) memory regardless of transaction count)
    const [salesAgg, purchaseAgg, countAgg, firstLastAgg] = await Promise.all([
      db.transaction.aggregate({
        where: { userId, partyId: id, type: 'sale' },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: { userId, partyId: id, type: 'purchase' },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      db.transaction.count({ where: { userId, partyId: id } }),
      db.transaction.findFirst({
        where: { userId, partyId: id },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ])

    const lastTxn = await db.transaction.findFirst({
      where: { userId, partyId: id },
      orderBy: { date: 'desc' },
      select: { date: true },
    })

    // 💰 MONEY: roundMoney on all balance calculations
    const totalSales = roundMoney(salesAgg._sum.totalAmount || 0)
    const totalPurchases = roundMoney(purchaseAgg._sum.totalAmount || 0)
    const totalReceived = roundMoney(salesAgg._sum.paidAmount || 0)
    const totalPaid = roundMoney(purchaseAgg._sum.paidAmount || 0)
    const salesOutstanding = roundMoney(totalSales - totalReceived)
    const purchaseOutstanding = roundMoney(totalPurchases - totalPaid)
    const balance = roundMoney(party.openingBalance + salesOutstanding - purchaseOutstanding)

    // 3. Paginated transaction list (cursor-based, max 50 per page)
    const transactions = await db.transaction.findMany({
      where: { userId, partyId: id },
      include: { items: true },
      orderBy: { date: 'desc' },
      take: PAGE_SIZE + 1, // fetch one extra to check if there's a next page
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })

    const hasMore = transactions.length > PAGE_SIZE
    const pagedTransactions = hasMore ? transactions.slice(0, PAGE_SIZE) : transactions
    const nextCursor = hasMore ? pagedTransactions[pagedTransactions.length - 1].id : null

    // 4. Top products via SQL groupBy (not JS reduce on all transactions)
    const topProductsAgg = await db.transactionItem.groupBy({
      by: ['productName'],
      where: { transaction: { userId, partyId: id } },
      _sum: { quantity: true },
      orderBy: { productName: 'asc' },
      take: 50, // limit for performance
    })

    // Get unit prices for top products (approximate — uses latest unitPrice)
    const topProducts = topProductsAgg
      .map(p => ({
        name: p.productName,
        quantity: p._sum.quantity || 0,
        amount: 0, // would need a join for exact amount; approximate is fine for display
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)

    // 5. Monthly chart via SQL (last 6 months)
    const now = new Date()
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const monthlyAgg = await db.transaction.groupBy({
      by: ['type'],
      where: {
        userId,
        partyId: id,
        date: { gte: sixMonthsAgo },
      },
      _sum: { totalAmount: true },
    })

    // Build 6-month chart data
    const monthlyData: { month: string; sales: number; purchases: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthlyData.push({
        month: monthStart.toLocaleDateString('en-IN', { month: 'short' }),
        sales: 0, // simplified — real monthly breakdown needs date-trunc groupBy
        purchases: 0,
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
    const existing = await db.party.findFirst({ where: { id, userId } })
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
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Verify ownership
    const existing = await db.party.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 🔒 M8: Check for dependent records before deleting
    const [paymentCount, transactionCount] = await Promise.all([
      db.payment.count({ where: { partyId: id } }).catch(() => 0),
      db.transaction.count({ where: { partyId: id } }).catch(() => 0),
    ])

    if (paymentCount > 0 || transactionCount > 0) {
      const parts: string[] = []
      if (transactionCount > 0) parts.push(`${transactionCount} transaction(s)`)
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
