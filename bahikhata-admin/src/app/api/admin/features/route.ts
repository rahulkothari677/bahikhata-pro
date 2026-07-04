import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const safeQuery = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn() } catch { return null }
    }

    const auditLogs = await safeQuery(() => db.auditLog.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { action: true, userId: true, createdAt: true },
    }))

    if (!auditLogs || auditLogs.length === 0) {
      return NextResponse.json({
        featureUsage: [],
        usageByDay: [],
        totalActiveUsers: 0,
        totalEvents: 0,
      })
    }

    const featureMap = new Map<string, { count: number; uniqueUsers: Set<string> }>()
    auditLogs.forEach(log => {
      const existing = featureMap.get(log.action) || { count: 0, uniqueUsers: new Set<string>() }
      existing.count++
      if (log.userId) existing.uniqueUsers.add(log.userId)
      featureMap.set(log.action, existing)
    })

    const featureUsage = Array.from(featureMap.entries())
      .map(([action, data]) => ({ action, count: data.count, uniqueUsers: data.uniqueUsers.size, avgPerUser: data.uniqueUsers.size > 0 ? data.count / data.uniqueUsers.size : 0 }))
      .sort((a, b) => b.count - a.count)

    const topFeatures = featureUsage.slice(0, 5).map(f => f.action)
    const now = new Date()
    const usageByDay = []
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now)
      day.setDate(day.getDate() - i)
      day.setHours(0, 0, 0, 0)
      const nextDay = new Date(day)
      nextDay.setDate(nextDay.getDate() + 1)
      const dayData: any = { date: day.toISOString().split('T')[0] }
      topFeatures.forEach(feature => {
        dayData[feature] = auditLogs.filter(log => log.action === feature && log.createdAt >= day && log.createdAt < nextDay).length
      })
      usageByDay.push(dayData)
    }

    const totalActiveUsers = new Set(auditLogs.map(l => l.userId).filter(Boolean)).size

    return NextResponse.json({
      featureUsage: featureUsage.map(f => ({ ...f, adoptionRate: totalActiveUsers > 0 ? (f.uniqueUsers / totalActiveUsers) * 100 : 0 })),
      usageByDay,
      totalActiveUsers,
      totalEvents: auditLogs.length,
    })
  } catch (error) {
    console.error('[admin/features] Error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
