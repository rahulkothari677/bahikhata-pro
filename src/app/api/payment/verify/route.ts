import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { db } from '@/lib/db'
import crypto from 'crypto'

/**
 * POST /api/payment/verify
 *
 * Verifies the Razorpay payment signature and upgrades the user's plan.
 * Called by CheckoutButton.tsx after the user completes the Razorpay checkout.
 *
 * Razorpay flow:
 *   1. Frontend opens Razorpay checkout with orderId
 *   2. User pays → Razorpay returns { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *   3. Frontend sends these to this route
 *   4. We verify the signature using HMAC SHA256
 *   5. If valid: update user's plan in DB, create Subscription record
 *   6. If invalid: return 400 (possible fraud attempt)
 *
 * Request body:
 *   {
 *     razorpay_order_id: string,
 *     razorpay_payment_id: string,
 *     razorpay_signature: string,
 *     planId: 'pro' | 'elite',
 *     billingCycle: 'monthly' | 'yearly',
 *     amount: number  (in paise, from the order)
 *   }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      planId,
      billingCycle,
      amount,
    } = body

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing Razorpay payment fields' }, { status: 400 })
    }

    if (!['pro', 'elite'].includes(planId)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Verify the signature
    // Razorpay generates the signature as: HMAC_SHA256(order_id + '|' + payment_id, key_secret)
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keySecret) {
      return NextResponse.json({ error: 'Razorpay not configured' }, { status: 503 })
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')

    if (expectedSignature !== razorpay_signature) {
      console.error('Payment signature mismatch:', {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        expected: expectedSignature.slice(0, 10) + '...',
        actual: razorpay_signature.slice(0, 10) + '...',
      })
      return NextResponse.json({
        error: 'Payment verification failed',
        detail: 'Signature mismatch — this could indicate a tampered payment. Please contact support.',
      }, { status: 400 })
    }

    // Signature is valid — upgrade the user's plan.
    //
    // 🔒 IDEMPOTENCY (Audit fix Phase 1.4): This endpoint can be called twice
    // with the same Razorpay payload (double-tap on the "Pay" button, network
    // retry, mobile network flakiness). Without idempotency, a replay would
    // re-extend `renewsAt` and create a second audit-log entry.
    //
    // Fix: wrap all three writes (user.update + subscription.create + auditLog)
    // in a single $transaction. The `@@unique([paymentId])` constraint on
    // Subscription means a duplicate payment ID throws Prisma error P2002 —
    // we catch that and return the existing (already-processed) result
    // instead of creating a duplicate.
    const now = new Date()
    const durationDays = billingCycle === 'yearly' ? 365 : 30
    const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)

    // Calculate the actual amount in rupees (from paise)
    const amountInr = amount / 100

    // Check if this payment was already processed (idempotency fast-path).
    // If a Subscription row with this paymentId exists, the payment was
    // already verified — return the existing result without re-extending.
    const existing = await db.subscription.findUnique({
      where: { paymentId: razorpay_payment_id },
      select: { id: true, plan: true, endDate: true, userId: true },
    })

    if (existing) {
      // Payment already processed — return the same result as the first call.
      // This makes the endpoint idempotent: calling it N times has the same
      // effect as calling it once.
      return NextResponse.json({
        success: true,
        message: 'Payment already verified — subscription is active.',
        plan: existing.plan,
        renewsAt: existing.endDate.toISOString(),
        idempotent: true,  // flag so the client knows this was a replay
      })
    }

    // Atomically: update user plan + create subscription + write audit log.
    // If any one fails, all three roll back — no half-committed state.
    try {
      await db.$transaction([
        db.user.update({
          where: { id: userId },
          data: {
            plan: planId,
            renewsAt: endDate,
            cancelledAt: null,
          },
        }),
        db.subscription.create({
          data: {
            id: `sub_${razorpay_payment_id}`,
            userId,
            plan: planId,
            status: 'active',
            amount: amountInr,
            paymentMode: 'razorpay',
            paymentId: razorpay_payment_id,
            subscriptionId: razorpay_order_id,
            startDate: now,
            endDate,
          },
        }),
        db.auditLog.create({
          data: {
            userId,
            action: 'subscription_activated',
            entityType: 'user',
            entityId: userId,
            metadata: {
              plan: planId,
              billingCycle,
              amount: amountInr,
              paymentId: razorpay_payment_id,
              orderId: razorpay_order_id,
            },
          },
        }),
      ])
    } catch (txError: any) {
      // P2002 = unique constraint violation. This means another request
      // raced us and created the subscription first. Treat as idempotent
      // success — the payment is already processed.
      if (txError?.code === 'P2002') {
        const existing = await db.subscription.findUnique({
          where: { paymentId: razorpay_payment_id },
          select: { plan: true, endDate: true },
        })
        return NextResponse.json({
          success: true,
          message: 'Payment already verified — subscription is active.',
          plan: existing?.plan || planId,
          renewsAt: existing?.endDate?.toISOString() || endDate.toISOString(),
          idempotent: true,
        })
      }
      throw txError  // re-throw any other error
    }

    return NextResponse.json({
      success: true,
      message: `Welcome to ${planId === 'pro' ? 'Pro' : 'Elite'}! Your subscription is active until ${endDate.toLocaleDateString('en-IN')}.`,
      plan: planId,
      renewsAt: endDate.toISOString(),
    })
  } catch (error: any) {
    console.error('Payment verification error:', error)
    return NextResponse.json({
      error: 'Payment verification failed',
      detail: error?.message || String(error),
    }, { status: 500 })
  }
}
