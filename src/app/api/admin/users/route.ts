import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'
import { istDayStart } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/admin/users
 *
 * Returns user signup trends for the last 30 days + geographic distribution.
 * Used for the Users page in admin dashboard.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Get all users who signed up in last 30 days (with their settings for state info)
    const recentUsers = await db.user.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      include: {
        settings: { select: { state: true, shopName: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Group signups by day for trend chart
    // 🔒 FIX M6: Was setHours(0,0,0,0) — server-local time (UTC on Vercel).
    const signupsByDay: { date: string; count: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const dayRef = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const day = istDayStart(dayRef)
      const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000)

      const count = recentUsers.filter(u => u.createdAt >= day && u.createdAt < nextDay).length
      signupsByDay.push({
        date: day.toISOString().split('T')[0],
        count,
      })
    }

    // Group by state (geographic distribution)
    const stateMap = new Map<string, number>()
    recentUsers.forEach(u => {
      const state = u.settings?.[0]?.state || 'Unknown'
      stateMap.set(state, (stateMap.get(state) || 0) + 1)
    })
    const geographicDistribution = Array.from(stateMap.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)

    // Most recent 50 users (for the table)
    const recentUsersList = recentUsers.slice(0, 50).map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      shopName: u.settings?.[0]?.shopName || 'My Shop',
      state: u.settings?.[0]?.state || 'Unknown',
      createdAt: u.createdAt,
    }))

    return NextResponse.json({
      signupsByDay,
      geographicDistribution,
      recentUsers: recentUsersList,
      totalNewUsers30Days: recentUsers.length,
      avgSignupsPerDay: recentUsers.length / 30,
    })
  } catch (error) {
    return apiError(error, 'Failed to load users data', 500)
  }
}
