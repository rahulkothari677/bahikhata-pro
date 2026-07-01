import { NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { getUserPlan, getMonthlyUsage, PLAN_LIMITS, type Plan } from '@/lib/usage-limits'

/**
 * GET /api/subscription/status
 *
 * Returns the user's current plan, usage this month, and remaining quota
 * for all gated features. Called by the useSubscription hook on app load
 * and after every feature check.
 *
 * Response shape:
 *   {
 *     current: { plan: 'free'|'pro'|'elite', renewsAt?: string },
 *     usage: {
 *       aiScans: { used, limit, remaining, resetAt },
 *       voiceEntries: { used, limit, remaining, resetAt },
 *     },
 *     plans: [...]  // static plan definitions for the pricing page
 *   }
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const plan = await getUserPlan(userId)
    const usage = await getMonthlyUsage(userId)
    const limits = PLAN_LIMITS[plan]

    // Build the reset date (first of next month)
    const now = new Date()
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

    // Fetch user's renewal date from User table (set by Razorpay webhook)
    // We could fetch this in getUserPlan but keeping concerns separate.
    const user = await (await import('@/lib/db')).db.user.findUnique({
      where: { id: userId },
      select: { plan: true, renewsAt: true, trialEndsAt: true, cancelledAt: true },
    })

    return NextResponse.json({
      current: {
        plan,
        renewsAt: user?.renewsAt?.toISOString() ?? null,
        trialEndsAt: user?.trialEndsAt?.toISOString() ?? null,
        cancelledAt: user?.cancelledAt?.toISOString() ?? null,
      },
      usage: {
        aiScans: {
          used: usage.aiScans,
          limit: limits.aiScans,
          remaining: Math.max(0, limits.aiScans - usage.aiScans),
          resetAt: resetAt.toISOString(),
        },
        voiceEntries: {
          used: usage.voiceParses,
          limit: limits.voiceEntries,
          remaining: Math.max(0, limits.voiceEntries - usage.voiceParses),
          resetAt: resetAt.toISOString(),
        },
        transactions: {
          used: usage.transactions,
          limit: limits.transactions, // 0 = unlimited
          remaining: limits.transactions === 0 ? Infinity : Math.max(0, limits.transactions - usage.transactions),
          resetAt: resetAt.toISOString(),
        },
        products: {
          used: usage.products,
          limit: limits.products, // 0 = unlimited
          remaining: limits.products === 0 ? Infinity : Math.max(0, limits.products - usage.products),
          resetAt: null, // products don't reset monthly
        },
      },
      // Static plan catalog for the pricing page
      plans: PLANS_CATALOG,
    })
  } catch (error) {
    console.error('Subscription status error:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription status' }, { status: 500 })
  }
}

/**
 * Static plan catalog — also used by the Pricing page to render tiers.
 * Single source of truth so pricing UI and backend limits never drift.
 */
const PLANS_CATALOG = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    color: 'text-muted-foreground',
    popular: false,
    features: {
      aiScanner: false,
      voiceEntry: false,
      barcodeScanner: false,
      gstrExport: false,
      whatsappSharing: false,
      smartInsights: false,
      recurringEntries: false,
      staffAccounts: false,
      splitView: false,
      customerStatement: false,
      expenseBudgets: false,
      advancedReports: false,
    },
    limits: {
      transactions: 50,
      products: 50,
      aiScans: 5,
      voiceEntries: 5,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 299,
    yearlyPrice: 2999,
    color: 'text-amber-600',
    popular: true,
    features: {
      aiScanner: true,
      voiceEntry: true,
      barcodeScanner: true,
      gstrExport: true,
      whatsappSharing: true,
      smartInsights: false,
      recurringEntries: true,
      staffAccounts: false,
      splitView: true,
      customerStatement: true,
      expenseBudgets: true,
      advancedReports: false,
    },
    limits: {
      transactions: 0, // unlimited
      products: 0,
      aiScans: 150,
      voiceEntries: 150,
    },
  },
  {
    id: 'elite',
    name: 'Elite',
    price: 599,
    yearlyPrice: 5999,
    color: 'text-violet-600',
    popular: false,
    features: {
      aiScanner: true,
      voiceEntry: true,
      barcodeScanner: true,
      gstrExport: true,
      whatsappSharing: true,
      smartInsights: true,
      recurringEntries: true,
      staffAccounts: true,
      splitView: true,
      customerStatement: true,
      expenseBudgets: true,
      advancedReports: true,
    },
    limits: {
      transactions: 0,
      products: 0,
      aiScans: 500,
      voiceEntries: 500,
    },
  },
]
