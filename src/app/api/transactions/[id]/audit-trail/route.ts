import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { deserializeValue } from '@/lib/field-audit'

/**
 * GET /api/transactions/[id]/audit-trail
 *
 * V17-Ext 5.1: Returns the field-level change history for a transaction.
 * Every edit to a money-critical field (totalAmount, paidAmount, date, etc.)
 * is logged with who changed it, when, and the old/new values.
 *
 * Returns { changes: [{ id, fieldName, oldValue, newValue, changedByUserId, createdAt }] }
 * newest-first (most recent edit on top).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    // Verify the transaction belongs to this user (tenant isolation)
    const txn = await db.transaction.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!txn) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const logs = await db.fieldChangeLog.findMany({
      where: { userId, entityType: 'transaction', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    // Deserialize the old/new values for the client
    const changes = logs.map(log => ({
      id: log.id,
      fieldName: log.fieldName,
      oldValue: deserializeValue(log.oldValue),
      newValue: deserializeValue(log.newValue),
      changedByUserId: log.changedByUserId,
      createdAt: log.createdAt,
    }))

    return NextResponse.json({ changes })
  } catch (err) {
    return apiError(err, 'Failed to load audit trail', 500)
  }
}
