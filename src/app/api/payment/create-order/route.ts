import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { db } from '@/lib/db'
import Razorpay from 'razorpay'

/**
 * POST /api/payment/create-order
 *
 * Creates a Razorpay order for the user's selected plan.
 * Called by CheckoutButton.tsx when user clicks "Upgrade to Pro/Elite".
 *
 * Request body:
 *   { planId: 'pro' | 'elite', billingCycle: 'monthly' | 'yearly' }
 *
 * Response:
 *   { success: true, orderId, amount, currency, keyId }
 *
 * Environment vars needed:
 *   RAZORPAY_KEY_ID     — from https://dashboard.razorpay.com/app/keys
 *   RAZORPAY_KEY_SECRET — from same page
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { planId, billingCycle } = await req.json()

    // Validate planId
    if (!['pro', 'elite'].includes(planId)) {
      return NextResponse.json({ error: `Invalid plan: ${planId}. Must be 'pro' or 'elite'.` }, { status: 400 })
    }

    // Validate billingCycle
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      return NextResponse.json({ error: `Invalid billing cycle: ${billingCycle}` }, { status: 400 })
    }

    // Check Razorpay keys are configured
    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keyId || !keySecret) {
      return NextResponse.json({
        error: 'Razorpay not configured',
        detail: 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel env vars. Get them from https://dashboard.razorpay.com/app/keys',
      }, { status: 503 })
    }

    // 🔒 AUDIT FIX V5: Use unified pricing from PRICING_CONFIG (single source of truth)
    // Was: hardcoded prices that could drift from subscription.ts. Now: reads from
    // the same config that the UI and usage-limits.ts use.
    const { PRICING_CONFIG } = await import('@/lib/subscription')
    const planConfig = PRICING_CONFIG[planId as 'pro' | 'elite']
    if (!planConfig) {
      return NextResponse.json({ error: `Invalid plan: ${planId}` }, { status: 400 })
    }

    const amount = billingCycle === 'yearly'
      ? planConfig.priceInPaise.yearly
      : planConfig.priceInPaise.monthly

    // Initialize Razorpay client
    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    })

    // Create the order
    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `bizp_${planId}_${billingCycle}_${userId.slice(-8)}_${Date.now()}`,
      notes: {
        userId,
        planId,
        billingCycle,
        appName: 'EkBook',
      },
    })

    return NextResponse.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,  // frontend needs this to open Razorpay checkout
    })
  } catch (error: any) {
    console.error('Create order error:', error)
    return NextResponse.json({
      error: 'Failed to create payment order',
      detail: error?.error?.description || error?.message || String(error),
    }, { status: 500 })
  }
}
