import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { computeBalanceAsOf } from '@/lib/balance-as-of'

/**
 * GET /api/parties/[id]/balance-as-of?date=YYYY-MM-DD
 *
 * 🔒 V17 Audit Phase 8: Computes a party's balance as of a historical date.
 * CAs use this to answer "what did this customer owe on June 30?"
 *
 * Returns the balance + breakdown (sales, purchases, credit notes, debit notes,
 * payments) only including transactions dated ON OR BEFORE the target date.
 *
 * Auth: owner or CA (parties module). Staff with parties permission.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: partyId } = await params

    // Parse date param
    const { searchParams } = new URL(req.url)
    const dateStr = searchParams.get('date')
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json({ error: 'date is required (format: YYYY-MM-DD)' }, { status: 400 })
    }

    // Set the asOfDate to END of that day (23:59:59.999) so transactions
    // ON that date are included (inclusive boundary)
    const asOfDate = new Date(dateStr + 'T23:59:59.999Z')

    // Fetch party
    const party = await db.party.findFirst({
      where: { id: partyId, userId, deletedAt: null },
      select: { id: true, name: true, openingBalance: true, phone: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // Fetch ALL transactions for this party (the function filters by date)
    const transactions = await db.transaction.findMany({
      where: { userId, partyId, deletedAt: null },
      select: {
        id: true,
        type: true,
        date: true,
        totalAmount: true,
        paidAmount: true,
        deletedAt: true,
        invoiceNo: true,
      },
      orderBy: { date: 'asc' },
    })

    // Fetch ALL payments for this party
    const payments = await db.payment.findMany({
      where: { userId, partyId, deletedAt: null },
      select: {
        id: true,
        type: true,
        date: true,
        amount: true,
        deletedAt: true,
        mode: true,
        notes: true,
      },
      orderBy: { date: 'asc' },
    })

    // Compute the balance as of the date
    const result = computeBalanceAsOf(
      party.openingBalance,
      transactions,
      payments,
      asOfDate,
    )

    // Also build a mini-statement up to that date (for the UI)
    const statementEntries: Array<{
      date: Date
      description: string
      type: string
      amount: number
      balance: number
    }> = []

    let runningBalance = party.openingBalance
    statementEntries.push({
      date: new Date(0),  // epoch = "opening"
      description: 'Opening Balance',
      type: 'opening',
      amount: party.openingBalance,
      balance: runningBalance,
    })

    // Merge + sort by date
    const allEntries: Array<{ date: Date; sortKey: string; description: string; type: string; delta: number }> = []

    for (const t of transactions) {
      if (t.deletedAt) continue
      if (t.date.getTime() > asOfDate.getTime()) continue
      let delta = 0
      let desc = ''
      if (t.type === 'sale') {
        delta = t.totalAmount - t.paidAmount
        desc = `Sale ${t.invoiceNo || ''}`
      } else if (t.type === 'purchase') {
        delta = -(t.totalAmount - t.paidAmount)
        desc = `Purchase ${t.invoiceNo || ''}`
      } else if (t.type === 'credit-note') {
        delta = -(t.totalAmount - t.paidAmount)
        desc = `Credit Note ${t.invoiceNo || ''}`
      } else if (t.type === 'debit-note') {
        delta = t.totalAmount - t.paidAmount
        desc = `Debit Note ${t.invoiceNo || ''}`
      }
      allEntries.push({ date: t.date, sortKey: t.id, description: desc, type: t.type, delta })
    }

    for (const p of payments) {
      if (p.deletedAt) continue
      if (p.date.getTime() > asOfDate.getTime()) continue
      const delta = p.type === 'received' ? -p.amount : p.amount
      const desc = `Payment ${p.type} (${p.mode})`
      allEntries.push({ date: p.date, sortKey: p.id, description: desc, type: 'payment', delta })
    }

    // Sort oldest first (for running balance)
    allEntries.sort((a, b) => a.date.getTime() - b.date.getTime())

    for (const entry of allEntries) {
      runningBalance = Math.round((runningBalance + entry.delta) * 100) / 100
      statementEntries.push({
        date: entry.date,
        description: entry.description,
        type: entry.type,
        amount: entry.delta,
        balance: runningBalance,
      })
    }

    return NextResponse.json({
      party: {
        id: party.id,
        name: party.name,
        phone: party.phone,
      },
      asOfDate: asOfDate.toISOString(),
      balance: result.balance,
      breakdown: {
        openingBalance: result.openingBalance,
        salesOutstanding: result.salesOutstanding,
        purchaseOutstanding: result.purchaseOutstanding,
        creditNoteOutstanding: result.creditNoteOutstanding,
        debitNoteOutstanding: result.debitNoteOutstanding,
        paymentsReceived: result.paymentsReceived,
        paymentsPaid: result.paymentsPaid,
      },
      counts: {
        sales: result.saleCount,
        purchases: result.purchaseCount,
        creditNotes: result.creditNoteCount,
        debitNotes: result.debitNoteCount,
        payments: result.paymentCount,
      },
      statement: statementEntries,
    })
  } catch (err) {
    return apiError(err, 'Failed to compute balance as of date', 500)
  }
}
