import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Safe query helper
    const safeQuery = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn() } catch { return null }
    }

    const recentUsers = await safeQuery(() => db.user.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      include: { settings: { select: { state: true, shopName: true } } },
      orderBy: { createdAt: 'desc' },
    }))

    if (!recentUsers) {
      return NextResponse.json({
        signupsByDay: [],
        geographicDistribution: [],
        recentUsers: [],
        totalNewUsers30Days: 0,
        avgSignupsPerDay: 0,
      })
    }

    const signupsByDay = []
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now)
      day.setDate(day.getDate() - i)
      day.setHours(0, 0, 0, 0)
      const nextDay = new Date(day)
      nextDay.setDate(nextDay.getDate() + 1)
      const count = recentUsers.filter(u => u.createdAt >= day && u.createdAt < nextDay).length
      signupsByDay.push({ date: day.toISOString().split('T')[0], count })
    }

    const stateMap = new Map<string, number>()
    recentUsers.forEach(u => {
      const state = u.settings?.[0]?.state || 'Unknown'
      stateMap.set(state, (stateMap.get(state) || 0) + 1)
    })

    return NextResponse.json({
      signupsByDay,
      geographicDistribution: Array.from(stateMap.entries()).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
      recentUsers: recentUsers.slice(0, 50).map(u => ({
        id: u.id, email: u.email, name: u.name, role: u.role,
        shopName: u.settings?.[0]?.shopName || 'My Shop',
        state: u.settings?.[0]?.state || 'Unknown',
        createdAt: u.createdAt,
      })),
      totalNewUsers30Days: recentUsers.length,
      avgSignupsPerDay: recentUsers.length / 30,
    })
  } catch (error) {
    console.error('[admin/users] Error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
