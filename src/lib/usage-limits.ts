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
  // 🔒 AUDIT FIX M12: Per-user monthly AI cost cap (in INR).
  // If a user's AI usage exceeds this in a month, further AI calls are blocked.
  // This protects your AI budget from a single user burning it all.
  monthlyAiCostCapInr: number
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
    monthlyAiCostCapInr: 15,    // ₹15/mo — ~120 scans at ₹0.12/scan
  },
  pro: {
    dailyAiScans: 50,
    dailyVoiceEntries: 50,
    transactions: 0,
    products: 0,        // unlimited
    shops: 3,
    staffAccounts: 0,
    monthlyAiCostCapInr: 75,    // ₹75/mo — ~600 scans (well under ₹299 revenue)
  },
  elite: {
    dailyAiScans: 100,
    dailyVoiceEntries: 100,
    transactions: 0,
    products: 0,
    shops: Infinity,
    staffAccounts: 5,
    monthlyAiCostCapInr: 150,   // ₹150/mo — ~1200 scans (well under ₹599 revenue)
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
 *
 * FOUNDER MODE: If the user's email is in the FOUNDERS list, they get
 * 'elite' plan (all features unlocked, highest limits). This lets the
 * founder test everything without paying or running scripts.
 */
// 🔒 AUDIT FIX L4: Founder emails are now read from the FOUNDERS env var
// (comma-separated). Was: hardcoded in source code — required a redeploy
// to change. Now: update the env var in Vercel and it takes effect immediately.
// Falls back to the original list if env var is not set (backward compat).
export const FOUNDERS = (process.env.FOUNDERS || 'rahulkothari677@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export async function getUserPlan(userId: string): Promise<Plan> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { plan: true, email: true },
  })

  // Founder bypass — always elite, regardless of DB plan field
  if (user?.email && FOUNDERS.includes(user.email.toLowerCase())) {
    return 'elite'
  }

  const plan = user?.plan as Plan
  if (plan === 'pro' || plan === 'elite') return plan
  return 'free'
}

/**
 * Returns true if the user is a founder (gets unlimited access).
 * Used to skip rate limiting entirely for founder accounts.
 */
export async function isFounder(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  })
  return !!user?.email && FOUNDERS.includes(user.email.toLowerCase())
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

  // FOUNDER BYPASS: Founders get unlimited access — skip all rate limiting.
  // Returns allowed=true with infinite remaining so the UI shows "∞" and
  // the user never hits a paywall. This is for testing/dev only.
  if (await isFounder(userId)) {
    return {
      allowed: true,
      plan: 'elite',
      used: 0,
      limit: Infinity,
      remaining: Infinity,
      resetAt: nextDayReset(),
      period: 'daily',
    }
  }

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

  // AI scans + voice entries — daily rate limiter
  // 🔒 AUDIT FIX H9: failClosed=true for AI limits (cost-bearing). If Redis
  // is configured but down, DENY the request instead of falling back to
  // in-memory (which would allow unlimited scans per instance = unlimited AI cost).
  const isScan = type === 'aiScans'
  const dailyLimit = isScan ? limits.dailyAiScans : limits.dailyVoiceEntries
  const rateKey = `${isScan ? 'scan' : 'voice'}:daily:user:${userId}`
  const rl = await rateLimit(rateKey, { limit: dailyLimit, windowSec: 86400 }, { failClosed: true })

  if (!rl.success) {
    return {
      allowed: false,
      plan,
      used: dailyLimit - rl.remaining,
      limit: dailyLimit,
      remaining: rl.remaining,
      resetAt: new Date(Date.now() + rl.retryAfterSec * 1000),
      period: 'daily',
      upgradeMessage: `You've reached today's limit of ${dailyLimit} ${isScan ? 'AI scans' : 'voice entries'} on the ${plan === 'free' ? 'Free' : plan === 'pro' ? 'Pro' : 'Elite'} plan. This resets in ${Math.ceil(rl.retryAfterSec / 3600)} hours.${plan === 'free' ? ' Upgrade to Pro for 50/day (Unlimited).' : plan === 'pro' ? ' Upgrade to Elite for 100/day.' : ''}`,
    }
  }

  // 🔒 AUDIT FIX M12: Check monthly AI cost cap.
  // Sum the user's AiUsageLog.costInr for this month. If over the cap, deny.
  // This protects your AI budget — even with daily limits, a user doing max
  // scans every day for a month could cost more than their subscription.
  try {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const costAgg = await db.aiUsageLog.aggregate({
      where: { userId, createdAt: { gte: monthStart } },
      _sum: { costInr: true },
    })
    const monthlyCost = costAgg._sum.costInr || 0
    const costCap = limits.monthlyAiCostCapInr

    if (monthlyCost >= costCap) {
      return {
        allowed: false,
        plan,
        used: dailyLimit - rl.remaining,
        limit: dailyLimit,
        remaining: 0,
        resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        period: 'daily' as const,
        upgradeMessage: `You've reached your monthly AI cost limit (₹${costCap.toFixed(0)}) on the ${plan === 'free' ? 'Free' : plan === 'pro' ? 'Pro' : 'Elite'} plan. This resets next month. Upgrade for a higher limit.`,
      }
    }
  } catch {
    // If cost check fails (DB error), don't block — let the daily limit handle it
  }

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

/**
 * 🔒 AUDIT FIX H2 (v2 audit): Check entity limits (total count, not daily).
 *
 * Products, shops, and staff have TOTAL count limits per plan (not daily).
 * The existing checkUsage() uses a monthly DB counter — wrong for these.
 * This function counts actual entities in the DB and compares to PLAN_LIMITS.
 *
 * Returns allowed=true if under the limit, allowed=false with upgrade message
 * if at/over the limit. Founders bypass all limits.
 *
 * @param userId - the user's ID
 * @param entityType - 'products' | 'shops' | 'staff'
 * @returns { allowed, plan, used, limit, remaining, upgradeMessage? }
 */
export async function checkEntityLimit(
  userId: string,
  entityType: 'products' | 'shops' | 'staff',
): Promise<{
  allowed: boolean
  plan: Plan
  used: number
  limit: number
  remaining: number
  upgradeMessage?: string
}> {
  const plan = await getUserPlan(userId)
  const limits = PLAN_LIMITS[plan]

  // FOUNDER BYPASS
  if (await isFounder(userId)) {
    return { allowed: true, plan: 'elite', used: 0, limit: Infinity, remaining: Infinity }
  }

  // Get the limit for this entity type
  const limit = entityType === 'products' ? limits.products
    : entityType === 'shops' ? limits.shops
    : limits.staffAccounts

  // 0 = unlimited (Pro/Elite products, Elite shops)
  if (limit === 0 || limit === Infinity) {
    return { allowed: true, plan, used: 0, limit: Infinity, remaining: Infinity }
  }

  // Count existing entities
  let used: number
  try {
    if (entityType === 'products') {
      used = await db.product.count({ where: { userId } })
    } else if (entityType === 'shops') {
      // Count shops owned by this user (excluding the default shop)
      used = await db.shop.count({ where: { userId } })
    } else {
      // Count staff accounts (users with role='staff' and ownerId=userId)
      used = await db.user.count({ where: { ownerId: userId, role: 'staff' } })
    }
  } catch {
    // If DB error, allow the request (better UX than blocking on transient error)
    return { allowed: true, plan, used: 0, limit, remaining: limit }
  }

  if (used >= limit) {
    const upgradePlan = plan === 'free' ? 'Pro' : 'Elite'
    return {
      allowed: false,
      plan,
      used,
      limit,
      remaining: 0,
      upgradeMessage: `You've reached the ${plan.toUpperCase()} plan limit of ${limit} ${entityType}. Upgrade to ${upgradePlan} for more.`,
    }
  }

  return { allowed: true, plan, used, limit, remaining: limit - used }
}
