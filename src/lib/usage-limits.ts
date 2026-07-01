/**
 * Usage limits — shared between API routes and the subscription status endpoint.
 *
 * Two types of limits:
 *   1. MONTHLY (UsageTracking DB table): For Free tier — 20 scans + 20 voice/month.
 *      Resets on the 1st of each month.
 *   2. DAILY (in-memory rate limiter): For Pro (50/day) and Elite (100/day).
 *      Resets every 24h. Marketed as "Unlimited" — no real user hits 50/day.
 *
 * Why split?
 *   - Monthly DB tracking is persistent across server restarts (important for
 *     free users who get a hard monthly cap).
 *   - Daily in-memory is faster and auto-resets (important for paid tiers
 *     where the limit is really just burst protection against bots).
 *
 * MARKETING vs REALITY:
 *   - Free:  "20 free AI scans + 20 voice entries per month" (honest)
 *   - Pro:   "Unlimited AI scans" (FUP: 50/day — no real shop exceeds this)
 *   - Elite: "Truly unlimited AI" (FUP: 100/day — for multi-shop power users)
 */

import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

export type Plan = 'free' | 'pro' | 'elite'

export interface PlanLimits {
  // Monthly limits (Free tier only). 0 = unlimited (paid tiers use daily instead)
  monthlyAiScans: number
  monthlyVoiceEntries: number
  // Daily limits (Pro + Elite tiers). 0 = no daily limit (Free uses monthly)
  dailyAiScans: number
  dailyVoiceEntries: number
  // Other limits
  transactions: number     // per month; 0 = unlimited
  products: number         // total; 0 = unlimited
  shops: number            // 1 for free, 3 for pro, Infinity for elite
  staffAccounts: number    // 0 for free+pro, 5 for elite
}

/**
 * Fair Use Policy limits per plan.
 *
 * Free: 20 scans + 20 voice entries/month — enough for a week of real usage
 *       (3/day for 7 days). Builds the habit without feeling like a "tease".
 *       Indian users expect generous free tiers — 5/month felt like clickbait.
 *
 * Pro:  50 scans/day + 50 voice entries/day — ~1,500/month each.
 *       Marketed as "Unlimited AI". A real kirana store does 30-50 transactions
 *       per day total, so 50/day scans = "scan every bill". No real user hits this.
 *       Cost: ~₹54/month/user. At ₹299 revenue = 82% margin.
 *
 * Elite: 100 scans/day + 100 voice entries/day — ~3,000/month each.
 *        Marketed as "Truly Unlimited AI". For multi-shop power users.
 *        Cost: ~₹108/month/user. At ₹599 revenue = 82% margin.
 */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    monthlyAiScans: 20,
    monthlyVoiceEntries: 20,
    dailyAiScans: 0,      // no daily limit — free uses monthly only
    dailyVoiceEntries: 0,
    transactions: 0,      // unlimited
    products: 50,
    shops: 1,
    staffAccounts: 0,
  },
  pro: {
    monthlyAiScans: 0,    // no monthly limit — pro uses daily
    monthlyVoiceEntries: 0,
    dailyAiScans: 50,
    dailyVoiceEntries: 50,
    transactions: 0,
    products: 0,          // unlimited
    shops: 3,
    staffAccounts: 0,
  },
  elite: {
    monthlyAiScans: 0,
    monthlyVoiceEntries: 0,
    dailyAiScans: 100,
    dailyVoiceEntries: 100,
    transactions: 0,
    products: 0,
    shops: Infinity,
    staffAccounts: 5,
  },
}

export type UsageType = 'aiScans' | 'voiceParses' | 'transactions' | 'products'

export interface UsageCheckResult {
  allowed: boolean
  plan: Plan
  used: number          // current period usage (monthly for free, daily for paid)
  limit: number         // current period limit
  remaining: number
  resetAt: Date         // when the current period resets
  period: 'monthly' | 'daily'
  upgradeMessage?: string
}

/**
 * Gets the current YYYY-MM string for monthly tracking.
 */
function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Returns the first moment of next month (when monthly quotas reset).
 */
function nextMonthReset(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/**
 * Returns when the daily quota resets (next midnight UTC).
 * We use UTC for consistency — the exact local midnight doesn't matter
 * for a 24h rolling window.
 */
function nextDayReset(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

/**
 * Fetches the user's plan from the User table.
 * Falls back to 'free' if user not found or plan is invalid.
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  const plan = user?.plan as Plan
  if (plan === 'pro' || plan === 'elite') return plan
  return 'free'
}

/**
 * Gets the user's current monthly usage (for Free tier display).
 * Returns 0 for all counters if no UsageTracking row exists yet.
 */
export async function getMonthlyUsage(userId: string, month = currentMonth()) {
  const row = await db.usageTracking.findUnique({
    where: { userId_month: { userId, month } },
  })
  return {
    aiScans: row?.aiScans ?? 0,
    voiceParses: row?.voiceParses ?? 0,
    transactions: row?.transactions ?? 0,
    products: row?.products ?? 0,
  }
}

/**
 * Checks whether the user can perform the given action.
 *
 * For FREE users: checks monthly usage against monthly limit (DB-backed).
 * For PRO/ELITE users: checks daily rate limit (in-memory, auto-resets).
 *
 * Does NOT increment — use `incrementUsage()` after the action succeeds.
 */
export async function checkUsage(
  userId: string,
  type: UsageType,
): Promise<UsageCheckResult> {
  const plan = await getUserPlan(userId)
  const limits = PLAN_LIMITS[plan]

  // Map UsageType to the limit fields
  const isScan = type === 'aiScans'
  const isVoice = type === 'voiceParses'

  // Non-AI types (transactions, products) — only Free has limits, and they're monthly
  if (!isScan && !isVoice) {
    const monthlyLimit = type === 'transactions' ? limits.transactions : limits.products
    if (monthlyLimit === 0) {
      return {
        allowed: true,
        plan,
        used: 0,
        limit: 0,
        remaining: Infinity,
        resetAt: nextMonthReset(),
        period: 'monthly',
      }
    }
    const usage = await getMonthlyUsage(userId)
    const used = usage[type]
    return {
      allowed: used < monthlyLimit,
      plan,
      used,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - used),
      resetAt: nextMonthReset(),
      period: 'monthly',
      upgradeMessage: used >= monthlyLimit
        ? `You've reached the ${plan === 'free' ? 'Free' : plan} plan limit. Upgrade for more.`
        : undefined,
    }
  }

  // AI types (scans, voice) — different logic per plan
  if (plan === 'free') {
    // Free: monthly DB-backed limit
    const monthlyLimit = isScan ? limits.monthlyAiScans : limits.monthlyVoiceEntries
    const usage = await getMonthlyUsage(userId)
    const used = isScan ? usage.aiScans : usage.voiceParses
    const allowed = used < monthlyLimit

    return {
      allowed,
      plan,
      used,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - used),
      resetAt: nextMonthReset(),
      period: 'monthly',
      upgradeMessage: !allowed
        ? `You've used all ${monthlyLimit} free ${isScan ? 'AI scans' : 'voice entries'} this month. Upgrade to Pro for 50 per day (marketed as "Unlimited").`
        : undefined,
    }
  }

  // Pro / Elite: daily in-memory rate limit
  const dailyLimit = isScan ? limits.dailyAiScans : limits.dailyVoiceEntries
  const rateKey = `${isScan ? 'scan' : 'voice'}:daily:user:${userId}`
  const rl = rateLimit(rateKey, { limit: dailyLimit, windowSec: 86400 })

  // The rate limiter already decremented on this check — so if it failed,
  // the user is over their daily limit.
  return {
    allowed: rl.success,
    plan,
    used: dailyLimit - rl.remaining,
    limit: dailyLimit,
    remaining: rl.remaining,
    resetAt: new Date(Date.now() + rl.retryAfterSec * 1000),
    period: 'daily',
    upgradeMessage: !rl.success
      ? `You've reached today's limit of ${dailyLimit} ${isScan ? 'AI scans' : 'voice entries'} on the ${plan === 'pro' ? 'Pro' : 'Elite'} plan. This resets in ${Math.ceil(rl.retryAfterSec / 3600)} hours.${plan === 'pro' ? ' Upgrade to Elite for 100/day.' : ''}`
      : undefined,
  }
}

/**
 * Increments the usage counter WITHOUT checking the limit first.
 *
 * For FREE users: increments the monthly DB counter (UsageTracking table).
 * For PRO/ELITE users: NO-OP — the daily rate limiter already counted the
 * request in `checkUsage()`. This is because the in-memory limiter is
 * decrement-on-check, not decrement-on-success.
 *
 * ⚠️ Important difference from the old behavior:
 *   - Free users: counter increments AFTER success (failed scans don't count)
 *   - Pro/Elite users: counter increments ON CHECK (failed scans DO count)
 *
 * This is acceptable for Pro/Elite because:
 *   1. Their limits are so high (50-100/day) that one failed scan is negligible
 *   2. The in-memory limiter can't "undo" a decrement — it's not transactional
 *   3. If we didn't count on check, a user could burst 200 requests in 1 second
 *      (all passing the check) before any of them increment
 */
export async function incrementUsage(
  userId: string,
  type: UsageType,
): Promise<void> {
  const plan = await getUserPlan(userId)

  // Pro/Elite: daily limiter already counted it in checkUsage(). Nothing to do.
  if (plan !== 'free') return

  // Free: increment the monthly DB counter
  const month = currentMonth()
  const incrementField: Record<UsageType, any> = {
    aiScans: { aiScans: { increment: 1 } },
    voiceParses: { voiceParses: { increment: 1 } },
    transactions: { transactions: { increment: 1 } },
    products: { products: { increment: 1 } },
  }

  await db.usageTracking.upsert({
    where: { userId_month: { userId, month } },
    create: {
      id: `${userId}-${month}`,
      userId,
      month,
      ...incrementField[type],
      updatedAt: new Date(),
    },
    update: {
      ...incrementField[type],
      updatedAt: new Date(),
    },
  })
}

/**
 * @deprecated Use `checkUsage()` + `incrementUsage()` instead.
 * Kept for backward compatibility — will be removed in a future cleanup.
 */
export async function checkAndIncrementUsage(
  userId: string,
  type: UsageType,
): Promise<UsageCheckResult> {
  const check = await checkUsage(userId, type)
  if (!check.allowed) return check
  await incrementUsage(userId, type)
  return {
    ...check,
    used: check.used + 1,
    remaining: Math.max(0, check.remaining - 1),
  }
}
