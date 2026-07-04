import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/overview
 *
 * Returns high-level business metrics for the admin dashboard.
 * Only accessible by the owner account.
 *
 * Returns:
 * - Total users, new users (today/week/month)
 * - Daily/Monthly Active Users (DAU/MAU) based on AuditLog activity
 * - Total transactions, GMV (Gross Merchandise Value)
 * - Total AI scans, AI success rate
 * - User breakdown by role (owner/staff)
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

    // Run all queries in parallel for performance
    const [
      totalUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      ownersCount,
      staffCount,
      totalTransactions,
      totalGMV,
      totalProducts,
      totalParties,
      activeUsersToday,
      activeUsersThisWeek,
      activeUsersThisMonth,
      totalAIScans,
      successfulAIScans,
      recentSignups,
    ] = await Promise.all([
      // User counts
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: todayStart } } }),
      db.user.count({ where: { createdAt: { gte: weekAgo } } }),
      db.user.count({ where: { createdAt: { gte: monthAgo } } }),
      db.user.count({ where: { role: 'owner' } }),
      db.user.count({ where: { role: 'staff' } }),

      // Transaction stats
      db.transaction.count(),
      db.transaction.aggregate({ _sum: { totalAmount: true } }),
      db.product.count(),
      db.party.count(),

      // Active users (from AuditLog — users who performed any action)
      db.auditLog.findMany({
        where: { createdAt: { gte: todayStart }, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      db.auditLog.findMany({
        where: { createdAt: { gte: weekAgo }, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      db.auditLog.findMany({
        where: { createdAt: { gte: thirtyDaysAgo }, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),

      // AI usage (from AuditLog)
      db.auditLog.count({ where: { action: 'ai.scan_bill' } }),
      db.auditLog.count({ where: { action: 'ai.scan_bill.success' } }),

      // Recent signups (last 10)
      db.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      }),
    ])

    // Calculate derived metrics
    const DAU = activeUsersToday.filter(a => a.userId).length
    const WAU = activeUsersThisWeek.filter(a => a.userId).length
    const MAU = activeUsersThisMonth.filter(a => a.userId).length
    const aiSuccessRate = totalAIScans > 0 ? (successfulAIScans / totalAIScans) * 100 : 0

    // Note: MRR is 0 for now since subscription isn't built yet
    const MRR = 0
    const ARPU = totalUsers > 0 ? MRR / totalUsers : 0

    return NextResponse.json({
      users: {
        total: totalUsers,
        newToday: newUsersToday,
        newThisWeek: newUsersThisWeek,
        newThisMonth: newUsersThisMonth,
        owners: ownersCount,
        staff: staffCount,
      },
      engagement: {
        DAU,
        WAU,
        MAU,
        // Stickiness = DAU/MAU (how engaged users are). >20% is excellent.
        stickiness: MAU > 0 ? (DAU / MAU) * 100 : 0,
      },
      business: {
        totalTransactions,
        totalGMV: totalGMV._sum.totalAmount || 0,
        totalProducts,
        totalParties,
        avgTransactionsPerUser: totalUsers > 0 ? totalTransactions / totalUsers : 0,
      },
      ai: {
        totalScans: totalAIScans,
        successfulScans: successfulAIScans,
        successRate: aiSuccessRate,
        scansPerUser: totalUsers > 0 ? totalAIScans / totalUsers : 0,
      },
      revenue: {
        MRR,
        ARPU,
        payingUsers: 0, // TODO: when subscription launches
        conversionRate: 0,
      },
      recentSignups,
      generatedAt: now.toISOString(),
    })
  } catch (error) {
    console.error('[admin/overview] Error:', error)
    return NextResponse.json({ error: 'Failed to load admin overview' }, { status: 500 })
  }
}
