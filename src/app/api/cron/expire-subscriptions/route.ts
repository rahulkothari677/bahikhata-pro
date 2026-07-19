import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/cron/expire-subscriptions
 *
 * 🔒 V26 F3 FIX: Daily cron that expires subscriptions past their endDate.
 * Was: no cron existed — a paid subscription never expired or downgraded.
 * getUserPlan now checks endDate defensively (returns 'free' if expired),
 * but this cron cleans up the DB: sets Subscription.status='expired' and
 * user.plan='free' for expired subscriptions.
 *
 * Auth: protected by CRON_SECRET header (same pattern as nightly-reconciliation).
 * Schedule: daily (e.g. 00:30 IST via Vercel Cron or GitHub Actions).
 */
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // ─── Auth: verify CRON_SECRET ─────────────────────────────────────────
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured. Subscription expiry cron requires authentication.' },
      { status: 503 },
    )
  }

  const authHeader = req.headers.get('authorization')
  const expectedAuth = `Bearer ${expectedSecret}`
  const authBuf = Buffer.from(authHeader || '')
  const expectedBuf = Buffer.from(expectedAuth)
  if (authBuf.length !== expectedBuf.length || (authBuf.length > 0 && !crypto.timingSafeEqual(authBuf, expectedBuf))) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid or missing CRON_SECRET' },
      { status: 401 },
    )
  }

  try {
    const now = new Date()

    // Find all active subscriptions past their endDate
    const expiredSubs = await db.subscription.findMany({
      where: {
        status: 'active',
        endDate: { lt: now },
      },
      select: { id: true, userId: true, plan: true, endDate: true },
    })

    if (expiredSubs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired subscriptions found.',
        expired: 0,
      })
    }

    // Expire each subscription and downgrade the user's plan
    let expired = 0
    for (const sub of expiredSubs) {
      await db.$transaction([
        // Mark the subscription as expired
        db.subscription.update({
          where: { id: sub.id },
          data: { status: 'expired' },
        }),
        // Downgrade the user's plan to free (only if they don't have a NEWER
        // active subscription — e.g. they renewed before this one expired)
        db.user.updateMany({
          where: {
            id: sub.userId,
            // Only downgrade if there's no other active subscription
            // (check by NOT having any active sub with endDate > now)
            NOT: {
              subscriptions: {
                some: {
                  status: 'active',
                  endDate: { gte: now },
                },
              },
            },
          },
          data: { plan: 'free' },
        }),
      ])
      expired++

      // Audit log the expiry
      try {
        await logAudit({
          userId: sub.userId,
          action: 'subscription.expired',
          entityType: 'subscription',
          entityId: sub.id,
          metadata: {
            plan: sub.plan,
            endDate: sub.endDate.toISOString(),
            expiredAt: now.toISOString(),
          },
        })
      } catch {
        // Non-critical — the expiry itself is what matters
      }
    }

    return NextResponse.json({
      success: true,
      message: `Expired ${expired} subscription(s).`,
      expired,
      expiredSubscriptions: expiredSubs.map(s => ({
        userId: s.userId,
        plan: s.plan,
        endDate: s.endDate.toISOString(),
      })),
    })
  } catch (error) {
    console.error('[cron/expire-subscriptions] Error:', error)
    return NextResponse.json(
      { error: 'Failed to expire subscriptions' },
      { status: 500 },
    )
  }
}
