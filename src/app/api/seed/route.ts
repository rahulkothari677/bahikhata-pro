import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'

// POST /api/seed - seed demo data
export async function POST() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Use dynamic import to avoid path issues
    const { seedDemoData } = await import('@/lib/seed')
    const result = await seedDemoData(userId)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return apiError(error, 'Failed to seed data', 500)
  }
}

// GET /api/seed - check if seeded
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [productCount, partyCount, txnCount] = await Promise.all([
      db.product.count({ where: { userId } }),
      db.party.count({ where: { userId } }),
      db.transaction.count({ where: { userId } }),
    ])
    return NextResponse.json({
      seeded: productCount > 0 || partyCount > 0 || txnCount > 0,
      counts: { products: productCount, parties: partyCount, transactions: txnCount },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to check seed status' }, { status: 500 })
  }
}

// DELETE /api/seed - wipe all data for this user
export async function DELETE() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Cascade delete in dependency order, scoped to this user
    await db.transactionItem.deleteMany({
      where: { transaction: { userId } },
    })
    await db.transaction.deleteMany({ where: { userId } })
    await db.payment.deleteMany({ where: { userId } })
    await db.party.deleteMany({ where: { userId } })
    await db.product.deleteMany({ where: { userId } })
    await db.setting.deleteMany({ where: { userId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Failed to delete data', 500)
  }
}
