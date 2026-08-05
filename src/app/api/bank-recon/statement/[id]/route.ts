import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { logAudit } from '@/lib/audit'
import { apiError } from '@/lib/api-error'

/**
 * DELETE /api/bank-recon/statement/[id]
 *
 * 🔒 Added 2026-08-05 (Phase 10 audit). An imported bank statement could not be
 * removed. /api/bank-recon exposed import (POST), reconcile (GET) and
 * match/unmatch a single row (PATCH) — and nothing else. No API, no UI.
 *
 * So importing the wrong CSV — wrong account, wrong month, a file from a
 * different bank — was permanent. Its rows sat in reconciliation for good,
 * showing as unmatched, and the only way out was deleting the entire account.
 * A shopkeeper reconciling their books would be told forever about transactions
 * that were never theirs.
 *
 * Unlike deleting a shop, this is genuinely low-risk. BankTransaction rows are
 * IMPORTED data, not books: nothing else in the schema references them. The
 * matchedPaymentId / matchedTransactionId columns point OUTWARD from the
 * statement to the ledger, so removing the statement drops the pointers and
 * leaves the payments and invoices themselves untouched. Nothing about the
 * shopkeeper's actual money changes.
 *
 * Hard delete, not soft: a wrong import is not a record worth keeping, and the
 * GST/IT retention obligations cover the ledger, not a bank CSV the shopkeeper
 * uploaded by mistake. Re-importing the correct file is the intended recovery,
 * and the per-row hash makes that idempotent.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // CAs are read-only; deleting an import is a write.
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = authCtx.userId
    const { id } = await params

    /*
     * Scoped by userId, and checked before deleting so a wrong id returns 404
     * rather than silently succeeding. deleteMany with the userId in the WHERE
     * is what actually prevents one shop deleting another's import — `delete`
     * matches on the primary key alone.
     */
    const existing = await db.bankStatement.findFirst({
      where: { id, userId },
      select: { id: true, bankName: true, txnCount: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Bank statement not found' }, { status: 404 })
    }

    // Children first, both in one transaction. The schema declares a cascade,
    // but deleting explicitly does not depend on the live database carrying it
    // — the same reasoning as the webhook delete fixed alongside this.
    const removed = await db.$transaction(async (tx) => {
      const rows = await tx.bankTransaction.deleteMany({ where: { bankStatementId: id, userId } })
      await tx.bankStatement.deleteMany({ where: { id, userId } })
      return rows.count
    })

    await logAudit({
      userId,
      action: 'bank_statement.deleted',
      entityType: 'bank_statement',
      entityId: id,
      metadata: { bankName: existing.bankName, rowsRemoved: removed },
      impersonatedBy: authCtx.impersonatedBy,
      req,
    })

    return NextResponse.json({
      success: true,
      message: `Removed the ${existing.bankName} statement and its ${removed} row(s). Your sales, purchases and payments are unchanged.`,
      rowsRemoved: removed,
    })
  } catch (error) {
    return apiError(error, 'Failed to delete bank statement', 500)
  }
}
