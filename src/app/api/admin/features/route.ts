import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'
import { istDayStart } from '@/lib/timezone'

/**
 * GET /api/admin/features
 *
 * Returns feature usage statistics from the AuditLog.
 * Shows which features are used most, adoption funnels, etc.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    // Count events by action type (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Get all audit log actions with counts (last 30 days)
    const auditLogs = await db.auditLog.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { action: true, userId: true, createdAt: true },
    })

    // Group by action — total count + unique users
    const featureMap = new Map<string, { count: number; uniqueUsers: Set<string> }>()
    auditLogs.forEach(log => {
      const existing = featureMap.get(log.action) || { count: 0, uniqueUsers: new Set<string>() }
      existing.count++
      if (log.userId) existing.uniqueUsers.add(log.userId)
      featureMap.set(log.action, existing)
    })

    // Convert to array + format
    const featureUsage = Array.from(featureMap.entries())
      .map(([action, data]) => ({
        action,
        count: data.count,
        uniqueUsers: data.uniqueUsers.size,
        avgPerUser: data.uniqueUsers.size > 0 ? data.count / data.uniqueUsers.size : 0,
      }))
      .sort((a, b) => b.count - a.count)

    // Feature usage by day (for trend chart) — top 5 features
    // 🔒 FIX M6: Was setHours(0,0,0,0) — server-local time (UTC on Vercel).
    const topFeatures = featureUsage.slice(0, 5).map(f => f.action)
    const now = new Date()
    const usageByDay: Array<Record<string, string | number>> = []
    for (let i = 29; i >= 0; i--) {
      const dayRef = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const day = istDayStart(dayRef)
      const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000)

      const dayData: any = { date: day.toISOString().split('T')[0] }
      topFeatures.forEach(feature => {
        dayData[feature] = auditLogs.filter(
          log => log.action === feature && log.createdAt >= day && log.createdAt < nextDay,
        ).length
      })
      usageByDay.push(dayData)
    }

    // Total active users in last 30 days (for adoption rate calc)
    const totalActiveUsers = new Set(auditLogs.map(l => l.userId).filter(Boolean)).size

    // Adoption rate per feature (% of active users who used each feature)
    const featureAdoption = featureUsage.map(f => ({
      ...f,
      adoptionRate: totalActiveUsers > 0 ? (f.uniqueUsers / totalActiveUsers) * 100 : 0,
    }))

    return NextResponse.json({
      featureUsage: featureAdoption,
      usageByDay,
      totalActiveUsers,
      totalEvents: auditLogs.length,
    })
  } catch (error) {
    console.error('[admin/features] Error:', error)
    return NextResponse.json({ error: 'Failed to load feature usage' }, { status: 500 })
  }
}
