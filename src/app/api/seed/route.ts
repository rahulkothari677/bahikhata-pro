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

    // 🔒 V26 M2 FIX: Wrap all deletes in a $transaction (was: sequential,
    // non-atomic — a failure midway left a half-wiped shop). Also added
    // missing tables that were not cleaned up.
    // Using the callback form so we can catch individual table errors
    // (some tables may not exist if migrations haven't run).
    await db.$transaction(async (tx) => {
      await tx.transactionItem.deleteMany({ where: { transaction: { userId } } })
      await tx.transaction.deleteMany({ where: { userId } })
      await tx.payment.deleteMany({ where: { userId } })
      // Optional tables — wrap in try/catch (may not exist in all deployments)
      try { await tx.document.deleteMany({ where: { userId } }) } catch {}
      try { await tx.bankStatement.deleteMany({ where: { userId } }) } catch {}
      try { await tx.gstr1Snapshot.deleteMany({ where: { userId } }) } catch {}
      try { await tx.gstReturn.deleteMany({ where: { userId } }) } catch {}
      try { await tx.scanComparison.deleteMany({ where: { userId } }) } catch {}
      try { await tx.aiUsageLog.deleteMany({ where: { userId } }) } catch {}
      try { await tx.auditLog.deleteMany({ where: { userId } }) } catch {}
      try { await tx.fieldChangeLog.deleteMany({ where: { changedByUserId: userId } }) } catch {}
      try { await tx.invoiceCounter.deleteMany({ where: { userId } }) } catch {}
      await tx.party.deleteMany({ where: { userId } })
      await tx.product.deleteMany({ where: { userId } })
      try { await tx.shop.deleteMany({ where: { userId } }) } catch {}
      // Setting is kept (so the user can re-seed without re-onboarding)
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Failed to delete data', 500)
  }
}
