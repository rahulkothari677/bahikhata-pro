import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/revenue
 *
 * Returns revenue reports:
 * - Total revenue (all time)
 * - Monthly revenue trend (last 12 months)
 * - Revenue by plan (Pro vs Business)
 * - MRR (Monthly Recurring Revenue)
 * - ARPU (Average Revenue Per User)
 * - Refund total
 */

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    // Get all subscriptions with payment data
    const allSubs = await db.subscription.findMany({
      where: { status: { in: ['active', 'cancelled', 'expired'] } },
      select: {
        amount: true,
        plan: true,
        status: true,
        createdAt: true,
        endDate: true,
      },
    }).catch(() => [])

    // Total revenue (all payments ever)
    const totalRevenue = allSubs.reduce((sum, s) => sum + s.amount, 0)

    // Active subscriptions → MRR
    const activeSubs = allSubs.filter(s => s.status === 'active')
    const mrr = activeSubs.reduce((sum, s) => sum + s.amount, 0)

    // ARPU
    const totalUsers = await db.user.count().catch(() => 1)
    const arpu = totalUsers > 0 ? mrr / totalUsers : 0

    // Revenue by plan
    const proRevenue = activeSubs.filter(s => s.plan === 'pro').reduce((sum, s) => sum + s.amount, 0)
    const businessRevenue = activeSubs.filter(s => s.plan === 'business').reduce((sum, s) => sum + s.amount, 0)
    const enterpriseRevenue = activeSubs.filter(s => s.plan === 'enterprise').reduce((sum, s) => sum + s.amount, 0)

    // Monthly revenue trend (last 12 months)
    const now = new Date()
    const monthlyTrend: { month: string, revenue: number, newSubs: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)
      const monthSubs = allSubs.filter(s => s.createdAt >= monthStart && s.createdAt <= monthEnd)
      const revenue = monthSubs.reduce((sum, s) => sum + s.amount, 0)
      monthlyTrend.push({
        month: monthStart.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        revenue,
        newSubs: monthSubs.length,
      })
    }

    // Refund total
    const refunds = allSubs.filter(s => s.status === 'expired')
    const refundTotal = refunds.reduce((sum, s) => sum + s.amount, 0)

    return NextResponse.json({
      summary: {
        totalRevenue,
        mrr,
        arpu,
        refundTotal,
        activeSubscriptions: activeSubs.length,
        totalSubscriptions: allSubs.length,
      },
      byPlan: {
        pro: { revenue: proRevenue, count: activeSubs.filter(s => s.plan === 'pro').length },
        business: { revenue: businessRevenue, count: activeSubs.filter(s => s.plan === 'business').length },
        enterprise: { revenue: enterpriseRevenue, count: activeSubs.filter(s => s.plan === 'enterprise').length },
      },
      monthlyTrend,
    })
  } catch (error) {
    console.error('[admin/revenue] Error:', error)
    return NextResponse.json({
      summary: { totalRevenue: 0, mrr: 0, arpu: 0, refundTotal: 0, activeSubscriptions: 0, totalSubscriptions: 0 },
      byPlan: { pro: { revenue: 0, count: 0 }, business: { revenue: 0, count: 0 }, enterprise: { revenue: 0, count: 0 } },
      monthlyTrend: [],
    })
  }
}
