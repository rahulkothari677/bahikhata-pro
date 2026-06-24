import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/seed - seed demo data
export async function POST() {
  try {
    // Use dynamic import to avoid path issues
    const { seedDemoData } = await import('@/lib/seed')
    const result = await seedDemoData()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('Seed error:', error)
    return NextResponse.json({ error: 'Failed to seed data' }, { status: 500 })
  }
}

// GET /api/seed - check if seeded
export async function GET() {
  try {
    const [productCount, partyCount, txnCount] = await Promise.all([
      db.product.count(),
      db.party.count(),
      db.transaction.count(),
    ])
    return NextResponse.json({
      seeded: productCount > 0 || partyCount > 0 || txnCount > 0,
      counts: { products: productCount, parties: partyCount, transactions: txnCount },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to check seed status' }, { status: 500 })
  }
}

// DELETE /api/seed - wipe all data
export async function DELETE() {
  try {
    await db.transactionItem.deleteMany()
    await db.transaction.deleteMany()
    await db.payment.deleteMany()
    await db.party.deleteMany()
    await db.product.deleteMany()
    await db.setting.deleteMany()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Failed to delete data' }, { status: 500 })
  }
}
