import { NextResponse } from 'next/server'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import { getUserPlan, PLAN_LIMITS, isFounder } from '@/lib/usage-limits'
import { db, withConnectionRetry } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { istDayStart } from '@/lib/timezone'

/**
 * GET /api/bootstrap
 *
 * 🔒 V21-007: Consolidates the boot fan-out into ONE request.
 *
 * The auditor's §2.1 finding: on dashboard load, the client fires ~14 API
 * calls at once (settings, shops, subscription, dashboard, products, parties,
 * transactions, insights, analytics, warmup, etc.). With connection_limit=1
 * on Neon's pooler, these queue behind each other → 22-30s load times.
 *
 * This endpoint returns the LIGHTWEIGHT boot data (settings + shops +
 * subscription status) in a single request — turning 3 queued requests into 1.
 * The heavy data (dashboard, products, parties, transactions) stays separate
 * because they have their own caching, pagination, and are larger payloads.
 *
 * Returns:
 *   - settings: user's shop profile (gstin, state, shopName, etc.)
 *   - shops: multi-shop list
 *   - subscription: plan + usage + degraded flag
 *
 * All 3 queries run in parallel on the SAME connection (Promise.all), so
 * they share one connection-pool slot instead of occupying 3.
 *
 * Auth: owner only (subscription status requires owner).
 */

export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get plan from JWT (fast, no DB)
    const plan = await getUserPlan(userId)
    const limits = PLAN_LIMITS[plan]

    // 🔒 V21-007: Run all 3 queries in ONE Promise.all — they share a single
    // connection-pool slot (Prisma multiplexes on one connection). This is the
    // key win: 3 separate requests = 3 pool slots (serialized with limit=1),
    // 1 bootstrap request = 1 pool slot for all 3.
    let settings: any = null
    let shops: any[] = []
    let user: { plan?: string; renewsAt?: Date | null; trialEndsAt?: Date | null; cancelledAt?: Date | null } | null = null
    let aiScansUsed = 0
    let voiceEntriesUsed = 0
    let degraded = false

    try {
      const todayStart = istDayStart(new Date())
      // 🔒 V26 R15 (Phase 5): Wrapped in withConnectionRetry for Neon cold-start.
      // Bootstrap is the FIRST call after auth — if it 500s on a cold pool, the
      // user sees a blank screen. The retry gives Neon ~2s to wake up.
      const [settingRow, shopsResult, userRow, aiScansCount, voiceEntriesCount] = await withConnectionRetry(() =>
        Promise.all([
          db.setting.findUnique({ where: { userId } }),
          db.shop.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
          db.user.findUnique({
            where: { id: userId },
            select: { plan: true, renewsAt: true, trialEndsAt: true, cancelledAt: true },
          }),
          db.aiUsageLog.count({
            where: { userId, feature: 'scan-bill', createdAt: { gte: todayStart }, success: true },
          }),
          db.aiUsageLog.count({
            where: { userId, feature: 'voice-parse', createdAt: { gte: todayStart }, success: true },
          }),
        ]),
      )

      settings = settingRow
      shops = shopsResult
      user = userRow
      aiScansUsed = aiScansCount
      voiceEntriesUsed = voiceEntriesCount
    } catch (dbError) {
      // DB failed — return degraded response with plan from JWT + safe defaults
      console.error('[bootstrap] DB failed, returning degraded response:', dbError)
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

    // 🔒 V26 P7-3 (Phase 7): Expose isFounder so the client can gate
    // founderOnly nav entries (AI Usage, etc.). Was: founderOnly gated on
    // isOwner (true for every account) → AI Usage showed for everyone but
    // 403'd for non-founders. Now: the client gets the real founder status.
    const founderStatus = await isFounder(userId).catch(() => false)

    return NextResponse.json({
      settings: settings
        ? { setting: settings }
        : { setting: {} },
      shops: { shops },
      subscription: {
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
        degraded,
      },
      isFounder: founderStatus,  // 🔒 V26 P7-3: real founder check
    })
  } catch (error) {
    return apiError(error, 'Failed to fetch bootstrap data', 500)
  }
}
