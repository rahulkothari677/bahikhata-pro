import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { assertPeriodNotLocked, PeriodLockedError } from '@/lib/period-lock'

/**
 * DELETE /api/payments/[id]
 *
 * 🔒 V15 M-3: Soft-deletes a payment (sets deletedAt) and writes an AuditLog
 * entry. Was: hard delete — silently changed historical balances with no
 * record that the payment ever existed (dispute / fraud risk: "but I paid
 * you!"). Now: same soft-delete pattern as Transaction and Party.
 *
 * The deleted payment stays in the DB:
 *   - Excluded from balance calculations (party-balance.ts filters deletedAt: null)
 *   - Excluded from the user-facing statement (payments GET filters deletedAt: null)
 *   - Available for audit / dispute resolution via the AuditLog entry below
 *
 * Scoped by userId for tenant isolation.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    // Verify ownership + capture the row's fields BEFORE soft-delete so the
    // AuditLog entry has the amount/type/mode that's needed for dispute
    // resolution. (The soft-delete only sets deletedAt; the rest of the row
    // stays intact. But we capture here anyway in case a future schema
    // change adds hard delete.)
    const existing = await db.payment.findFirst({
      where: { id, userId, deletedAt: null },
      select: {
        id: true,
        partyId: true,
        amount: true,
        type: true,
        mode: true,
        date: true,
        notes: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // 🔒 V17-Ext §5.1: Period lock check. You can't soft-delete (void) a
    // payment that's in a locked period — voiding changes the period's
    // balances retroactively, which corrupts filed GST returns.
    try {
      await assertPeriodNotLocked(userId, existing.date)
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return NextResponse.json({ error: e.message, code: 'PERIOD_LOCKED' }, { status: 403 })
      }
      throw e
    }

    // Soft-delete: set deletedAt. The row stays in the DB for audit/disputes.
    await db.payment.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    // 🔒 V15 M-3: Audit trail. Captures who deleted what, when, from where.
    // Fire-and-forget (logAudit never throws — see src/lib/audit.ts).
    await logAudit({
      userId,
      action: 'payment.delete',
      entityType: 'payment',
      entityId: id,
      req,
      metadata: {
        partyId: existing.partyId,
        amount: existing.amount,
        type: existing.type,
        mode: existing.mode,
        date: existing.date,
        notes: existing.notes,
        // 'soft' tag distinguishes from any future hard-delete action
        deletionMode: 'soft',
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Payment deleted (soft delete — recorded in audit log for dispute resolution)',
    })
  } catch (error) {
    return apiError(error, 'Failed to delete payment', 500)
  }
}
