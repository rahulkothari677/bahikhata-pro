import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { upgradeSubscription } from '@/lib/subscription-upgrade'
import { apiError } from '@/lib/api-error'

/**
 * POST /api/payment/webhook
 *
 * 🔒 V26 R9 (Phase 5): Razorpay webhook — the "paid but not upgraded" safety net.
 *
 * Phase 5 audit (R9 🟠): payment/verify is exemplary *when it runs*, but it
 * only runs if the client survives to call it. Phone dies / app killed /
 * network drops between Razorpay's success and the verify POST → money
 * captured, plan still free, nothing reconciles it. The user's recourse was
 * a support complaint.
 *
 * This webhook handles Razorpay's `payment.captured` / `order.paid` events.
 * Razorpay retries the webhook for up to 24 hours if our endpoint returns
 * non-2xx, so as long as we eventually return 200, the upgrade lands.
 *
 * Signature verification: HMAC-SHA256 of the raw body with
 * RAZORPAY_WEBHOOK_SECRET, constant-time compare against x-razorpay-signature.
 *
 * Idempotency: upgradeSubscription's `@@unique([paymentId])` constraint makes
 * webhook+verify double-processing safe — whichever runs first creates the
 * Subscription row; the second one P2002s and returns the existing result.
 *
 * SETUP (operator — do this once in the Razorpay dashboard):
 *   1. Settings → Webhooks → Add New Webhook
 *   2. Webhook URL: https://your-domain.com/api/payment/webhook
 *   3. Secret: a strong random string (also set as RAZORPAY_WEBHOOK_SECRET env)
 *   4. Events: payment.captured, order.paid
 *
 * Env: RAZORPAY_WEBHOOK_SECRET must be set. If unset, the webhook 500s (fail-
 * closed — better to reject all webhooks than to accept unsigned ones).
 */
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!webhookSecret) {
      // 🔒 Fail-closed: no secret configured → reject all webhooks. Better to
      // miss upgrades (user can still call /verify manually) than to accept
      // forged webhook payloads that upgrade arbitrary users.
      console.error('[webhook] RAZORPAY_WEBHOOK_SECRET not set — rejecting all webhooks (fail-closed)')
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }

    // Razorpay signs the RAW body (not parsed JSON). Read as text.
    const rawBody = await req.text()
    const signature = req.headers.get('x-razorpay-signature')
    if (!signature) {
      console.warn('[webhook] missing x-razorpay-signature header')
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    // 🔒 Constant-time HMAC-SHA256 comparison. crypto.timingSafeEqual protects
    // against timing attacks that could recover the secret byte-by-byte.
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex')
    const sigBuf = Buffer.from(signature)
    const expectedBuf = Buffer.from(expectedSig)
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      console.warn('[webhook] invalid signature — rejecting')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    // Signature valid — parse the payload.
    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch {
      console.warn('[webhook] could not parse JSON body')
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const event = payload.event
    // We only handle payment.captured and order.paid. Other events (refund,
    // dispute, etc.) get a 200 so Razorpay stops retrying — we don't need to
    // act on them for plan upgrades.
    if (event !== 'payment.captured' && event !== 'order.paid') {
      console.log(`[webhook] ignoring event: ${event}`)
      return NextResponse.json({ received: true, ignored: true })
    }

    // Extract payment + order details from the payload.
    // Razorpay webhook payload shapes (both events include these):
    //   payment.captured: payload.payload.payment.entity.{id, order_id, amount}
    //   order.paid:       payload.payload.order.entity.{id, amount, notes}
    //                    + payload.payload.payment.entity.{id}
    let razorpay_payment_id: string
    let razorpay_order_id: string
    let amountPaise: number
    let notes: any

    if (event === 'payment.captured') {
      const payment = payload?.payload?.payment?.entity
      if (!payment?.id || !payment?.order_id) {
        console.warn('[webhook] payment.captured missing payment.entity.id or order_id')
        return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
      }
      razorpay_payment_id = payment.id
      razorpay_order_id = payment.order_id
      amountPaise = payment.amount
      // For payment.captured, we need to fetch the order to get notes (userId, plan, cycle).
      // The payment entity doesn't include order notes.
      const Razorpay = (await import('razorpay')).default
      const keyId = process.env.RAZORPAY_KEY_ID!
      const keySecret = process.env.RAZORPAY_KEY_SECRET!
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret })
      const order = await razorpay.orders.fetch(razorpay_order_id)
      notes = order.notes || {}
      amountPaise = Number(order.amount)  // prefer order.amount (set at creation)
    } else {
      // order.paid
      const order = payload?.payload?.order?.entity
      const payment = payload?.payload?.payment?.entity
      if (!order?.id || !payment?.id) {
        console.warn('[webhook] order.paid missing order.entity.id or payment.entity.id')
        return NextResponse.json({ error: 'Missing order/payment details' }, { status: 400 })
      }
      razorpay_payment_id = payment.id
      razorpay_order_id = order.id
      amountPaise = order.amount
      notes = order.notes || {}
    }

    // Extract plan/billingCycle/userId from order notes (same keys as verify).
    // 🔒 V26 C2 FIX: create-order stores 'plan' (was 'planId'), 'cycle' (was 'billingCycle').
    const plan = notes.plan || notes.planId?.split('_')[0]  // backward-compat
    const billingCycle = notes.cycle || notes.billingCycle  // backward-compat
    const userId = notes.userId

    if (!userId) {
      console.error('[webhook] no userId in order notes — cannot upgrade')
      return NextResponse.json({ error: 'Missing userId in order notes' }, { status: 400 })
    }
    if (!plan || !['pro', 'elite'].includes(plan)) {
      console.error('[webhook] invalid plan in order notes:', plan)
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }
    if (!billingCycle || !['monthly', 'yearly'].includes(billingCycle)) {
      console.error('[webhook] invalid billingCycle in order notes:', billingCycle)
      return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 })
    }

    // Verify the user exists (defensive — Razorpay webhooks can arrive for
    // deleted accounts if the user cancelled between order-creation and capture).
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      console.warn(`[webhook] user ${userId} not found — ignoring webhook`)
      return NextResponse.json({ received: true, ignored: true })
    }

    // Idempotent upgrade — safe to call multiple times (webhook retry + verify
    // race). The `@@unique([paymentId])` constraint on Subscription ensures
    // only one row is created.
    const result = await upgradeSubscription({
      userId,
      plan: plan as 'pro' | 'elite',
      billingCycle: billingCycle as 'monthly' | 'yearly',
      amountPaise,
      razorpay_payment_id,
      razorpay_order_id,
    })

    console.log(`[webhook] upgrade result for user ${userId}:`, {
      plan: result.plan,
      idempotent: result.idempotent,
      event,
    })

    // Always return 200 so Razorpay stops retrying. Even if upgradeSubscription
    // returned idempotent:true (already processed), that's a success.
    return NextResponse.json({ received: true, upgraded: !result.idempotent })
  } catch (err) {
    // 🔒 For webhook errors, return 500 so Razorpay retries. But for
    // signature/parse errors, return 400 (don't retry — the payload is
    // malformed and retrying won't help). apiError logs to Sentry.
    return apiError(err, 'Webhook processing failed', 500)
  }
}
