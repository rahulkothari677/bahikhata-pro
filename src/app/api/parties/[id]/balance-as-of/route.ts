import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { computeBalanceAsOf } from '@/lib/balance-as-of'
import { roundMoney } from '@/lib/money'

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

    // 🔒 V18 FIX B.3: Set asOfDate to END of the day in IST (not UTC).
    // Was: `dateStr + 'T23:59:59.999Z'` — that's 23:59 UTC = 05:29 next-day
    // IST, so a transaction dated e.g. July 9 02:00 IST (= July 8 20:30 UTC)
    // was wrongly counted in "as of July 8". Using the explicit +05:30 offset
    // makes this exactly 23:59:59.999 IST on the selected calendar date.
    const asOfDate = new Date(dateStr + 'T23:59:59.999+05:30')

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
        updatedAt: true,  // 🔒 V18 B.2: detect post-hoc edits (see accuracy caveat below)
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
      // 🔒 V18 FIX: use roundMoney (epsilon-corrected) for parity with the
      // headline balance and every other money path — was plain Math.round,
      // which can drift by a paisa on a long statement.
      runningBalance = roundMoney(runningBalance + entry.delta)
      statementEntries.push({
        date: entry.date,
        description: entry.description,
        type: entry.type,
        amount: entry.delta,
        balance: runningBalance,
      })
    }

    // 🔒 V18 B.2: Historical accuracy caveat. This computation uses each
    // invoice's CURRENT paidAmount, not the paidAmount as it stood on the
    // as-of date. If an invoice dated on/before the as-of date was EDITED
    // afterwards (e.g. its paidAmount was changed to settle it later, instead
    // of recording a dated Payment), the historical balance can be off. We
    // detect exactly that case — an included transaction whose updatedAt is
    // after the as-of date — and surface an honest warning so a CA isn't
    // silently misled. (The structural fix is dated-payment-only settlement /
    // event sourcing; until then, this flag makes the limitation visible.)
    const editedAfterAsOf = transactions.some(
      (t) =>
        !t.deletedAt &&
        t.date.getTime() <= asOfDate.getTime() &&
        t.updatedAt.getTime() > asOfDate.getTime(),
    )
    const accuracyNote = editedAfterAsOf
      ? 'Some invoices dated on or before this date were edited afterwards. This balance reflects their current settlement state, which may differ from the exact position on the selected date. For a precise historical figure, record settlements as dated payments rather than editing an invoice’s paid amount.'
      : null

    return NextResponse.json({
      party: {
        id: party.id,
        name: party.name,
        phone: party.phone,
      },
      asOfDate: asOfDate.toISOString(),
      balance: result.balance,
      // 🔒 V18 B.2: null when the figure is reliable; a message when it may not be.
      accuracyWarning: accuracyNote,
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
