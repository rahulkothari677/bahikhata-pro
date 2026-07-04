import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'

export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ⚡ PERFORMANCE (Audit fix Phase 3.2): Compute balances with SQL aggregates
    // instead of loading every transaction into memory and reducing in JS.
    //
    // OLD approach: include: { transactions: ... } then .filter().reduce() in JS.
    //   → pulled ALL transactions for ALL parties into function memory.
    //   → at a merchant with 10k transactions × 100 parties = 1M rows in memory.
    //
    // NEW approach: one query for parties + two groupBy queries (sales, purchases)
    //   that SUM(totalAmount - paidAmount) per partyId in Postgres.
    //   → constant memory, ~100x faster at scale.
    const parties = await db.party.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        phone: true,
        email: true,
        gstin: true,
        address: true,
        state: true,
        openingBalance: true,
        createdAt: true,
        updatedAt: true,
        shopId: true,
      },
    })

    if (parties.length === 0) {
      return withCache({ parties: [] }, { maxAge: 60, swr: 300 })
    }

    const partyIds = parties.map(p => p.id)

    // Aggregate sales outstanding per party (SUM of totalAmount - paidAmount)
    // grouped by partyId. Only sale-type transactions.
    const salesAgg = await db.transaction.groupBy({
      by: ['partyId'],
      where: { userId, partyId: { in: partyIds }, type: 'sale' },
      _sum: { totalAmount: true, paidAmount: true },
    })

    // Aggregate purchases outstanding per party
    const purchaseAgg = await db.transaction.groupBy({
      by: ['partyId'],
      where: { userId, partyId: { in: partyIds }, type: 'purchase' },
      _sum: { totalAmount: true, paidAmount: true },
    })

    // Count transactions per party (for the transactionCount field)
    const countAgg = await db.transaction.groupBy({
      by: ['partyId'],
      where: { userId, partyId: { in: partyIds }, OR: [{ type: 'sale' }, { type: 'purchase' }] },
      _count: { id: true },
    })

    // Build lookup maps for O(1) access
    const salesMap = new Map(salesAgg.map(s => [s.partyId, s._sum]))
    const purchaseMap = new Map(purchaseAgg.map(p => [p.partyId, p._sum]))
    const countMap = new Map(countAgg.map(c => [c.partyId, c._count.id]))

    // Compute balance per party in JS (cheap — just arithmetic on aggregates)
    // positive openingBalance = they owe us (customer)
    // For sales: totalAmount - paidAmount = outstanding (they owe us more)
    // For purchases: totalAmount - paidAmount = we owe them more (subtract from balance)
    const partiesWithBalance = parties.map(p => {
      const salesSum = salesMap.get(p.id)
      const purchaseSum = purchaseMap.get(p.id)
      const salesOutstanding = (salesSum?.totalAmount || 0) - (salesSum?.paidAmount || 0)
      const purchaseOutstanding = (purchaseSum?.totalAmount || 0) - (purchaseSum?.paidAmount || 0)
      const balance = p.openingBalance + salesOutstanding - purchaseOutstanding

      return {
        ...p,
        balance,
        transactionCount: countMap.get(p.id) || 0,
        // positive = they owe us (receivable); negative = we owe them (payable)
        isReceivable: balance > 0,
      }
    })

    return withCache({ parties: partiesWithBalance }, { maxAge: 60, swr: 300 })
  } catch (error) {
    console.error('Parties GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch parties' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const party = await db.party.create({
      data: {
        userId,
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
    console.error('Parties POST error:', error)
    return NextResponse.json({ error: 'Failed to create party' }, { status: 500 })
  }
}
