import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'

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
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    // Verify ownership + that the transaction IS soft-deleted
    const existing = await db.transaction.findFirst({
      where: { id, userId, deletedAt: { not: null } },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Not found or not deleted', message: 'This transaction either does not exist, is not yours, or is not deleted.' },
        { status: 404 },
      )
    }

    // Restore: set deletedAt to null + re-apply stock impact, atomically.
    await db.$transaction(async (tx) => {
      // Step 1: Restore the row
      await tx.transaction.update({
        where: { id },
        data: { deletedAt: null },
      })

      // Step 2: Re-apply stock impact (inverse of DELETE).
      // DELETE did: sale → increment stock back, purchase → decrement stock back.
      // RESTORE does: sale → decrement stock (re-apply the sale), purchase → increment stock.
      if (existing.type === 'sale' || existing.type === 'purchase') {
        const items = await tx.transactionItem.findMany({ where: { transactionId: id } })
        for (const item of items) {
          if (item.productId) {
            if (existing.type === 'sale') {
              // Re-apply sale: decrement stock
              await tx.product.update({
                where: { id: item.productId },
                data: { currentStock: { decrement: item.quantity } },
              })
            } else {
              // Re-apply purchase: increment stock
              await tx.product.update({
                where: { id: item.productId },
                data: { currentStock: { increment: item.quantity } },
              })
            }
          }
        }
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Transaction restored.',
      transactionId: id,
    })
  } catch (error) {
    console.error('Transaction RESTORE error:', error)
    return NextResponse.json({ error: 'Failed to restore transaction' }, { status: 500 })
  }
}
