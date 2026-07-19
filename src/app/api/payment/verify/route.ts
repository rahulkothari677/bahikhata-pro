import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { fromPaise } from '@/lib/money'
import crypto from 'crypto'
import { apiError } from '@/lib/api-error'
import Razorpay from 'razorpay'

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
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // 🔒 V18: Rate limit payment verification (10/min per user)
    const rl = await rateLimit(`payment-verify:${userId}`, { limit: 10, windowSec: 60 })
    if (!rl.success) return rateLimitedResponse(rl)

    const body = await req.json()
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing Razorpay payment fields' }, { status: 400 })
    }

    // Verify the signature
    // Razorpay generates the signature as: HMAC_SHA256(order_id + '|' + payment_id, key_secret)
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    const keyId = process.env.RAZORPAY_KEY_ID
    if (!keySecret || !keyId) {
      return NextResponse.json({ error: 'Razorpay not configured' }, { status: 503 })
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')

    if (expectedSignature !== razorpay_signature) {
      // 🔒 FIX L2: Was 'Signature mismatch — ...' which confirms to a probing
      // attacker exactly which check failed. Now: generic message.
      console.error('Payment signature mismatch:', {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
      })
      return NextResponse.json({
        error: 'Payment verification failed',
      }, { status: 400 })
    }

    // 🔒 FIX C1: CRITICAL — was trusting client-supplied planId, billingCycle,
    // and amount from the request body. The Razorpay signature only covers
    // order_id|payment_id — it does NOT bind the plan, cycle, or amount.
    // An attacker could pay for Pro-monthly (cheap) but claim Elite-yearly
    // by sending a different planId in the verify request body.
    //
    // Now: fetch the order from Razorpay (server-trusted) and derive
    // planId, billingCycle, and amount from the order's notes + amount
    // (set at creation time by create-order/route.ts). The client body
    // is treated as untrusted hints, never as the source of truth.
    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    })

    let order
    try {
      order = await razorpay.orders.fetch(razorpay_order_id)
    } catch (fetchErr) {
      console.error('Failed to fetch order from Razorpay:', fetchErr)
      return NextResponse.json({
        error: 'Payment verification failed — could not verify order details.',
      }, { status: 400 })
    }

    // Derive everything from the server-trusted order
    // 🔒 V26 C2 FIX: Was reading order.notes?.billingCycle but create-order
    // stores the key as 'cycle' (not 'billingCycle'). Was also reading
    // order.notes?.planId but create-order now stores 'plan' (was 'planId'
    // with value 'pro_monthly' which failed the ['pro','elite'] check).
    // Now: read 'plan' and 'cycle' to match what create-order writes.
    const plan = order.notes?.plan || order.notes?.planId?.split('_')[0]  // backward-compat with old orders
    const billingCycle = order.notes?.cycle || order.notes?.billingCycle  // backward-compat
    const orderUserId = order.notes?.userId
    const amount = order.amount  // in paise, set at order creation

    // Validate the order belongs to the calling user
    if (orderUserId !== userId) {
      console.error('Order userId mismatch:', { orderUserId, userId })
      return NextResponse.json({
        error: 'Payment verification failed — order does not belong to this account.',
      }, { status: 403 })
    }

    // Validate plan and cycle are present and valid
    if (!['pro', 'elite'].includes(plan)) {
      console.error('Invalid plan in order notes:', plan)
      return NextResponse.json({
        error: 'Payment verification failed — invalid plan in order.',
      }, { status: 400 })
    }
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      console.error('Invalid billing cycle in order notes:', billingCycle)
      return NextResponse.json({
        error: 'Payment verification failed — invalid billing cycle in order.',
      }, { status: 400 })
    }

    // Assert order status is paid
    if (order.status !== 'paid') {
      console.error('Order not paid:', { orderId: razorpay_order_id, status: order.status })
      return NextResponse.json({
        error: 'Payment verification failed — order is not paid.',
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
    const amountInr = fromPaise(amount)

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
            plan: plan,
            renewsAt: endDate,
            cancelledAt: null,
          },
        }),
        db.subscription.create({
          data: {
            id: `sub_${razorpay_payment_id}`,
            userId,
            plan: plan,
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
              plan: plan,
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
          plan: existing?.plan || plan,
          renewsAt: existing?.endDate?.toISOString() || endDate.toISOString(),
          idempotent: true,
        })
      }
      throw txError  // re-throw any other error
    }

    return NextResponse.json({
      success: true,
      message: `Welcome to ${plan === 'pro' ? 'Pro' : 'Elite'}! Your subscription is active until ${endDate.toLocaleDateString('en-IN')}.`,
      plan: plan,
      renewsAt: endDate.toISOString(),
    })
  } catch (error: any) {
    // 🔒 V10 §3.3: Was `detail: error?.message || String(error)` — leaked
    // Razorpay signature/verification internals. Now: generic + errorId.
    return apiError(error, 'Payment verification failed', 500)
  }
}
