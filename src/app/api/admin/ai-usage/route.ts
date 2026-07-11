import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'
import { istDayStart } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/admin/ai-usage
 *
 * Returns AI usage statistics — critical for pricing decisions.
 * Shows scans per user, success rate, cost analysis.
 *
 * Cost calc: Groq Llama 4 Scout costs ~$0.001 per scan (we use it for OCR)
 * At ₹83/USD = ₹0.083 per scan. Plus Cloudinary storage ~₹0.001 per image.
 * Total cost per scan ≈ ₹0.10
 *
 * At Pro tier (₹99/mo, 100 scans included):
 *   Revenue: ₹99
 *   Cost: 100 × ₹0.10 = ₹10
 *   Profit: ₹89 per user per month (90% margin!)
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Get all AI scan events from audit log (last 30 days)
    const aiEvents = await db.auditLog.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        action: { startsWith: 'ai.' },
      },
      select: {
        action: true,
        userId: true,
        metadata: true,
        createdAt: true,
      },
    })

    // Separate by action
    const scansAttempted = aiEvents.filter(e => e.action === 'ai.scan_attempt')
    const scansSucceeded = aiEvents.filter(e => e.action === 'ai.scan_success')
    const scansFailed = aiEvents.filter(e => e.action === 'ai.scan_failure')
    const voiceAttempted = aiEvents.filter(e => e.action === 'ai.voice_attempt')
    const voiceSucceeded = aiEvents.filter(e => e.action === 'ai.voice_success')

    // Unique users who used AI
    const uniqueAIScanners = new Set(scansAttempted.map(e => e.userId).filter(Boolean)).size
    const uniqueVoiceUsers = new Set(voiceAttempted.map(e => e.userId).filter(Boolean)).size

    // Scans by day (for trend chart)
    // 🔒 FIX M6: Was setHours(0,0,0,0) — server-local time (UTC on Vercel).
    const scansByDay: { date: string; scans: number; success: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const dayRef = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const day = istDayStart(dayRef)
      const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000)

      const dayScans = scansAttempted.filter(e => e.createdAt >= day && e.createdAt < nextDay).length
      const daySuccess = scansSucceeded.filter(e => e.createdAt >= day && e.createdAt < nextDay).length
      scansByDay.push({
        date: day.toISOString().split('T')[0],
        scans: dayScans,
        success: daySuccess,
      })
    }

    // Cost calculation (rough estimates)
    const COST_PER_SCAN_INR = 0.10 // ₹0.10 per AI scan (Groq + Cloudinary)
    const COST_PER_VOICE_INR = 0.05 // ₹0.05 per voice parse (Groq text only)
    const totalScans = scansAttempted.length
    const totalVoice = voiceAttempted.length
    const totalCost = (totalScans * COST_PER_SCAN_INR) + (totalVoice * COST_PER_VOICE_INR)

    // Average scans per user
    const avgScansPerUser = uniqueAIScanners > 0 ? totalScans / uniqueAIScanners : 0

    // Success rate
    const successRate = totalScans > 0 ? (scansSucceeded.length / totalScans) * 100 : 0

    return NextResponse.json({
      summary: {
        totalScansAttempted: totalScans,
        totalScansSucceeded: scansSucceeded.length,
        totalScansFailed: scansFailed.length,
        successRate,
        uniqueAIScanners,
        avgScansPerUser,
        totalVoiceAttempts: totalVoice,
        voiceSuccessRate: totalVoice > 0 ? (voiceSucceeded.length / totalVoice) * 100 : 0,
        uniqueVoiceUsers,
      },
      costs: {
        costPerScanInr: COST_PER_SCAN_INR,
        costPerVoiceInr: COST_PER_VOICE_INR,
        totalCostInr: totalCost,
        estimatedMonthlyCost: totalCost, // last 30 days = monthly
        avgCostPerUser: uniqueAIScanners > 0 ? totalCost / uniqueAIScanners : 0,
      },
      trends: {
        scansByDay,
      },
      pricingAnalysis: {
        // At Pro tier (₹99/mo, 100 scans included)
        proTierPrice: 99,
        proTierScanLimit: 100,
        proTierCostPerUser: 100 * COST_PER_SCAN_INR, // ₹10
        proTierProfitPerUser: 99 - (100 * COST_PER_SCAN_INR), // ₹89
        proTierMargin: ((99 - (100 * COST_PER_SCAN_INR)) / 99) * 100, // ~90%
        // At Business tier (₹299/mo, unlimited scans — assume avg 200 scans/user)
        businessTierPrice: 299,
        businessTierAvgScans: 200,
        businessTierCostPerUser: 200 * COST_PER_SCAN_INR, // ₹20
        businessTierProfitPerUser: 299 - (200 * COST_PER_SCAN_INR), // ₹279
        businessTierMargin: ((299 - (200 * COST_PER_SCAN_INR)) / 299) * 100, // ~93%
      },
    })
  } catch (error) {
    return apiError(error, 'Failed to load AI usage data', 500)
  }
}
