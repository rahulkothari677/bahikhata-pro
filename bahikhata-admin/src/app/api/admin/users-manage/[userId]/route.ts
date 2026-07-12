import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth'

/**
 * /api/admin/users-manage/[userId]
 *
 * DELETE — delete user account + all data (DPDP Act compliance)
 * POST — impersonate user (get a special session token to login as them)
 *   Body: { action: 'impersonate' | 'extend_trial', days?: number }
 */

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { userId } = await params

    // Prevent self-deletion
    if (userId === auth.userId) {
      return NextResponse.json({ error: 'Cannot delete your own admin account' }, { status: 400 })
    }

    // Delete all user data (cascading)
    await db.transactionItem.deleteMany({ where: { transaction: { userId } } }).catch(() => {})
    await db.transaction.deleteMany({ where: { userId } }).catch(() => {})
    await db.product.deleteMany({ where: { userId } }).catch(() => {})
    await db.party.deleteMany({ where: { userId } }).catch(() => {})
    await db.payment.deleteMany({ where: { userId } }).catch(() => {})
    await db.setting.deleteMany({ where: { userId } }).catch(() => {})
    await db.subscription.deleteMany({ where: { userId } }).catch(() => {})
    await db.usageTracking.deleteMany({ where: { userId } }).catch(() => {})
    await db.user.deleteMany({ where: { ownerId: userId } }).catch(() => {})
    await db.auditLog.deleteMany({ where: { userId } }).catch(() => {})
    await db.user.delete({ where: { id: userId } })

    // Log the deletion
    await db.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'admin.user.delete',
        entityType: 'user',
        entityId: userId,
        metadata: { deletedBy: auth.userId },
      },
    }).catch(() => {})

    return NextResponse.json({ success: true, message: 'User account deleted permanently.' })
  } catch (error) {
    console.error('[admin/users-manage/[userId]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { userId } = await params
    const { action, days } = await req.json()

    if (action === 'extend_trial') {
      // Extend trial by N days
      const trialDays = days || 7
      const newTrialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)

      const user = await db.user.update({
        where: { id: userId },
        data: {
          trialEndsAt: newTrialEnd,
          plan: 'pro', // Give them Pro during trial
          renewsAt: newTrialEnd,
        },
      })

      await db.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'admin.user.extend_trial',
          entityType: 'user',
          entityId: userId,
          metadata: { days: trialDays, newTrialEnd },
        },
      }).catch(() => {})

      return NextResponse.json({ user, message: `Trial extended by ${trialDays} days` })
    }

    if (action === 'impersonate') {
      // Impersonate: return user's ID so admin can login as them
      // In production, this would generate a special JWT token
      // For now, return user details (admin manually uses them)
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, plan: true },
      })

      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      await db.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'admin.user.impersonate',
          entityType: 'user',
          entityId: userId,
          metadata: { impersonatedEmail: user.email },
        },
      }).catch(() => {})

      return NextResponse.json({
        user,
        message: 'Impersonation logged. Use this info to debug user issues.',
        note: 'In production, this would generate a temporary login token.',
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[admin/users-manage/[userId]] POST error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
