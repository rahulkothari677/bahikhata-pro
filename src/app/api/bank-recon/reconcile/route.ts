import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/bank-recon/reconcile
 *
 * Returns all bank statements + their transactions for the current user.
 * Used by the BankReconciliation UI to show the 3-panel view:
 *   - Matched (bank txn ↔ payment/transaction)
 *   - Unmatched bank (bank txn with no match — investigate)
 *   - Unmatched app (payment/transaction with no bank txn — pending clearance)
 */
export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all bank statements (newest first)
    const bankStatements = await db.bankStatement.findMany({
      where: { userId },
      orderBy: { importedAt: 'desc' },
      include: {
        transactions: {
          orderBy: { date: 'asc' },
          include: {
            matchedPayment: {
              include: { party: { select: { name: true } } },
            },
            matchedTransaction: {
              include: { party: { select: { name: true } } },
            },
          },
        },
      },
      take: 10,  // limit to 10 most recent imports
    })

    // Compute summary
    const allBankTxns = bankStatements.flatMap(bs => bs.transactions)
    const matched = allBankTxns.filter(t => t.matchStatus === 'matched')
    const unmatched = allBankTxns.filter(t => t.matchStatus === 'unmatched')

    return NextResponse.json({
      bankStatements: bankStatements.map(bs => ({
        id: bs.id,
        bankName: bs.bankName,
        accountNumber: bs.accountNumber,
        importedAt: bs.importedAt,
        txnCount: bs.txnCount,
        matchedCount: bs.matchedCount,
        totalCredits: bs.totalCredits,
        totalDebits: bs.totalDebits,
        transactions: bs.transactions.map(t => ({
          id: t.id,
          date: t.date,
          description: t.description,
          amount: t.amount,
          balance: t.balance,
          matchStatus: t.matchStatus,
          matchMethod: t.matchMethod,
          matchConfidence: t.matchConfidence,
          matchedPayment: t.matchedPayment ? {
            id: t.matchedPayment.id,
            amount: t.matchedPayment.amount,
            type: t.matchedPayment.type,
            mode: t.matchedPayment.mode,
            partyName: t.matchedPayment.party?.name,
          } : null,
          matchedTransaction: t.matchedTransaction ? {
            id: t.matchedTransaction.id,
            type: t.matchedTransaction.type,
            totalAmount: t.matchedTransaction.totalAmount,
            invoiceNo: t.matchedTransaction.invoiceNo,
            partyName: t.matchedTransaction.party?.name,
          } : null,
        })),
      })),
      summary: {
        totalStatements: bankStatements.length,
        totalBankTxns: allBankTxns.length,
        matchedCount: matched.length,
        unmatchedCount: unmatched.length,
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to load bank reconciliation', 500)
  }
}
