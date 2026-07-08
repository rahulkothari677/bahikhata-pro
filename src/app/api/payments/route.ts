import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/payments?partyId=xxx
 *
 * Returns all payments for a specific party, ordered by date desc.
 * Used by the party profile to show a running payment statement.
 */
export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    // 🔒 FIX H1: Staff need 'parties' permission to view payments
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')

    if (!partyId) {
      return NextResponse.json({ error: 'partyId is required' }, { status: 400 })
    }

    // Verify the party belongs to this user
    const party = await db.party.findFirst({
      where: { id: partyId, userId, deletedAt: null },
      select: { id: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    const payments = await db.payment.findMany({
      where: { userId, partyId },
      orderBy: { date: 'desc' },
      take: 100,
    })

    return NextResponse.json({ payments })
  } catch (error) {
    return apiError(error, 'Failed to fetch payments', 500)
  }
}

/**
 * POST /api/payments
 *
 * Record a payment against a party's balance.
 *   type: 'received' — customer paid us (reduces their debt)
 *   type: 'paid'     — we paid a supplier (reduces our debt to them)
 *
 * Request body:
 *   { partyId, amount, type: 'received' | 'paid', mode: 'cash'|'upi'|'card'|'bank', date?, notes? }
 */
export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    // 🔒 FIX H1: Staff need 'parties' permission to record payments
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { partyId, amount, type, mode, date, notes } = body

    // Validate required fields
    if (!partyId) {
      return NextResponse.json({ error: 'partyId is required' }, { status: 400 })
    }
    const amt = Number(amount)
    if (isNaN(amt) || amt <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
    }
    if (!['received', 'paid'].includes(type)) {
      return NextResponse.json({ error: 'Type must be "received" or "paid"' }, { status: 400 })
    }
    const paymentMode = ['cash', 'upi', 'card', 'bank'].includes(mode) ? mode : 'cash'

    // Verify the party belongs to this user
    const party = await db.party.findFirst({
      where: { id: partyId, userId, deletedAt: null },
      select: { id: true, name: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 🔒 FIX M-NEW-1: Check for potential double-counting. If the party has
    // invoices with paidAmount > 0, the user may have already settled via the
    // invoice's paid field. Recording a standalone Payment on top of that
    // would double-count the settlement.
    const invoicesWithPaid = await db.transaction.aggregate({
      where: { userId, partyId, deletedAt: null, paidAmount: { gt: 0 } },
      _sum: { paidAmount: true },
    })
    const alreadyPaidOnInvoices = roundMoney(invoicesWithPaid._sum.paidAmount || 0)

    // 🔒 FIX M-NEW-3: Validate date — reject future-dated payments
    const paymentDate = date ? new Date(date) : new Date()
    if (paymentDate > new Date()) {
      return NextResponse.json({
        error: 'Payment date cannot be in the future',
        message: 'Please select today or an earlier date.',
      }, { status: 400 })
    }

    const payment = await db.payment.create({
      data: {
        userId,
        partyId,
        amount: roundMoney(amt),
        type,
        mode: paymentMode,
        date: paymentDate,
        notes: notes || null,
      },
    })

    // 🔒 FIX M-NEW-1: Return a non-blocking warning if double-counting is possible
    let warning: string | null = null
    if (alreadyPaidOnInvoices > 0) {
      warning = `This party already has ₹${alreadyPaidOnInvoices.toFixed(2)} recorded as "paid" on their invoices. If that amount includes the payment you just recorded, the balance will be reduced twice. To avoid double-counting, either use "Settle Payment" OR edit the invoice's paid amount — not both.`
    }

    return NextResponse.json({ payment, warning })
  } catch (error) {
    return apiError(error, 'Failed to record payment', 500)
  }
}
