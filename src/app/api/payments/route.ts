import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { apiError } from '@/lib/api-error'
import { computePartyBalance } from '@/lib/party-balance'
import { assertPeriodNotLocked, PeriodLockedError } from '@/lib/period-lock'
import { validateBody, createPaymentSchema } from '@/lib/validation'

/**
 * GET /api/payments?partyId=xxx
 *
 * Returns all NON-DELETED payments for a specific party, ordered by date desc.
 * Used by the party profile to show a running payment statement.
 *
 * 🔒 V15 M-3: Filters deletedAt: null — soft-deleted payments stay in the DB
 * for audit but don't appear in the user-facing statement.
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

    // 🔒 V15 M-3: Filter deletedAt: null so deleted payments don't appear
    // in the statement (but they DO remain in the database for audit).
    const payments = await db.payment.findMany({
      where: { userId, partyId, deletedAt: null },
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
 *
 * 🔒 V15 M-1: Replaced the noisy "any invoice has paidAmount > 0" warning
 * (which fired on nearly every payment and trained users to ignore it)
 * with a balance-based overpayment warning. The warning now fires ONLY
 * when the recorded payment exceeds the party's actual outstanding balance —
 * i.e. the only case where a real double-count could occur.
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

    // 🔒 V17-Ext Tier 3 Step 3: CAs are read-only — block payment creation
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    // 🔒 V18 Zod validation: replaces manual field checks
    const body = await req.json()
    const validation = validateBody(createPaymentSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { partyId, amount, type, mode, date, notes } = validation.data
    const amt = amount

    // Verify the party belongs to this user
    const party = await db.party.findFirst({
      where: { id: partyId, userId, deletedAt: null },
      select: { id: true, name: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 🔒 FIX M-NEW-3: Validate date — reject future-dated payments
    const paymentDate = date ? new Date(date) : new Date()
    if (paymentDate > new Date()) {
      return NextResponse.json({
        error: 'Payment date cannot be in the future',
        message: 'Please select today or an earlier date.',
      }, { status: 400 })
    }

    // 🔒 V17-Ext §5.1: Period lock check. Block the payment create if its date
    // falls within a locked period. A backdated payment dated last month is
    // blocked if last month is locked (GST filed).
    try {
      await assertPeriodNotLocked(userId, paymentDate)
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return NextResponse.json({ error: e.message, code: 'PERIOD_LOCKED' }, { status: 403 })
      }
      throw e
    }

    // 🔒 V15 M-1: Balance-based overpayment check (replaces the noisy old heuristic).
    //
    // OLD BEHAVIOR (M-NEW-1): warned whenever ANY invoice for this party had
    // paidAmount > 0. Almost every real sale records some paid-at-billing amount,
    // so the warning fired on ~95% of payments → users learned to ignore it
    // (alert fatigue) AND it missed the actual risk (a user later editing the
    // invoice's paidAmount upward — which this check cannot see).
    //
    // NEW BEHAVIOR: only warn when the recorded payment EXCEEDS the party's
    // actual outstanding balance. This is the only case where a real double-count
    // can occur (recording a payment bigger than what's actually owed means
    // either: the user is pre-paying for future invoices, or they're
    // double-counting). The warning is now rare + actionable.
    //
    // We use computePartyBalance (the single source of truth) so this check
    // always agrees with every other screen.
    const balInfo = await computePartyBalance(userId, partyId)
    const isReceived = type === 'received'
    const currentOutstanding = isReceived ? balInfo.balance : -balInfo.balance
    // balance > 0 = they owe us. For 'received' payments, outstanding = balance.
    // balance < 0 = we owe them. For 'paid' payments, outstanding = -balance.
    // If the direction doesn't match (e.g. recording 'received' when balance
    // is negative = we owe them), that's a refund scenario — also worth flagging.
    const directionMismatch =
      (isReceived && balInfo.balance < 0) ||
      (!isReceived && balInfo.balance > 0)

    const exceedsOutstanding =
      !directionMismatch && amt > roundMoney(currentOutstanding + 0.01) // 0.01 epsilon for float

    const payment = await db.payment.create({
      data: {
        userId,
        partyId,
        amount: roundMoney(amt),
        type,
        mode: mode,
        date: paymentDate,
        notes: notes || null,
      },
    })

    // 🔒 V15 M-1: Build a meaningful, rare warning (or none).
    let warning: string | null = null
    if (directionMismatch) {
      const whoOwes = balInfo.balance > 0 ? 'they owe you' : 'you owe them'
      const action = isReceived ? 'receiving from' : 'paying to'
      warning =
        `This party's balance is ₹${Math.abs(balInfo.balance).toFixed(2)} ` +
        `(${whoOwes}), but you're ${action} them. ` +
        `If this is a refund or an advance, that's fine — otherwise please double-check the direction.`
    } else if (exceedsOutstanding) {
      const overBy = roundMoney(amt - currentOutstanding)
      warning =
        `You're recording ₹${amt.toFixed(2)} but the outstanding balance is only ` +
        `₹${currentOutstanding.toFixed(2)} (₹${overBy.toFixed(2)} over). ` +
        `If this is an advance against future invoices, that's fine. ` +
        `If not, the customer may have already paid — check the invoice's "paid" ` +
        `amount to avoid recording the same payment twice.`
    }
    // Else: no warning. Most payments land here — no alert fatigue.

    return NextResponse.json({ payment, warning })
  } catch (error) {
    return apiError(error, 'Failed to record payment', 500)
  }
}
