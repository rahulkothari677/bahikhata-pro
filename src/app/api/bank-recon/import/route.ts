import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContextForWrite } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { parseBankCsv, autoMatch, type MatchablePayment, type MatchableTransaction } from '@/lib/bank-recon'

/**
 * POST /api/bank-recon/import
 *
 * Imports a bank statement CSV and auto-matches transactions against
 * recorded payments and transactions.
 *
 * Body: { csv: string, bankName: string }
 * Returns: { bankStatementId, txnCount, matchedCount, unmatchedCount, summary }
 */
export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContextForWrite('reports')
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const body = await req.json()
    const { csv, bankName } = body

    if (!csv || typeof csv !== 'string') {
      return NextResponse.json({ error: 'CSV content is required' }, { status: 400 })
    }

    // Parse the CSV
    const parsed = parseBankCsv(csv, bankName || 'Unknown Bank')

    if (parsed.transactions.length === 0) {
      return NextResponse.json({
        error: 'No transactions found in CSV',
        message: 'The CSV file has no parseable transactions. Make sure it has Date, Description, and Amount columns.',
      }, { status: 400 })
    }

    // Fetch non-cash payments for matching
    const payments = await db.payment.findMany({
      where: {
        userId,
        deletedAt: null,
        mode: { in: ['upi', 'card', 'bank'] },
        date: {
          gte: new Date(parsed.transactions[0].date.getTime() - 7 * 24 * 60 * 60 * 1000),
          lte: new Date(parsed.transactions[parsed.transactions.length - 1].date.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      include: { party: { select: { name: true } } },
    })

    const matchablePayments: MatchablePayment[] = payments.map(p => ({
      id: p.id,
      amount: p.amount,
      date: p.date,
      type: p.type as string,
      mode: p.mode as string,
      partyName: p.party?.name || undefined,
      notes: p.notes || undefined,
    }))

    // Fetch non-cash transactions for matching
    const txns = await db.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: { in: ['sale', 'purchase'] },
        paymentMode: { in: ['upi', 'card', 'bank'] },
        date: {
          gte: new Date(parsed.transactions[0].date.getTime() - 7 * 24 * 60 * 60 * 1000),
          lte: new Date(parsed.transactions[parsed.transactions.length - 1].date.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      include: { party: { select: { name: true } } },
    })

    const matchableTxns: MatchableTransaction[] = txns.map(t => ({
      id: t.id,
      type: t.type as string,
      totalAmount: t.totalAmount,
      paidAmount: t.paidAmount,
      paymentMode: t.paymentMode as string,
      date: t.date,
      partyName: t.party?.name || undefined,
      invoiceNo: t.invoiceNo || undefined,
    }))

    // Auto-match
    const matchResults = autoMatch(parsed.transactions, matchablePayments, matchableTxns)
    const matchedCount = matchResults.filter(r => r.matchType !== 'none').length

    // Store the bank statement + transactions
    const bankStatement = await db.bankStatement.create({
      data: {
        userId,
        bankName: parsed.bankName,
        accountNumber: parsed.accountNumber || null,
        statementPeriod: parsed.statementPeriod || null,
        totalCredits: parsed.totalCredits,
        totalDebits: parsed.totalDebits,
        txnCount: parsed.transactions.length,
        matchedCount,
        rawCsv: csv,
        transactions: {
          create: matchResults.map(r => ({
            userId,
            date: r.bankTxn.date,
            description: r.bankTxn.description,
            amount: r.bankTxn.amount,
            balance: r.bankTxn.balance || null,
            matchStatus: r.matchType === 'none' ? 'unmatched' : 'matched',
            matchedPaymentId: r.matchedPaymentId || null,
            matchedTransactionId: r.matchedTransactionId || null,
            matchMethod: r.matchType === 'none' ? null : 'auto',
            matchConfidence: r.confidence || null,
          })),
        },
      },
      include: { transactions: true },
    })

    return NextResponse.json({
      success: true,
      bankStatementId: bankStatement.id,
      summary: {
        bankName: parsed.bankName,
        accountNumber: parsed.accountNumber,
        txnCount: parsed.transactions.length,
        matchedCount,
        unmatchedCount: parsed.transactions.length - matchedCount,
        totalCredits: parsed.totalCredits,
        totalDebits: parsed.totalDebits,
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to import bank statement', 500)
  }
}
