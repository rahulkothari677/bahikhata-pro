import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { assertPeriodNotLocked, PeriodLockedError } from '@/lib/period-lock'
import { logAudit } from '@/lib/audit'
import { apiError } from '@/lib/api-error'

/**
 * POST /api/payments/[id]/restore
 *
 * 🔒 AUDIT PASS-1 M6: restore a soft-deleted payment.
 *
 * THE GAP: DELETE /api/payments/[id] soft-deletes (V15 M-3), and transactions
 * have had POST /api/transactions/[id]/restore since V6 — but payments had no
 * way back. A mis-tapped delete could only be undone by re-entering the
 * payment, which stamps a NEW createdAt and leaves the audit trail reading
 * "payment deleted, unrelated payment created" instead of "deleted, restored".
 * In a dispute ("but I paid you on the 3rd") that difference matters.
 *
 * This mirrors the transaction restore exactly:
 *   1. Verify the payment is ours AND is actually soft-deleted.
 *   2. Enforce the same permission + read-only-CA + period-lock rules as DELETE.
 *   3. Clear deletedAt.
 *   4. Write an AuditLog entry so delete → restore is a visible pair.
 *
 * NO STOCK STEP: unlike a transaction, a Payment carries no line items and
 * moves no inventory. It affects exactly one thing — the party's balance —
 * and party-balance.ts already filters on `deletedAt: null`, so clearing the
 * flag is the whole restore. There is deliberately nothing else to undo here.
 *
 * Auth: same as DELETE — 'parties' module, owner or permitted staff, not a CA.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // CAs are read-only — same rule the delete path applies.
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const { id } = await params

    // Ownership + "is actually deleted" in one query. Scoped by userId so a
    // foreign id is indistinguishable from a nonexistent one.
    const existing = await db.payment.findFirst({
      where: { id, userId, deletedAt: { not: null } },
      select: { id: true, partyId: true, amount: true, type: true, mode: true, date: true, notes: true },
    })
    if (!existing) {
      return NextResponse.json(
        {
          error: 'Not found or not deleted',
          message: 'This payment either does not exist, is not yours, or is not deleted.',
        },
        { status: 404 },
      )
    }

    // Period lock: restoring re-adds the payment to that period's balances.
    // If the period is locked (GST filed), that retroactively alters a filed
    // return — exactly what DELETE blocks, so restore must block it too.
    try {
      await assertPeriodNotLocked(userId, existing.date)
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return NextResponse.json({ error: e.message, code: 'PERIOD_LOCKED' }, { status: 403 })
      }
      throw e
    }

    // 🔒 Guarded update, not a bare update-by-id: `deletedAt: { not: null }` in
    // the WHERE makes this idempotent under a double-tap or an offline replay.
    // The second call matches 0 rows and reports "already restored" instead of
    // silently succeeding twice or racing the first.
    const result = await db.payment.updateMany({
      where: { id, userId, deletedAt: { not: null } },
      data: { deletedAt: null },
    })

    if (result.count === 0) {
      return NextResponse.json({
        success: true,
        alreadyRestored: true,
        message: 'This payment was already restored.',
      })
    }

    await logAudit({
      userId,
      action: 'payment.restore',
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
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Payment restored. The party balance now includes it again.',
    })
  } catch (error) {
    return apiError(error, 'Failed to restore payment', 500)
  }
}
