import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule, type ModuleKey } from '@/lib/staff-permissions'
import { assertPeriodNotLocked, PeriodLockedError } from '@/lib/period-lock'
import { apiError } from '@/lib/api-error'
import { stockAffectingLines } from '@/lib/inventory-tracking'

/**
 * POST /api/transactions/[id]/restore
 *
 * 🔒 AUDIT FIX V6 UX: Restores a soft-deleted transaction.
 *
 * Was: deletes were soft (deletedAt set) but there was no UI to undo them.
 * The V6 auditor recommended: "Undo on delete (5-sec toast). You now
 * soft-delete, so 'Undo' is trivial and prevents accidental-delete panic —
 * a huge perceived-safety win."
 *
 * This endpoint:
 *   1. Verifies the transaction is soft-deleted (deletedAt not null).
 *   2. Sets deletedAt back to null (restores the row).
 *   3. Re-applies the stock impact (decrement for sales, increment for
 *      purchases) — the inverse of what DELETE did.
 *
 * All three steps are wrapped in a $transaction — all succeed or all roll
 * back. Same atomicity guarantee as the original DELETE.
 *
 * Auth: requires the user to own the transaction (verified via userId).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 🔒 FIX H1: Use getAuthContext for staff permission check
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { id } = await params

    const existing = await db.transaction.findFirst({
      where: { id, userId, deletedAt: { not: null } },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Not found or not deleted', message: 'This transaction either does not exist, is not yours, or is not deleted.' },
        { status: 404 },
      )
    }

    // 🔒 FIX H1: Check staff permission based on transaction type
    // V17-Ext Tier 3: credit-note maps to sales, debit-note maps to purchases
    const moduleKey: ModuleKey = existing.type === 'purchase' || existing.type === 'debit-note' ? 'purchases' : existing.type === 'income' || existing.type === 'expense' ? 'incomeExpense' : 'sales'
    if (!canAccessModule(authCtx.role, authCtx.permissions, moduleKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 🔒 V17-Ext Tier 3 Step 3: CAs are read-only — block transaction restore
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    // 🔒 V17-Ext §5.1: Period lock check. Restoring a soft-deleted transaction
    // re-adds it to the period's totals — if the period is locked (GST filed),
    // this would corrupt the filed return. Block the restore.
    try {
      await assertPeriodNotLocked(userId, existing.date)
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return NextResponse.json({ error: e.message, code: 'PERIOD_LOCKED' }, { status: 403 })
      }
      throw e
    }

    // V17-Ext Tier 3: Compute stock direction for re-application
    const restoreShouldDecrement = existing.type === 'sale' || (existing.type === 'debit-note' && existing.affectsStock)
    const restoreShouldIncrement = existing.type === 'purchase' || (existing.type === 'credit-note' && existing.affectsStock)
    const restoreAffectsStock = restoreShouldDecrement || restoreShouldIncrement

    // Restore: set deletedAt to null + re-apply stock impact, atomically.
    await db.$transaction(async (tx) => {
      // Step 1: Restore the row
      await tx.transaction.update({
        where: { id },
        data: { deletedAt: null },
      })

      // Step 2: Re-apply stock impact (inverse of DELETE).
      // V17-Ext Tier 3: Handles credit-note (increment) and debit-note (decrement)
      if (restoreAffectsStock) {
        const items = await tx.transactionItem.findMany({ where: { transactionId: id } })

        // 🔒 AUDIT PASS-1 N1: group per product + apply CONCURRENTLY, matching
        // the create, edit, delete and convert paths. This was one SEQUENTIAL
        // round-trip per line inside the interactive transaction, so restoring
        // a long bill could exhaust the transaction budget and fail with
        // P2028 — leaving a voided bill that cannot be un-voided.
        //
        // Grouping also fixes the gte guard when one product appears on several
        // lines: the check now tests the TOTAL quantity being re-applied rather
        // than each line in isolation, so the clamp-at-0 fallback triggers on
        // the real shortfall instead of a partial one.
        // Restoring re-applies what the void gave back. The void skipped
        // services, so the restore must skip exactly the same rows or an
        // un-void would invent stock the product never had. Loaded inside the
        // lock, like the DELETE side, so the two cannot disagree.
        const restoreProducts = await tx.product.findMany({
          where: { id: { in: [...new Set(items.map(i => i.productId).filter(Boolean) as string[])] }, userId },
          select: { id: true, tracksInventory: true },
        })
        const restoreProductMap = new Map(restoreProducts.map(p => [p.id, p]))

        const applyByProduct = new Map<string, number>()
        for (const item of stockAffectingLines(items, restoreProductMap)) {
          if (!item.productId) continue
          applyByProduct.set(
            item.productId,
            (applyByProduct.get(item.productId) || 0) + (item.quantity || 0),
          )
        }

        if (restoreShouldDecrement) {
          // Re-apply a decrement (sale or debit-note): decrement stock
          // 🔒 V26 H3 FIX: Add currentStock gte guard. Was: unconditional
          // decrement — restoring a sale for a product whose stock was
          // depleted would push stock negative silently. Now: if stock
          // insufficient, clamp at 0 (same approach as PUT/DELETE reversal).
          await Promise.all([...applyByProduct.entries()].map(async ([productId, qty]) => {
            const restoreResult = await tx.product.updateMany({
              where: { id: productId, userId, currentStock: { gte: qty } },
              data: { currentStock: { decrement: qty } },
            })
            if (restoreResult.count === 0) {
              await tx.product.updateMany({
                where: { id: productId, userId },
                data: { currentStock: 0 },
              })
            }
          }))
        } else {
          // Re-apply an increment (purchase or credit-note): increment stock
          await Promise.all([...applyByProduct.entries()].map(([productId, qty]) =>
            tx.product.updateMany({
              where: { id: productId, userId },
              data: { currentStock: { increment: qty } },
            })
          ))
        }
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Transaction restored.',
      transactionId: id,
    })
  } catch (error) {
    return apiError(error, 'Failed to restore transaction', 500)
  }
}
