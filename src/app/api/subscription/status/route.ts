import { NextResponse } from 'next/server'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { getUserPlan, PLAN_LIMITS } from '@/lib/usage-limits'
import { rateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { istDayStart } from '@/lib/timezone'

/**
 * GET /api/subscription/status
 *
 * Returns the user's current plan, daily usage, and remaining quota.
 *
 * 🔒 FIX M6: Was returning used=0/remaining=limit because the in-memory rate
 * limiter had no peek method (calling it would consume quota). Now: queries
 * the DB directly (AiUsageLog) for today's count — durable, accurate, and
 * doesn't consume quota. This is the same table the enforcement path uses
 * (usage-limits.ts N13 DB-backed counter), so the numbers match exactly.
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 🔒 V21-002: Get plan from getUserPlan FIRST — this reads from the JWT/session
    // (fast, no DB) and is the authoritative source for plan. If the DB fails below,
    // we can still return the plan + safe-default usage (0 used = full quota).
    // This prevents a slow DB from locking a paying user out of their plan features.
    const plan = await getUserPlan(userId)
    const limits = PLAN_LIMITS[plan]

    // 🔒 V21-002: Wrap the DB-dependent queries in a try/catch so a slow/failed
    // DB returns a DEGRADED response (plan + 0 usage) instead of a 500.
    // The client treats degraded=true as "usage unknown, allow all" — never
    // blocks a paying user from their plan features.
    let aiScansUsed = 0
    let voiceEntriesUsed = 0
    let user: { plan?: string; renewsAt?: Date | null; trialEndsAt?: Date | null; cancelledAt?: Date | null } | null = null
    let degraded = false

    try {
      user = await db.user.findUnique({
        where: { id: userId },
        select: { plan: true, renewsAt: true, trialEndsAt: true, cancelledAt: true },
      })

      const todayStart = istDayStart(new Date())
      ;[aiScansUsed, voiceEntriesUsed] = await Promise.all([
        db.aiUsageLog.count({
          where: {
            userId,
            feature: 'scan-bill',
            createdAt: { gte: todayStart },
            success: true,
          },
        }),
        db.aiUsageLog.count({
          where: {
            userId,
            feature: 'voice-parse',
            createdAt: { gte: todayStart },
            success: true,
          },
        }),
      ])
    } catch (dbError) {
      // DB failed (pool timeout, connection error, etc.) — return degraded
      // response with the plan (from JWT) + safe-default usage (0 used).
      // The client should treat degraded=true as "usage unknown, allow all"
      // so a slow DB never locks a paying user out of their plan.
      console.error('[subscription/status] DB failed, returning degraded response:', dbError)
      degraded = true
    }

    const aiScansUsage = {
      used: aiScansUsed,
      limit: limits.dailyAiScans,
      remaining: Math.max(0, limits.dailyAiScans - aiScansUsed),
      resetAt: new Date(istDayStart(new Date()).getTime() + 86400 * 1000).toISOString(),
      period: 'daily' as const,
    }
    const voiceEntriesUsage = {
      used: voiceEntriesUsed,
      limit: limits.dailyVoiceEntries,
      remaining: Math.max(0, limits.dailyVoiceEntries - voiceEntriesUsed),
      resetAt: new Date(istDayStart(new Date()).getTime() + 86400 * 1000).toISOString(),
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
      // 🔒 V21-002: degraded=true signals the client that usage counts may be
      // stale (DB was slow/unavailable). The client should allow all plan
      // features (don't gate on usage when we can't read it) and show a
      // subtle "usage sync pending" indicator.
      degraded,
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
