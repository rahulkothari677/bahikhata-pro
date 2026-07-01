/**
 * Usage limits — shared between API routes and the subscription status endpoint.
 *
 * All tiers use DAILY in-memory rate limits (24h rolling window). This gives:
 *   - Tight burst protection (can't do 1,200 scans in 1 hour)
 *   - Auto-reset (no DB cleanup needed)
 *   - "Generous free tier" feel (20/day = enough to really use the app)
 *
 * MARKETING vs REALITY:
 *   - Free:  "20 AI scans + 20 voice entries per day" (honest — generous to drive adoption)
 *   - Pro:   "Unlimited AI scans" (FUP: 50/day — no real shop exceeds this)
 *   - Elite: "Truly unlimited AI" (FUP: 100/day — for multi-shop power users)
 *
 * Cost math at max usage (with Gemini 2.5 Flash + grayscale):
 *   Free:  20+20/day = 1,200/mo → ₹10.80/user/mo (cheaper than paid CAC ₹50-100/install)
 *   Pro:   50+50/day = 3,000/mo → ₹54/user/mo (revenue ₹299 = 82% margin)
 *   Elite: 100+100/day = 6,000/mo → ₹108/user/mo (revenue ₹599 = 82% margin)
 *
 * Founder strategy: lure users with generous free tier → drive viral referrals →
 * reduce free limits later once user base is established.
 */

import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

export type Plan = 'free' | 'pro' | 'elite'

export interface PlanLimits {
  dailyAiScans: number
  dailyVoiceEntries: number
  transactions: number     // per month; 0 = unlimited
  products: number         // total; 0 = unlimited
  shops: number            // 1 for free, 3 for pro, Infinity for elite
  staffAccounts: number    // 0 for free+pro, 5 for elite
}

/**
 * Daily Fair Use Policy limits per plan.
 *
 * Free: 20 scans + 20 voice entries/day — enough to fully run a small shop
 *       on the free plan for a week. Founder's explicit strategy: lure users
 *       with generous free tier → drive viral referrals → reduce free limits
 *       later once user base is established.
 *       Cost: ₹10.80/user/mo. Cheaper than paid user acquisition.
 *
 * Pro:  50 scans + 50 voice entries/day — ~1,500/month each.
 *       Marketed as "Unlimited AI". A real kirana store does 30-50 transactions
 *       per day total, so 50/day scans = "scan every bill". No real user hits this.
 *
 * Elite: 100 scans + 100 voice entries/day — ~3,000/month each.
 *        Marketed as "Truly Unlimited AI". For multi-shop power users.
 */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    dailyAiScans: 20,
    dailyVoiceEntries: 20,
    transactions: 0,    // unlimited
    products: 50,
    shops: 1,
    staffAccounts: 0,
  },
  pro: {
    dailyAiScans: 50,
    dailyVoiceEntries: 50,
    transactions: 0,
    products: 0,        // unlimited
    shops: 3,
    staffAccounts: 0,
  },
  elite: {
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
  used: number          // current period usage
  limit: number         // current period limit
  remaining: number
  resetAt: Date         // when the current period resets
  period: 'daily'
  upgradeMessage?: string
}

/**
 * Returns when the daily quota resets (next midnight UTC).
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
 * Gets the user's current monthly usage (for transactions/products only —
 * AI scans and voice entries now use daily in-memory limits).
 */
export async function getMonthlyUsage(userId: string, month?: string) {
  const m = month ?? (() => {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  })()
  const row = await db.usageTracking.findUnique({
    where: { userId_month: { userId, month: m } },
  })
  return {
    aiScans: row?.aiScans ?? 0,        // legacy — not used for daily limits
    voiceParses: row?.voiceParses ?? 0, // legacy — not used for daily limits
    transactions: row?.transactions ?? 0,
    products: row?.products ?? 0,
  }
}

/**
 * Checks whether the user can perform the given action.
 *
 * For AI scans + voice entries: checks daily in-memory rate limit (all tiers).
 * For transactions + products: checks monthly DB counter (Free only).
 *
 * Does NOT increment transactions/products — use `incrementUsage()` for those.
 * For AI scans + voice entries, the rate limiter auto-increments on check.
 */
export async function checkUsage(
  userId: string,
  type: UsageType,
): Promise<UsageCheckResult> {
  const plan = await getUserPlan(userId)
  const limits = PLAN_LIMITS[plan]

  // Non-AI types — only Free has limits, monthly DB counter
  if (type === 'transactions' || type === 'products') {
    const monthlyLimit = type === 'transactions' ? limits.transactions : limits.products
    if (monthlyLimit === 0) {
      return {
        allowed: true,
        plan,
        used: 0,
        limit: 0,
        remaining: Infinity,
        resetAt: nextDayReset(),
        period: 'daily',
      }
    }
    const usage = await getMonthlyUsage(userId)
    const used = usage[type]
    const allowed = used < monthlyLimit
    return {
      allowed,
      plan,
      used,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - used),
      resetAt: nextDayReset(),
      period: 'daily',
      upgradeMessage: !allowed
        ? `You've reached the ${plan === 'free' ? 'Free' : plan} plan limit for ${type}. Upgrade for more.`
        : undefined,
    }
  }

  // AI scans + voice entries — daily in-memory rate limiter
  const isScan = type === 'aiScans'
  const dailyLimit = isScan ? limits.dailyAiScans : limits.dailyVoiceEntries
  const rateKey = `${isScan ? 'scan' : 'voice'}:daily:user:${userId}`
  const rl = rateLimit(rateKey, { limit: dailyLimit, windowSec: 86400 })

  return {
    allowed: rl.success,
    plan,
    used: dailyLimit - rl.remaining,
    limit: dailyLimit,
    remaining: rl.remaining,
    resetAt: new Date(Date.now() + rl.retryAfterSec * 1000),
    period: 'daily',
    upgradeMessage: !rl.success
      ? `You've reached today's limit of ${dailyLimit} ${isScan ? 'AI scans' : 'voice entries'} on the ${plan === 'free' ? 'Free' : plan === 'pro' ? 'Pro' : 'Elite'} plan. This resets in ${Math.ceil(rl.retryAfterSec / 3600)} hours.${plan === 'free' ? ' Upgrade to Pro for 50/day (Unlimited).' : plan === 'pro' ? ' Upgrade to Elite for 100/day.' : ''}`
      : undefined,
  }
}

/**
 * Increments the monthly DB counter for transactions/products (Free only).
 *
 * For AI scans + voice entries: NO-OP — the daily rate limiter already counted
 * the request in `checkUsage()` (in-memory limiter is decrement-on-check).
 *
 * This is acceptable for AI features because:
 *   1. Limits are high enough that one failed scan is negligible
 *   2. In-memory limiter can't "undo" a decrement — not transactional
 *   3. If we didn't count on check, a user could burst 200 requests in 1 second
 *      (all passing the check) before any of them increment
 */
export async function incrementUsage(
  userId: string,
  type: UsageType,
): Promise<void> {
  // AI scans + voice entries: no-op (daily limiter already counted it)
  if (type === 'aiScans' || type === 'voiceParses') return

  // Transactions + products: increment monthly DB counter
  const now = new Date()
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
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
 * Kept for backward compatibility.
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
