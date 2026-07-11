import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { db as prisma } from '@/lib/db'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/scan-bill/compare/history
 *
 * Returns the user's comparison history (most recent first). Each entry
 * includes the 3 provider results but NOT the image preview (to keep the
 * payload small). The frontend can fetch the preview separately if needed.
 *
 * Query params:
 *   ?limit=20  (max 100)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('scanner')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const limit = Math.min(100, Number(url.searchParams.get('limit') || '20'))

    const comparisons = await prisma.scanComparison.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        imageName: true,
        billType: true,
        geminiResult: true,
        openaiResult: true,
        groqResult: true,
        groundTruth: true,
        geminiScore: true,
        openaiScore: true,
        groqScore: true,
        createdAt: true,
      },
    })

    // Compute aggregate stats across all comparisons
    const stats = computeStats(comparisons)

    return NextResponse.json({
      success: true,
      comparisons,
      stats,
    })
  } catch (error) {
    return apiError(error, 'Failed to fetch history', 500)
  }
}

/**
 * Computes average accuracy, success rate, and average latency per provider.
 */
function computeStats(comparisons: any[]) {
  const init = { count: 0, successCount: 0, totalDurationMs: 0, totalScore: 0, scoreCount: 0 }
  const stats = {
    gemini: { ...init },
    openai: { ...init },
    groq: { ...init },
  }

  for (const c of comparisons) {
    for (const provider of ['gemini', 'openai', 'groq'] as const) {
      const result = c[`${provider}Result`]
      if (!result) continue
      const s = stats[provider]
      s.count++
      if (result.success) s.successCount++
      s.totalDurationMs += result.durationMs || 0
      const score = c[`${provider}Score`]
      if (typeof score === 'number') {
        s.totalScore += score
        s.scoreCount++
      }
    }
  }

  return {
    gemini: finalize(stats.gemini),
    openai: finalize(stats.openai),
    groq: finalize(stats.groq),
    totalComparisons: comparisons.length,
  }
}

function finalize(s: { count: number; successCount: number; totalDurationMs: number; totalScore: number; scoreCount: number }) {
  return {
    tests: s.count,
    successRate: s.count ? (s.successCount / s.count) * 100 : 0,
    avgDurationMs: s.count ? Math.round(s.totalDurationMs / s.count) : 0,
    avgScore: s.scoreCount ? Math.round(s.totalScore / s.scoreCount) : null,
  }
}
