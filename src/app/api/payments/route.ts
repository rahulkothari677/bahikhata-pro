import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
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
    // 🔒 V18: Rate limit payment creation (20/min per user)
    const rl = await rateLimit(`payments:${userId}`, { limit: 20, windowSec: 60 })
    if (!rl.success) return rateLimitedResponse(rl)


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
    // 🔒 V26 R2 (Phase 5): Read x-client-mutation-id from HEADER (where the
    // offline queue puts it) instead of body (where no client sends it).
    // Was: `body.clientMutationId` — always undefined → the entire V19-007
    // idempotency block was dead code → payment replay duplicated payments.
    // Body fallback kept for backward compat with any client that does send it.
    const clientMutationId =
      (req.headers.get('x-client-mutation-id') as string | undefined) ||
      (body as any).clientMutationId as string | undefined

    // 🔒 V19-007: Idempotency check — prevents duplicate payments from offline
    // sync replays. Same pattern as transactions POST.
    if (clientMutationId) {
      const existing = await db.payment.findUnique({
        where: { clientMutationId },
        select: { id: true, amount: true, type: true, partyId: true, date: true, mode: true, notes: true },
      })
      if (existing) {
        return NextResponse.json({ payment: existing, idempotent: true })
      }
    }

    // 🔒 FIX M-NEW-3: Validate date — reject future-dated payments
    const paymentDate = date ? new Date(date) : new Date()
    if (paymentDate > new Date()) {
      return NextResponse.json({
        error: 'Payment date cannot be in the future',
        message: 'Please select today or an earlier date.',
      }, { status: 400 })
    }

    // 🔒 AUDIT V25 BATCH 6.0 (user-reported perf issue): Was 5 sequential DB
    // queries (idempotency + party findFirst + period lock + computePartyBalance
    // which itself does 7 more queries + payment create) = ~12 sequential
    // round-trips on Neon. Each Neon query is 50-200ms warm, 200-500ms cold →
    // 6-7s total. User reported "saving of payment is still taking 6-7 seconds".
    //
    // Fix: parallelize the 3 independent pre-checks (party findFirst + period
    // lock + balance computation) into ONE Promise.all. They don't depend on
    // each other. Cuts 3 sequential round-trips → 1 parallel round-trip.
    // Then the payment.create is the only remaining sequential query.
    //
    // Note: computePartyBalance internally does 7 queries in parallel already
    // (V18 BUG-002 fix), so parallelizing the outer 3 saves ~600ms on Neon.
    // The bigger win is reducing total query count from 12 → 10.
    const [party, periodLockError, balInfo] = await Promise.all([
      db.party.findFirst({
        where: { id: partyId, userId, deletedAt: null },
        select: { id: true, name: true },
      }),
      assertPeriodNotLocked(userId, paymentDate).then(() => null).catch(e => e),
      computePartyBalance(userId, partyId),
    ])

    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 🔒 V17-Ext §5.1: Period lock check result (re-thrown now that we have it)
    if (periodLockError instanceof PeriodLockedError) {
      return NextResponse.json({ error: periodLockError.message, code: 'PERIOD_LOCKED' }, { status: 403 })
    }
    if (periodLockError) throw periodLockError

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

    // 🔒 V26 R2 (Phase 5): Wrap payment.create in try/catch for P2002.
    // The idempotency check at the top is check-then-act (READ COMMITTED:
    // two simultaneous replays both see no existing payment, both attempt
    // insert, second one P2002s on the @unique constraint). Catch P2002 →
    // re-fetch by clientMutationId → return the existing payment with
    // idempotent:true flag. Same pattern as payment/verify route.
    let payment
    try {
      payment = await db.payment.create({
        data: {
          userId,
          partyId,
          amount: roundMoney(amt),
          type,
          mode: mode,
          date: paymentDate,
          notes: notes || null,
          clientMutationId: clientMutationId || null,  // 🔒 V19-007: idempotency
        },
      })
    } catch (createError: any) {
      if (createError?.code === 'P2002' && clientMutationId) {
        // Concurrent replay raced us — re-fetch and return idempotent.
        const existing = await db.payment.findUnique({
          where: { clientMutationId },
          select: { id: true, amount: true, type: true, partyId: true, date: true, mode: true, notes: true },
        })
        if (existing) {
          return NextResponse.json({ payment: existing, idempotent: true })
        }
      }
      throw createError
    }

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
