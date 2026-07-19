/**
 * 🔒 V26 R9 (Phase 5): Shared subscription-upgrade helper.
 *
 * Phase 5 audit (R9 🟠): the verify route is exemplary *when it runs*, but
 * if the client dies between payment and `/api/payment/verify`, money is
 * captured while the plan stays free, and nothing reconciles it. There was
 * no webhook route and no reconciliation cron.
 *
 * Fix: extract the idempotent upgrade block (user.update + subscription.create
 * + auditLog) into this helper so both the verify route AND the new webhook
 * route can call it. The `@@unique([paymentId])` constraint on Subscription
 * makes webhook+verify double-processing safe: whichever runs first creates
 * the row, the second one P2002s and returns the existing result.
 *
 * Both callers MUST verify the Razorpay signature/order before calling this
 * helper. This helper does NOT do any cryptographic verification — it only
 * performs the idempotent DB upgrade.
 */

import { db } from '@/lib/db'
import { fromPaise } from '@/lib/money'

export interface UpgradeInput {
  userId: string
  plan: 'pro' | 'elite'
  billingCycle: 'monthly' | 'yearly'
  amountPaise: number  // from Razorpay order amount (paise)
  razorpay_payment_id: string
  razorpay_order_id: string
}

export interface UpgradeResult {
  success: boolean
  plan: string  // Prisma's plan field is String (free | pro | elite)
  endDate: Date
  idempotent: boolean  // true if this was a replay (payment already processed)
  message: string
}

/**
 * Idempotently upgrade a user's subscription. Safe to call multiple times with
 * the same paymentId — the `@@unique([paymentId])` constraint on Subscription
 * ensures only one row is created; subsequent calls return the existing result.
 *
 * Wraps user.update + subscription.create + auditLog in a single $transaction.
 * If any one fails, all three roll back — no half-committed state.
 */
export async function upgradeSubscription(input: UpgradeInput): Promise<UpgradeResult> {
  const { userId, plan, billingCycle, amountPaise, razorpay_payment_id, razorpay_order_id } = input

  const now = new Date()
  const durationDays = billingCycle === 'yearly' ? 365 : 30
  const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)
  const amountInr = fromPaise(amountPaise)

  // Idempotency fast-path: if a Subscription row with this paymentId exists,
  // the payment was already verified — return the existing result without
  // re-extending. This makes the helper idempotent: calling it N times has the
  // same effect as calling it once.
  const existing = await db.subscription.findUnique({
    where: { paymentId: razorpay_payment_id },
    select: { id: true, plan: true, endDate: true, userId: true },
  })

  if (existing) {
    return {
      success: true,
      plan: existing.plan,
      endDate: existing.endDate,
      idempotent: true,
      message: 'Payment already verified — subscription is active.',
    }
  }

  // Atomically: update user plan + create subscription + write audit log.
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
            source: 'verify-or-webhook',
          },
        },
      }),
    ])
  } catch (txError: any) {
    // P2002 = unique constraint violation on paymentId. Another request
    // (verify OR webhook) raced us and created the subscription first.
    // Treat as idempotent success — the payment is already processed.
    if (txError?.code === 'P2002') {
      const existing = await db.subscription.findUnique({
        where: { paymentId: razorpay_payment_id },
        select: { plan: true, endDate: true },
      })
      return {
        success: true,
        plan: existing?.plan || plan,
        endDate: existing?.endDate || endDate,
        idempotent: true,
        message: 'Payment already verified — subscription is active.',
      }
    }
    throw txError
  }

  return {
    success: true,
    plan,
    endDate,
    idempotent: false,
    message: `Welcome to ${plan === 'pro' ? 'Pro' : 'Elite'}! Your subscription is active until ${endDate.toLocaleDateString('en-IN')}.`,
  }
}
