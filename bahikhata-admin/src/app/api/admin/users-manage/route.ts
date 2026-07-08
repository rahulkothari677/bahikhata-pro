import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/users-manage — list all users with pagination + search
 * PUT /api/admin/users-manage — change user plan or block/unblock
 *   Body: { userId, action: 'change_plan' | 'block' | 'unblock', plan?: string }
 */

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const planFilter = searchParams.get('plan') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = 50
    const skip = (page - 1) * limit

    const where: any = {}
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (planFilter && planFilter !== 'all') {
      where.plan = planFilter
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          plan: true,
          createdAt: true,
          updatedAt: true,
          ownerId: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.user.count({ where }),
    ])

    return NextResponse.json({
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('[admin/users-manage] GET error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { userId, action, plan } = await req.json()

    if (!userId || !action) {
      return NextResponse.json({ error: 'userId and action required' }, { status: 400 })
    }

    let updatedUser
    let logAction = ''

    if (action === 'change_plan') {
      if (!plan || !['free', 'pro', 'business', 'enterprise'].includes(plan)) {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
      }
      updatedUser = await db.user.update({
        where: { id: userId },
        data: {
          plan,
          renewsAt: plan === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
      logAction = 'admin.user.change_plan'
    } else if (action === 'block') {
      // We use the 'role' field set to 'blocked' to block users
      updatedUser = await db.user.update({
        where: { id: userId },
        data: { role: 'blocked' },
      })
      logAction = 'admin.user.block'
    } else if (action === 'unblock') {
      // Restore to owner role
      updatedUser = await db.user.update({
        where: { id: userId },
        data: { role: 'owner' },
      })
      logAction = 'admin.user.unblock'
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Log the admin action
    await db.auditLog.create({
      data: {
        userId: auth.userId,
        action: logAction,
        entityType: 'user',
        entityId: userId,
        metadata: { action, plan },
      },
    }).catch(() => {})

    return NextResponse.json({ user: updatedUser })
  } catch (error) {
    console.error('[admin/users-manage] PUT error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
