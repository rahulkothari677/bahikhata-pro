import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContextForWrite } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { validateBody, updateBankReconTxnSchema } from '@/lib/validation'

/**
 * PATCH /api/bank-recon/transaction/[id]
 *
 * 🔒 V26 F2 FIX: Unmatch or manually match a bank transaction.
 * Was: no correction path — a wrong auto-match (fuzzy/partial) couldn't be
 * fixed. The user was stuck with whatever the auto-matcher decided.
 *
 * Body options:
 *   { action: 'unmatch' }
 *     → Clears the match: sets matchStatus='unmatched', matchedPaymentId=null,
 *       matchedTransactionId=null, matchMethod=null, matchConfidence=null
 *
 *   { action: 'match', transactionId: '<txn-id>' }
 *     → Manually matches to a ledger transaction (sale/purchase).
 *       Validates the transaction belongs to the user.
 *
 *   { action: 'match', paymentId: '<payment-id>' }
 *     → Manually matches to a payment.
 *       Validates the payment belongs to the user.
 *
 * Auth: owner or staff with reports write access.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCtx = await getAuthContextForWrite('reports')
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { id } = await params
    const body = await req.json()
    // 🔒 V26 R13 (Phase 5): First-pass zod validation (was: no schema).
    const validation = validateBody(updateBankReconTxnSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { action, transactionId, paymentId } = body

    // Validate action (zod already enforces the enum, but keep the manual check
    // for the error message shape the client expects).
    if (!['unmatch', 'match'].includes(action)) {
      return NextResponse.json({ error: 'action must be "unmatch" or "match"' }, { status: 400 })
    }

    // Find the bank transaction (scoped to user)
    const bankTxn = await db.bankTransaction.findFirst({
      where: { id, userId },
    })
    if (!bankTxn) {
      return NextResponse.json({ error: 'Bank transaction not found' }, { status: 404 })
    }

    if (action === 'unmatch') {
      // Clear the match
      const updated = await db.bankTransaction.update({
        where: { id },
        data: {
          matchStatus: 'unmatched',
          matchedPaymentId: null,
          matchedTransactionId: null,
          matchMethod: null,
          matchConfidence: null,
        },
      })
      return NextResponse.json({
        success: true,
        message: 'Match removed. The bank transaction is now unmatched.',
        bankTransaction: updated,
      })
    }

    // action === 'match'
    if (transactionId) {
      // Validate the transaction belongs to the user
      const txn = await db.transaction.findFirst({
        where: { id: transactionId, userId, deletedAt: null },
        select: { id: true, type: true, invoiceNo: true },
      })
      if (!txn) {
        return NextResponse.json({ error: 'Transaction not found or does not belong to this account' }, { status: 404 })
      }

      const updated = await db.bankTransaction.update({
        where: { id },
        data: {
          matchStatus: 'matched',
          matchedTransactionId: transactionId,
          matchedPaymentId: null,  // clear payment match if switching
          matchMethod: 'manual',
          matchConfidence: 1.0,    // manual = 100% confident
        },
      })
      return NextResponse.json({
        success: true,
        message: `Matched to ${txn.type} ${txn.invoiceNo || txn.id}.`,
        bankTransaction: updated,
      })
    }

    if (paymentId) {
      // Validate the payment belongs to the user
      const payment = await db.payment.findFirst({
        where: { id: paymentId, userId, deletedAt: null },
        select: { id: true, type: true, amount: true },
      })
      if (!payment) {
        return NextResponse.json({ error: 'Payment not found or does not belong to this account' }, { status: 404 })
      }

      const updated = await db.bankTransaction.update({
        where: { id },
        data: {
          matchStatus: 'matched',
          matchedPaymentId: paymentId,
          matchedTransactionId: null,  // clear transaction match if switching
          matchMethod: 'manual',
          matchConfidence: 1.0,
        },
      })
      return NextResponse.json({
        success: true,
        message: `Matched to payment (${payment.type}, ₹${payment.amount}).`,
        bankTransaction: updated,
      })
    }

    return NextResponse.json({ error: 'For "match" action, provide transactionId or paymentId' }, { status: 400 })
  } catch (err) {
    return apiError(err, 'Failed to update bank transaction match', 500)
  }
}
