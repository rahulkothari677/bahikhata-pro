import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/referral/apply
 *
 * Called during signup when a user has a referral code.
 * Links the new user to the referrer.
 *
 * Body: { code: string }
 *
 * Flow:
 * 1. New user signs up with referral code (from URL ?ref=CODE)
 * 2. After signup, this endpoint is called
 * 3. Finds the referral record by code
 * 4. Sets referredId to the new user
 * 5. Sets status to 'completed'
 * 6. Checks if referrer has reached 3 completed referrals → grants 1 year Pro
 */

const REWARD_THRESHOLD = 3
const REWARD_DURATION_DAYS = 365

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { code } = await req.json()

    if (!code) {
      return NextResponse.json({ error: 'Referral code required' }, { status: 400 })
    }

    const upperCode = code.toUpperCase().trim()

    // Find the referral by code
    const referral = await db.referral.findFirst({
      where: { code: upperCode, status: 'pending' },
    })

    if (!referral) {
      return NextResponse.json({ error: 'Invalid or already used referral code' }, { status: 400 })
    }

    // Prevent self-referral
    if (referral.referrerId === userId) {
      return NextResponse.json({ error: 'Cannot use your own referral code' }, { status: 400 })
    }

    // Link the new user to this referral
    await db.referral.update({
      where: { id: referral.id },
      data: {
        referredId: userId,
        status: 'completed',
        completedAt: new Date(),
      },
    })

    // Check if referrer has reached the threshold
    const completedCount = await db.referral.count({
      where: { referrerId: referral.referrerId, status: 'completed' },
    })

    let rewardGranted = false

    if (completedCount >= REWARD_THRESHOLD) {
      // Grant 1 year Pro to the referrer!
      const rewardEnd = new Date(Date.now() + REWARD_DURATION_DAYS * 24 * 60 * 60 * 1000)

      await db.user.update({
        where: { id: referral.referrerId },
        data: {
          plan: 'pro',
          renewsAt: rewardEnd,
          cancelledAt: null,
        },
      })

      // Mark all their referrals as rewarded
      await db.referral.updateMany({
        where: { referrerId: referral.referrerId, status: 'completed', rewardGiven: false },
        data: { rewardGiven: true, status: 'rewarded' },
      })

      rewardGranted = true

      await logAudit({
        userId: referral.referrerId,
        action: 'referral.reward_earned',
        entityType: 'referral',
        metadata: { completedCount, reward: '1_year_pro' },
        req,
      })
    }

    // Also give the NEW user a 7-day Pro trial as a welcome bonus
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await db.user.update({
      where: { id: userId },
      data: {
        plan: 'pro',
        trialEndsAt: trialEnd,
        renewsAt: trialEnd,
      },
    })

    await logAudit({
      userId,
      action: 'referral.applied',
      entityType: 'referral',
      entityId: referral.id,
      metadata: { code: upperCode, referrerId: referral.referrerId, rewardGranted, trialDays: 7 },
      req,
    })

    return NextResponse.json({
      success: true,
      message: 'Referral code applied! You got 7 days of Pro free. 🎉',
      trialDays: 7,
      referrerRewardGranted: rewardGranted,
    })
  } catch (e) {
    console.error('[referral/apply] Error:', e)
    return NextResponse.json({ error: 'Failed to apply referral code' }, { status: 500 })
  }
}
