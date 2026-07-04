import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const safeQuery = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn() } catch { return null }
    }

    const aiEvents = await safeQuery(() => db.auditLog.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, action: { startsWith: 'ai.' } },
      select: { action: true, userId: true, createdAt: true },
    }))

    if (!aiEvents || aiEvents.length === 0) {
      return NextResponse.json({
        summary: {
          totalScansAttempted: 0,
          totalScansSucceeded: 0,
          totalScansFailed: 0,
          successRate: 0,
          uniqueAIScanners: 0,
          avgScansPerUser: 0,
          totalVoiceAttempts: 0,
          voiceSuccessRate: 0,
          uniqueVoiceUsers: 0,
        },
        costs: {
          costPerScanInr: 0.10,
          costPerVoiceInr: 0.05,
          totalCostInr: 0,
          avgCostPerUser: 0,
        },
        trends: { scansByDay: [] },
        pricingAnalysis: {
          proTierPrice: 99,
          proTierScanLimit: 100,
          proTierCostPerUser: 10,
          proTierProfitPerUser: 89,
          proTierMargin: 89.9,
          businessTierPrice: 299,
          businessTierAvgScans: 200,
          businessTierCostPerUser: 20,
          businessTierProfitPerUser: 279,
          businessTierMargin: 93.3,
        },
      })
    }

    const scansAttempted = aiEvents.filter(e => e.action === 'ai.scan_attempt')
    const scansSucceeded = aiEvents.filter(e => e.action === 'ai.scan_success')
    const scansFailed = aiEvents.filter(e => e.action === 'ai.scan_failure')
    const voiceAttempted = aiEvents.filter(e => e.action === 'ai.voice_attempt')
    const voiceSucceeded = aiEvents.filter(e => e.action === 'ai.voice_success')

    const uniqueAIScanners = new Set(scansAttempted.map(e => e.userId).filter(Boolean)).size
    const uniqueVoiceUsers = new Set(voiceAttempted.map(e => e.userId).filter(Boolean)).size

    const scansByDay: { date: string; scans: number; success: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now)
      day.setDate(day.getDate() - i)
      day.setHours(0, 0, 0, 0)
      const nextDay = new Date(day)
      nextDay.setDate(nextDay.getDate() + 1)
      scansByDay.push({
        date: day.toISOString().split('T')[0],
        scans: scansAttempted.filter(e => e.createdAt >= day && e.createdAt < nextDay).length,
        success: scansSucceeded.filter(e => e.createdAt >= day && e.createdAt < nextDay).length,
      })
    }

    const COST_PER_SCAN = 0.10
    const COST_PER_VOICE = 0.05
    const totalCost = (scansAttempted.length * COST_PER_SCAN) + (voiceAttempted.length * COST_PER_VOICE)

    return NextResponse.json({
      summary: {
        totalScansAttempted: scansAttempted.length,
        totalScansSucceeded: scansSucceeded.length,
        totalScansFailed: scansFailed.length,
        successRate: scansAttempted.length > 0 ? (scansSucceeded.length / scansAttempted.length) * 100 : 0,
        uniqueAIScanners,
        avgScansPerUser: uniqueAIScanners > 0 ? scansAttempted.length / uniqueAIScanners : 0,
        totalVoiceAttempts: voiceAttempted.length,
        voiceSuccessRate: voiceAttempted.length > 0 ? (voiceSucceeded.length / voiceAttempted.length) * 100 : 0,
        uniqueVoiceUsers,
      },
      costs: {
        costPerScanInr: COST_PER_SCAN,
        costPerVoiceInr: COST_PER_VOICE,
        totalCostInr: totalCost,
        avgCostPerUser: uniqueAIScanners > 0 ? totalCost / uniqueAIScanners : 0,
      },
      trends: { scansByDay },
      pricingAnalysis: {
        proTierPrice: 99,
        proTierScanLimit: 100,
        proTierCostPerUser: 100 * COST_PER_SCAN,
        proTierProfitPerUser: 99 - (100 * COST_PER_SCAN),
        proTierMargin: ((99 - (100 * COST_PER_SCAN)) / 99) * 100,
        businessTierPrice: 299,
        businessTierAvgScans: 200,
        businessTierCostPerUser: 200 * COST_PER_SCAN,
        businessTierProfitPerUser: 299 - (200 * COST_PER_SCAN),
        businessTierMargin: ((299 - (200 * COST_PER_SCAN)) / 299) * 100,
      },
    })
  } catch (error) {
    console.error('[admin/ai-usage] Error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
