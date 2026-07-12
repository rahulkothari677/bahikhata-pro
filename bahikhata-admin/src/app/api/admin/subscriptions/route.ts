import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/subscriptions — list all subscriptions + payment history
 * Query params: ?status=active|cancelled|expired|failed
 */

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { searchParams } = new URL(req.url)
    const statusFilter = searchParams.get('status') || ''

    const where: any = {}
    if (statusFilter && statusFilter !== 'all') {
      where.status = statusFilter
    }

    const [subscriptions, total, activeCount, totalRevenue, churnedCount] = await Promise.all([
      db.subscription.findMany({
        where,
        include: {
          user: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.subscription.count({ where }),
      db.subscription.count({ where: { status: 'active' } }),
      db.subscription.aggregate({ _sum: { amount: true }, where: { status: 'active' } }),
      db.subscription.count({ where: { status: 'cancelled' } }),
    ])

    // Get churned users (cancelled in last 30 days)
    // 🔒 V21-009 FIX: Was using updatedAt (doesn't exist on Subscription model).
    // Changed to createdAt — approximates when the cancellation happened.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentChurned = await db.subscription.findMany({
      where: {
        status: 'cancelled',
        createdAt: { gte: thirtyDaysAgo },
      },
      include: {
        user: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }).catch(() => [])

    return NextResponse.json({
      subscriptions: subscriptions.map((s: any) => ({
        ...s,
        userEmail: s.user?.email,
        userName: s.user?.name,
      })),
      total,
      activeCount,
      totalRevenue: totalRevenue._sum.amount || 0,
      churnedCount,
      recentChurned: recentChurned.map((s: any) => ({
        email: s.user?.email,
        name: s.user?.name,
        cancelledAt: s.createdAt,
        plan: s.plan,
      })),
    })
  } catch (error) {
    console.error('[admin/subscriptions] Error:', error)
    return NextResponse.json({
      subscriptions: [],
      total: 0,
      activeCount: 0,
      totalRevenue: 0,
      churnedCount: 0,
      recentChurned: [],
    })
  }
}

/**
 * PUT /api/admin/subscriptions — cancel a subscription
 * Body: { subscriptionId, action: 'cancel' | 'refund' }
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { subscriptionId, action } = await req.json()

    if (action === 'cancel') {
      const sub = await db.subscription.update({
        where: { id: subscriptionId },
        data: { status: 'cancelled' },
      })

      // Also downgrade user to free
      await db.user.update({
        where: { id: sub.userId },
        data: { plan: 'free', renewsAt: null, cancelledAt: new Date() },
      })

      await db.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'admin.subscription.cancel',
          entityType: 'subscription',
          entityId: subscriptionId,
        },
      }).catch(() => {})

      return NextResponse.json({ success: true, message: 'Subscription cancelled, user downgraded to Free.' })
    }

    if (action === 'refund') {
      // Mark as refunded (actual refund happens in Razorpay dashboard)
      const sub = await db.subscription.update({
        where: { id: subscriptionId },
        data: { status: 'expired' },
      })

      await db.user.update({
        where: { id: sub.userId },
        data: { plan: 'free', renewsAt: null },
      }).catch(() => {})

      await db.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'admin.subscription.refund',
          entityType: 'subscription',
          entityId: subscriptionId,
          metadata: { amount: sub.amount },
        },
      }).catch(() => {})

      return NextResponse.json({ success: true, message: 'Subscription refunded. Process the actual refund in Razorpay dashboard.' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
