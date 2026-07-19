import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContextForWrite } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { parseBankCsv, autoMatch, type MatchablePayment, type MatchableTransaction } from '@/lib/bank-recon'
import crypto from 'crypto'

/**
 * POST /api/bank-recon/import
 *
 * Imports a bank statement CSV and auto-matches transactions against
 * recorded payments and transactions.
 *
 * Body: { csv: string, bankName: string }
 * Returns: { bankStatementId, txnCount, matchedCount, unmatchedCount, skippedDuplicates, summary }
 *
 * 🔒 V26 R6 (Phase 5): Dedup rework.
 *
 * Was (V26 F2 fix that didn't actually work):
 *   - Dead code: `existingStatement` query result was never referenced.
 *   - "Exact" dedup = first-200-char prefix match on rawCsv. Two failure
 *     directions: (a) false positive — banks with fixed header blocks
 *     exceeding 200 chars reject next month's statement; (b) false negative —
 *     "last 3 months" downloaded in March then again in April → different
 *     first row → both import → every overlapping row doubled.
 *   - No per-row dedup at all.
 *   - Check-then-act race (double-click / concurrent tab / queue replay).
 *
 * Now:
 *   - sha256 of the trimmed CSV → BankStatement.csvHash with @@unique([userId,
 *     csvHash]). The DB enforces exact-duplicate detection; no check-then-act.
 *     P2002 → 409 with the existing import date.
 *   - sha256 of `${userId}|${date}|${description}|${amount}` → BankTransaction.
 *     rowHash with @@unique([userId, rowHash]). createMany({ skipDuplicates:
 *     true }) → overlapping statements import without doubling rows; the
 *     `skippedDuplicates` count is reported in the summary.
 *   - Row cap: > 5000 rows → 400 with "split the statement" message.
 *   - Dead `existingStatement` block deleted.
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

    // 🔒 V26 R6 (Phase 5): Row cap. A large paste (Vercel allows up to ~4.5MB)
    // is a single giant INSERT that can blow the statement timeout. Cap at 5000
    // rows with a "split the statement" message — most monthly statements are
    // 50-300 rows, so this is a generous fuse.
    if (parsed.transactions.length > 5000) {
      return NextResponse.json({
        error: 'Statement too large',
        message: `This statement has ${parsed.transactions.length.toLocaleString()} rows. The maximum per import is 5,000. Please split the statement into smaller date ranges and import each separately.`,
      }, { status: 400 })
    }

    // 🔒 V26 R6: Compute csvHash (sha256 of trimmed CSV).
    const csvHash = crypto.createHash('sha256').update(csv.trim()).digest('hex')

    // 🔒 V26 R6: Exact-duplicate check via DB constraint.
    // The @@unique([userId, csvHash]) index catches concurrent/double-click/
    // queue-replay duplicates atomically — no check-then-act race possible.
    // We still do a pre-check here for the common case (saves a transaction
    // and lets us return a friendlier message with the original import date).
    const existing = await db.bankStatement.findUnique({
      where: { userId_csvHash: { userId, csvHash } },
      select: { id: true, importedAt: true },
    })
    if (existing) {
      return NextResponse.json({
        error: 'Duplicate import detected',
        message: `This bank statement was already imported on ${new Date(existing.importedAt).toLocaleDateString('en-IN')}. Re-importing would create duplicate rows. If the previous import had wrong matches, use the "Unmatch" feature to correct them instead of re-importing.`,
        existingStatementId: existing.id,
      }, { status: 409 })
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

    // 🔒 V26 R6: Store the bank statement first (flattened from the old nested
    // create so we can use createMany + skipDuplicates on the rows below).
    // P2002 on the csvHash unique constraint = a concurrent import raced us
    // → treat as idempotent (return the existing statement).
    let bankStatement
    try {
      bankStatement = await db.bankStatement.create({
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
          csvHash,
        },
      })
    } catch (createError: any) {
      // P2002 = concurrent/double-click import raced us. The unique constraint
      // on (userId, csvHash) caught it. Return the existing statement.
      if (createError?.code === 'P2002') {
        const existingRace = await db.bankStatement.findUnique({
          where: { userId_csvHash: { userId, csvHash } },
          select: { id: true, importedAt: true },
        })
        return NextResponse.json({
          error: 'Duplicate import detected',
          message: `This bank statement was already imported (just now by another request) on ${new Date(existingRace?.importedAt || Date.now()).toLocaleDateString('en-IN')}.`,
          existingStatementId: existingRace?.id,
        }, { status: 409 })
      }
      throw createError
    }

    // 🔒 V26 R6: Per-row dedup via rowHash + createMany skipDuplicates.
    // Was: nested create inside bankStatement.create (no per-row dedup at all).
    // Now: each row gets a sha256 rowHash; the @@unique([userId, rowHash])
    // constraint + skipDuplicates means overlapping statements import without
    // doubling rows. We count the difference between input rows and inserted
    // rows to report `skippedDuplicates` in the summary.
    const rowsToInsert = matchResults.map(r => ({
      bankStatementId: bankStatement.id,
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
      rowHash: crypto.createHash('sha256')
        .update(`${userId}|${r.bankTxn.date.toISOString().slice(0, 10)}|${r.bankTxn.description.trim()}|${r.bankTxn.amount}`)
        .digest('hex'),
    }))

    const insertedRows = await db.bankTransaction.createMany({
      data: rowsToInsert,
      skipDuplicates: true,
    })
    const skippedDuplicates = rowsToInsert.length - insertedRows.count

    // If we skipped duplicates, update the statement's txnCount to reflect
    // the actual number of NEW rows (so the dashboard "X imported" matches
    // what the user sees in the recon table).
    if (skippedDuplicates > 0) {
      await db.bankStatement.update({
        where: { id: bankStatement.id },
        data: { txnCount: insertedRows.count },
      })
    }

    return NextResponse.json({
      success: true,
      bankStatementId: bankStatement.id,
      summary: {
        bankName: parsed.bankName,
        accountNumber: parsed.accountNumber,
        txnCount: insertedRows.count,
        matchedCount,
        unmatchedCount: insertedRows.count - matchedCount,
        totalCredits: parsed.totalCredits,
        totalDebits: parsed.totalDebits,
        skippedDuplicates,  // 🔒 V26 R6: rows already present from an overlapping statement
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to import bank statement', 500)
  }
}
