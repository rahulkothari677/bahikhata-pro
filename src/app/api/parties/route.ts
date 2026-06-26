import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'

export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parties = await db.party.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: {
        transactions: {
          where: { OR: [{ type: 'sale' }, { type: 'purchase' }] },
          select: { id: true, type: true, totalAmount: true, paidAmount: true, date: true },
        },
      },
    })

    // Compute running balance for each party
    // positive openingBalance = they owe us (customer)
    // For sales: totalAmount - paidAmount = outstanding (they owe us more)
    // For purchases: totalAmount - paidAmount = we owe them more (subtract from balance)
    const partiesWithBalance = parties.map(p => {
      const salesOutstanding = p.transactions
        .filter(t => t.type === 'sale')
        .reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0)
      const purchaseOutstanding = p.transactions
        .filter(t => t.type === 'purchase')
        .reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0)
      const balance = p.openingBalance + salesOutstanding - purchaseOutstanding

      return {
        ...p,
        transactions: undefined,
        balance,
        transactionCount: p.transactions.length,
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
