import { NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { isFounder } from '@/lib/usage-limits'
import { formatCostInr, getPricingInfo, USD_TO_INR } from '@/lib/ai-pricing'

/**
 * GET /api/ai-usage
 *
 * Returns aggregated AI usage stats for the logged-in user:
 *   - Today's calls, tokens, cost
 *   - This week, this month, all-time
 *   - Per-feature breakdown (scan-bill vs voice-parse)
 *   - Per-provider breakdown (gemini vs groq vs openai)
 *   - Recent calls (last 20) with full details
 *   - Current pricing for the active provider
 *
 * Only founders can access this — it's a cost-tracking dashboard, not
 * user-facing. Regular users get a 403.
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only founders can see cost data — it's sensitive business info
    const founder = await isFounder(userId)
    if (!founder) {
      return NextResponse.json({ error: 'Access denied. Founder only.' }, { status: 403 })
    }

    // Time boundaries
    const now = new Date()
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)  // last 7 days
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    // Fetch all logs in parallel for speed
    const [todayLogs, weekLogs, monthLogs, allTimeAggregate, recentLogs] = await Promise.all([
      db.aiUsageLog.findMany({ where: { userId, createdAt: { gte: todayStart } } }),
      db.aiUsageLog.findMany({ where: { userId, createdAt: { gte: weekStart } } }),
      db.aiUsageLog.findMany({ where: { userId, createdAt: { gte: monthStart } } }),
      db.aiUsageLog.aggregate({
        where: { userId },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, costInr: true },
        _count: true,
      }),
      db.aiUsageLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    // Compute aggregated stats
    const today = aggregateLogs(todayLogs)
    const week = aggregateLogs(weekLogs)
    const month = aggregateLogs(monthLogs)
    const allTime = {
      calls: allTimeAggregate._count,
      inputTokens: allTimeAggregate._sum.inputTokens || 0,
      outputTokens: allTimeAggregate._sum.outputTokens || 0,
      totalTokens: allTimeAggregate._sum.totalTokens || 0,
      costInr: allTimeAggregate._sum.costInr || 0,
    }

    // Per-feature breakdown (this month)
    const featureBreakdown = {
      'scan-bill': aggregateLogs(monthLogs.filter(l => l.feature === 'scan-bill')),
      'voice-parse': aggregateLogs(monthLogs.filter(l => l.feature === 'voice-parse')),
      'scan-compare': aggregateLogs(monthLogs.filter(l => l.feature === 'scan-compare')),
    }

    // Per-provider breakdown (this month)
    const providers = ['gemini', 'openai', 'groq', 'vlm', 'zai-sdk'] as const
    const providerBreakdown: Record<string, any> = {}
    for (const p of providers) {
      const logs = monthLogs.filter(l => l.provider === p)
      if (logs.length > 0) {
        providerBreakdown[p] = {
          ...aggregateLogs(logs),
          models: [...new Set(logs.map(l => l.model))],
        }
      }
    }

    // Current pricing for the active provider (for display)
    const activeProvider = process.env.VLM_API_KEY ? 'vlm' : 'gemini'
    const activeModel = process.env.VLM_MODEL || 'gemini-2.5-flash'
    const pricing = getPricingInfo(activeProvider === 'vlm' ? 'gemini' : activeProvider, activeModel)

    return NextResponse.json({
      success: true,
      periods: { today, week, month, allTime },
      featureBreakdown,
      providerBreakdown,
      recentCalls: recentLogs.map(l => ({
        id: l.id,
        feature: l.feature,
        provider: l.provider,
        model: l.model,
        inputTokens: l.inputTokens,
        outputTokens: l.outputTokens,
        totalTokens: l.totalTokens,
        costInr: l.costInr,
        costDisplay: formatCostInr(l.costInr),
        durationMs: l.durationMs,
        success: l.success,
        errorMessage: l.errorMessage,
        createdAt: l.createdAt.toISOString(),
      })),
      currentPricing: {
        provider: activeProvider,
        model: activeModel,
        inputPer1M: pricing.inputPer1M,
        outputPer1M: pricing.outputPer1M,
        inputPer1MInr: pricing.inputPer1M * USD_TO_INR,
        outputPer1MInr: pricing.outputPer1M * USD_TO_INR,
        usdToInr: USD_TO_INR,
      },
    })
  } catch (error) {
    console.error('AI usage fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI usage' }, { status: 500 })
  }
}

/**
 * Aggregates an array of AiUsageLog rows into summary stats.
 */
function aggregateLogs(logs: any[]) {
  return {
    calls: logs.length,
    successCount: logs.filter(l => l.success).length,
    failCount: logs.filter(l => !l.success).length,
    inputTokens: logs.reduce((s, l) => s + l.inputTokens, 0),
    outputTokens: logs.reduce((s, l) => s + l.outputTokens, 0),
    totalTokens: logs.reduce((s, l) => s + l.totalTokens, 0),
    costInr: logs.reduce((s, l) => s + l.costInr, 0),
    avgDurationMs: logs.length ? Math.round(logs.reduce((s, l) => s + l.durationMs, 0) / logs.length) : 0,
  }
}
