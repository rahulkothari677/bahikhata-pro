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

    const plan = await getUserPlan(userId)
    const limits = PLAN_LIMITS[plan]

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { plan: true, renewsAt: true, trialEndsAt: true, cancelledAt: true },
    })

    // 🔒 FIX M6: Query the DB for today's actual usage count. This is durable
    // (survives serverless instance recycling), accurate (same source as the
    // enforcement path), and doesn't consume quota (it's a SELECT, not a
    // rateLimit call). Uses IST day boundary (consistent with usage-limits.ts).
    const todayStart = istDayStart(new Date())
    const [aiScansUsed, voiceEntriesUsed] = await Promise.all([
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

    const aiScansUsage = {
      used: aiScansUsed,
      limit: limits.dailyAiScans,
      remaining: Math.max(0, limits.dailyAiScans - aiScansUsed),
      resetAt: new Date(todayStart.getTime() + 86400 * 1000).toISOString(),
      period: 'daily' as const,
    }
    const voiceEntriesUsage = {
      used: voiceEntriesUsed,
      limit: limits.dailyVoiceEntries,
      remaining: Math.max(0, limits.dailyVoiceEntries - voiceEntriesUsed),
      resetAt: new Date(todayStart.getTime() + 86400 * 1000).toISOString(),
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
