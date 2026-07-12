import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/overview
 *
 * Defensive version — handles missing tables gracefully.
 * Returns zeros instead of 500 error if AuditLog table doesn't exist yet.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Helper: safely run a Prisma query, return null on error (e.g. table doesn't exist)
    const safeQuery = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn()
      } catch (e: any) {
        console.warn('[admin/overview] Query failed (table may not exist):', e.message?.slice(0, 100))
        return null
      }
    }

    // Run all queries in parallel, each safely wrapped
    const [
      totalUsers, newUsersToday, newUsersThisWeek, newUsersThisMonth,
      ownersCount, staffCount, totalTransactions, totalGMVAgg,
      totalProducts, totalParties,
      activeToday, activeWeek, activeMonth,
      totalAIScans, successfulAIScans, recentSignups,
    ] = await Promise.all([
      safeQuery(() => db.user.count()),
      safeQuery(() => db.user.count({ where: { createdAt: { gte: todayStart } } })),
      safeQuery(() => db.user.count({ where: { createdAt: { gte: weekAgo } } })),
      safeQuery(() => db.user.count({ where: { createdAt: { gte: monthAgo } } })),
      safeQuery(() => db.user.count({ where: { role: 'owner' } })),
      safeQuery(() => db.user.count({ where: { role: 'staff' } })),
      safeQuery(() => db.transaction.count()),
      safeQuery(() => db.transaction.aggregate({ _sum: { totalAmount: true } })),
      safeQuery(() => db.product.count()),
      safeQuery(() => db.party.count()),
      safeQuery(() => db.auditLog.findMany({ where: { createdAt: { gte: todayStart }, userId: { not: null } }, select: { userId: true }, distinct: ['userId'] })),
      safeQuery(() => db.auditLog.findMany({ where: { createdAt: { gte: weekAgo }, userId: { not: null } }, select: { userId: true }, distinct: ['userId'] })),
      safeQuery(() => db.auditLog.findMany({ where: { createdAt: { gte: thirtyDaysAgo }, userId: { not: null } }, select: { userId: true }, distinct: ['userId'] })),
      safeQuery(() => db.auditLog.count({ where: { action: 'ai.scan_bill' } })),
      safeQuery(() => db.auditLog.count({ where: { action: 'ai.scan_bill.success' } })),
      safeQuery(() => db.user.findMany({ take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, name: true, role: true, createdAt: true } })),
    ])

    const DAU = (activeToday || []).filter(a => a.userId).length
    const WAU = (activeWeek || []).filter(a => a.userId).length
    const MAU = (activeMonth || []).filter(a => a.userId).length
    const aiSuccessRate = (totalAIScans || 0) > 0 ? ((successfulAIScans || 0) / (totalAIScans || 1)) * 100 : 0
    const totalUsersCount = totalUsers || 0

    return NextResponse.json({
      users: {
        total: totalUsersCount,
        newToday: newUsersToday || 0,
        newThisWeek: newUsersThisWeek || 0,
        newThisMonth: newUsersThisMonth || 0,
        owners: ownersCount || 0,
        staff: staffCount || 0,
      },
      engagement: {
        DAU,
        WAU,
        MAU,
        stickiness: MAU > 0 ? (DAU / MAU) * 100 : 0,
      },
      business: {
        totalTransactions: totalTransactions || 0,
        totalGMV: totalGMVAgg?._sum?.totalAmount || 0,
        totalProducts: totalProducts || 0,
        totalParties: totalParties || 0,
        avgTransactionsPerUser: totalUsersCount > 0 ? (totalTransactions || 0) / totalUsersCount : 0,
      },
      ai: {
        totalScans: totalAIScans || 0,
        successfulScans: successfulAIScans || 0,
        successRate: aiSuccessRate,
        scansPerUser: totalUsersCount > 0 ? (totalAIScans || 0) / totalUsersCount : 0,
      },
      revenue: { MRR: 0, ARPU: 0, payingUsers: 0, conversionRate: 0 },
      recentSignups: recentSignups || [],
      generatedAt: now.toISOString(),
    })
  } catch (error) {
    console.error('[admin/overview] Fatal error:', error)
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
