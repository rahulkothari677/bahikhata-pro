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

    // Signature is valid — upgrade the user's plan
    const now = new Date()
    const durationDays = billingCycle === 'yearly' ? 365 : 30
    const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)

    // Calculate the actual amount in rupees (from paise)
    const amountInr = amount / 100

    // Update user's plan in the User table
    await db.user.update({
      where: { id: userId },
      data: {
        plan: planId,
        renewsAt: endDate,
        cancelledAt: null,
      },
    })

    // Create a Subscription record for audit trail
    await db.subscription.create({
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
    })

    // Log to audit trail
    await db.auditLog.create({
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
    }).catch(() => {}) // don't fail if audit log fails

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
