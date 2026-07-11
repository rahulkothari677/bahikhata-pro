import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/referral/status
 *
 * Returns the user's referral stats:
 * - totalReferrals: how many people used their code
 * - completedReferrals: how many actually signed up
 * - rewardThreshold: 3 (refer 3 → get 1 year Pro free)
 * - rewardEarned: whether they've earned the reward
 * - referrals: list of referred users (name + status + date)
 */
const REWARD_THRESHOLD = 3

export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const referrals = await db.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        referred: { select: { name: true, email: true } },
      },
    })

    const totalReferrals = referrals.length
    const completedReferrals = referrals.filter(r => r.status === 'completed' || r.status === 'rewarded').length
    const rewardEarned = referrals.some(r => r.rewardGiven)
    const progressPercent = Math.min((completedReferrals / REWARD_THRESHOLD) * 100, 100)

    return NextResponse.json({
      totalReferrals,
      completedReferrals,
      rewardThreshold: REWARD_THRESHOLD,
      rewardEarned,
      progressPercent,
      referrals: referrals.map(r => ({
        id: r.id,
        status: r.status,
        rewardGiven: r.rewardGiven,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        referredName: r.referred?.name || 'Pending signup',
        referredEmail: r.referred?.email || null,
      })),
    })
  } catch (e) {
    console.error('[referral/status] Error:', e)
    return NextResponse.json({
      totalReferrals: 0,
      completedReferrals: 0,
      rewardThreshold: REWARD_THRESHOLD,
      rewardEarned: false,
      progressPercent: 0,
      referrals: [],
    })
  }
}
