import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/parties/[id] - get party with all transactions
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const party = await db.party.findUnique({
      where: { id },
      include: {
        transactions: {
          include: { items: true },
          orderBy: { date: 'desc' },
        },
      },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // Compute running balance and stats
    const sales = party.transactions.filter(t => t.type === 'sale')
    const purchases = party.transactions.filter(t => t.type === 'purchase')

    const totalSales = sales.reduce((s, t) => s + t.totalAmount, 0)
    const totalPurchases = purchases.reduce((s, t) => s + t.totalAmount, 0)
    const totalReceived = sales.reduce((s, t) => s + t.paidAmount, 0)
    const totalPaid = purchases.reduce((s, t) => s + t.paidAmount, 0)
    const salesOutstanding = sales.reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0)
    const purchaseOutstanding = purchases.reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0)
    const balance = party.openingBalance + salesOutstanding - purchaseOutstanding

    // Top products bought/sold to this party
    const productMap = new Map<string, { name: string; quantity: number; amount: number }>()
    party.transactions.forEach(t => {
      t.items.forEach(item => {
        const key = item.productId || item.productName
        const existing = productMap.get(key) || { name: item.productName, quantity: 0, amount: 0 }
        existing.quantity += item.quantity
        existing.amount += item.unitPrice * item.quantity
        productMap.set(key, existing)
      })
    })
    const topProducts = Array.from(productMap.values()).sort((a, b) => b.amount - a.amount).slice(0, 5)

    // Monthly summary for chart
    const now = new Date()
    const monthlyData: { month: string; sales: number; purchases: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const mSales = sales.filter(t => t.date >= monthStart && t.date < monthEnd).reduce((s, t) => s + t.totalAmount, 0)
      const mPurchases = purchases.filter(t => t.date >= monthStart && t.date < monthEnd).reduce((s, t) => s + t.totalAmount, 0)
      monthlyData.push({
        month: monthStart.toLocaleDateString('en-IN', { month: 'short' }),
        sales: mSales,
        purchases: mPurchases,
      })
    }

    return NextResponse.json({
      party: {
        ...party,
        transactions: party.transactions.map(t => ({
          ...t,
          items: undefined, // lighten payload
        })),
      },
      stats: {
        totalSales,
        totalPurchases,
        totalReceived,
        totalPaid,
        salesOutstanding,
        purchaseOutstanding,
        balance,
        transactionCount: party.transactions.length,
        salesCount: sales.length,
        purchasesCount: purchases.length,
        firstTransactionDate: party.transactions[party.transactions.length - 1]?.date,
        lastTransactionDate: party.transactions[0]?.date,
      },
      topProducts,
      monthlyData,
      transactions: party.transactions,
    })
  } catch (error) {
    console.error('Party GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch party' }, { status: 500 })
  }
}

// PUT /api/parties/[id] - update party
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.party.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Party DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete party' }, { status: 500 })
  }
}
