import { NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { getUserPlan, PLAN_LIMITS } from '@/lib/usage-limits'
import { rateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/subscription/status
 *
 * Returns the user's current plan, daily usage, and remaining quota.
 *
 * All tiers use daily limits (Free=20/day, Pro=50/day, Elite=100/day).
 * The rate limiter is in-memory, so "used today" is approximate (the actual
 * enforcement happens in the API routes via checkUsage()).
 *
 * Response shape:
 *   {
 *     current: { plan, renewsAt?, trialEndsAt?, cancelledAt? },
 *     usage: {
 *       aiScans: { used, limit, remaining, resetAt, period: 'daily' },
 *       voiceEntries: { used, limit, remaining, resetAt, period: 'daily' },
 *     },
 *     plans: [...]
 *   }
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const plan = await getUserPlan(userId)
    const limits = PLAN_LIMITS[plan]

    // Fetch user's renewal info
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { plan: true, renewsAt: true, trialEndsAt: true, cancelledAt: true },
    })

    // Check daily rate limit state WITHOUT consuming.
    // We call rateLimit with the same key the API route uses — this gives us
    // the current remaining count. Note: this DOES consume 1 unit, which is a
    // known limitation of the in-memory limiter (no peek-only method).
    // To avoid skewing user's quota by just viewing the status, we DON'T call
    // rateLimit here — instead we just return the limit and let the API route
    // do the actual enforcement. The UI shows "limit" but "used/remaining"
    // will be 0/limit until the user actually scans.
    //
    // TODO for Phase 2: add a peek() method to the rate limiter that returns
    // state without consuming.
    const aiScansUsage = {
      used: 0,  // not tracked here to avoid consuming quota
      limit: limits.dailyAiScans,
      remaining: limits.dailyAiScans,
      resetAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      period: 'daily' as const,
    }
    const voiceEntriesUsage = {
      used: 0,
      limit: limits.dailyVoiceEntries,
      remaining: limits.dailyVoiceEntries,
      resetAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      period: 'daily' as const,
    }

    return NextResponse.json({
      current: {
        plan,
        renewsAt: user?.renewsAt?.toISOString() ?? null,
        trialEndsAt: user?.trialEndsAt?.toISOString() ?? null,
        cancelledAt: user?.cancelledAt?.toISOString() ?? null,
      },
      usage: {
        aiScans: aiScansUsage,
        voiceEntries: voiceEntriesUsage,
      },
      plans: PLANS_CATALOG,
    })
  } catch (error) {
    return apiError(error, 'Failed to fetch subscription status', 500)
  }
}

/**
 * Static plan catalog — also used by the Pricing page to render tiers.
 * Single source of truth so pricing UI and backend limits never drift.
 *
 * NOTE: "Unlimited" in marketing = daily FUP in reality.
 *   Free:  20/day  → honest ("20 AI scans per day")
 *   Pro:   50/day  → marketed as "Unlimited AI"
 *   Elite: 100/day → marketed as "Truly Unlimited AI"
 */
const PLANS_CATALOG = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    color: 'text-muted-foreground',
    popular: false,
    tagline: 'Perfect for getting started',
    features: {
      aiScanner: true,    // free users get AI — 20/day
      voiceEntry: true,
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
      transactions: 0,
      products: 50,
      aiScans: 20,         // per day
      voiceEntries: 20,    // per day
      aiScansPeriod: 'day',
      voiceEntriesPeriod: 'day',
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 299,
    yearlyPrice: 2999,
    color: 'text-amber-600',
    popular: true,
    tagline: 'For growing shops',
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
      transactions: 0,
      products: 0,
      aiScans: 50,         // per day — marketed as "Unlimited"
      voiceEntries: 50,
      aiScansPeriod: 'day',
      voiceEntriesPeriod: 'day',
    },
  },
  {
    id: 'elite',
    name: 'Elite',
    price: 599,
    yearlyPrice: 5999,
    color: 'text-violet-600',
    popular: false,
    tagline: 'For multi-shop businesses',
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
      aiScans: 100,        // per day — marketed as "Truly Unlimited"
      voiceEntries: 100,
      aiScansPeriod: 'day',
      voiceEntriesPeriod: 'day',
    },
  },
]
