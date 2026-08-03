import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { validateBody, applyReferralSchema } from '@/lib/validation'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { logAudit } from '@/lib/audit'
import { apiError } from '@/lib/api-error'

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
 *
 * 🔒 V17-Ext Tier 3 Step 3: CAs are now blocked. Was: used getAuthUserId (which
 * returns ownerId for CAs) → a CA could apply a referral code to the OWNER's
 * account, granting the owner a Pro trial and modifying the owner's plan. Now:
 * assertCanWrite blocks CAs with 403.
 */

const REWARD_THRESHOLD = 3
const REWARD_DURATION_DAYS = 365

export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 🔒 V17-Ext Tier 3 Step 3: Block CAs — applying referrals modifies the
    // user's plan, which is an owner-only action.
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const userId = authCtx.userId
    // 🔒 V18: Rate limit referral application (3/hour — prevents brute force)
    const rl = await rateLimit(`referral:${userId}`, { limit: 3, windowSec: 3600 })
    if (!rl.success) return rateLimitedResponse(rl)


    const body = await req.json()
    const validation = validateBody(applyReferralSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { code } = validation.data

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

    /*
     * 🔒 REWRITTEN 2026-08-03 (Phase 3). Three separate defects lived here.
     *
     * 1. THE REWARD DID NOTHING. Both grants set `user.plan = 'pro'` and never
     *    created a Subscription row. Since V26 F3, getUserPlan() treats
     *    `user.plan` as a claim to be checked: it looks for an active,
     *    non-expired Subscription and returns 'free' when there is none. So a
     *    shopkeeper who referred three friends was told "you earned 1 year of
     *    Pro" — and stayed on the free plan. Same for the "You got 7 days of
     *    Pro free 🎉" welcome trial. Neither feature has ever worked since that
     *    expiry fix landed. This is an interaction bug: both changes were
     *    correct on their own.
     *
     * 2. NOT ATOMIC. referral.update → user.update → referral.updateMany ran as
     *    three separate writes. A crash after granting Pro but before marking
     *    the referrals `rewardGiven` left them eligible, so the NEXT completed
     *    referral crossed the threshold again and granted another year.
     *
     * 3. RACY. The code was claimed by `findFirst({ status: 'pending' })`
     *    followed by an unconditional `update` — two requests could both see it
     *    pending and both redeem it. The threshold `count()` had the same
     *    read-then-act shape.
     *
     * All three are fixed by one interactive transaction: the code is claimed
     * with a conditional updateMany (whoever's write matches `status:
     * 'pending'` wins, the loser sees count 0), the threshold is counted inside
     * the same transaction, and each grant writes BOTH the user row and the
     * Subscription row that makes it real.
     */
    const REWARD_PAYMENT_MODE = 'referral'
    const TRIAL_PAYMENT_MODE = 'referral_trial'

    const outcome = await db.$transaction(async (tx) => {
      // Claim the code. The WHERE carries the status, so exactly one concurrent
      // request can win — the read above was only a fast pre-check.
      const claimed = await tx.referral.updateMany({
        where: { id: referral.id, status: 'pending' },
        data: { referredId: userId, status: 'completed', completedAt: new Date() },
      })
      if (claimed.count === 0) return { claimed: false, rewardGranted: false }

      let rewardGranted = false
      const completedCount = await tx.referral.count({
        where: { referrerId: referral.referrerId, status: 'completed' },
      })

      if (completedCount >= REWARD_THRESHOLD) {
        const rewardEnd = new Date(Date.now() + REWARD_DURATION_DAYS * 24 * 60 * 60 * 1000)

        // Mark the referrals FIRST, conditionally. If another request already
        // rewarded them, count is 0 and we do not grant a second year.
        const marked = await tx.referral.updateMany({
          where: { referrerId: referral.referrerId, status: 'completed', rewardGiven: false },
          data: { rewardGiven: true, status: 'rewarded' },
        })

        if (marked.count > 0) {
          await tx.user.update({
            where: { id: referral.referrerId },
            data: { plan: 'pro', renewsAt: rewardEnd, cancelledAt: null },
          })
          // The row that actually grants the plan. `amount: 0` — earned, not paid.
          await tx.subscription.create({
            data: {
              id: `ref_${referral.id}`,
              userId: referral.referrerId,
              plan: 'pro',
              status: 'active',
              amount: 0,
              paymentMode: REWARD_PAYMENT_MODE,
              startDate: new Date(),
              endDate: rewardEnd,
            },
          })
          rewardGranted = true
        }
      }

      // The new user's 7-day welcome trial — same treatment.
      const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await tx.user.update({
        where: { id: userId },
        data: { plan: 'pro', trialEndsAt: trialEnd, renewsAt: trialEnd },
      })
      await tx.subscription.create({
        data: {
          id: `reftrial_${referral.id}`,
          userId,
          plan: 'pro',
          status: 'active',
          amount: 0,
          paymentMode: TRIAL_PAYMENT_MODE,
          startDate: new Date(),
          endDate: trialEnd,
        },
      })

      return { claimed: true, rewardGranted }
    })

    if (!outcome.claimed) {
      // Another request redeemed this code between our read and our claim.
      return NextResponse.json({ error: 'Invalid or already used referral code' }, { status: 400 })
    }
    const rewardGranted = outcome.rewardGranted

    if (rewardGranted) {
      await logAudit({
        userId: referral.referrerId,
        action: 'referral.reward_earned',
        entityType: 'referral',
        metadata: { reward: '1_year_pro' },
        req,
      })
    }

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
    return apiError(e, 'Failed to apply referral code', 500)
  }
}
