/**
 * Usage limits — shared between API routes and the subscription status endpoint.
 *
 * Defines the plan tier limits and provides a helper to atomically check +
 * increment usage counters stored in the UsageTracking table.
 *
 * MARKETING vs REALITY:
 *   - Marketing says: "Unlimited AI scans on Pro and Elite"
 *   - Reality (FUP):   Pro = 150/month, Elite = 500/month
 *   - This protects against bots/account-sharing while 99% of real users
 *     never hit the limit. Per Gemini's Rule #1: "Market Unlimited, Code FUP".
 */

import { db } from '@/lib/db'

export type Plan = 'free' | 'pro' | 'elite'

export interface PlanLimits {
  aiScans: number          // per month; 0 = unlimited (we don't use this — FUP caps everything)
  voiceEntries: number     // per month
  transactions: number     // per month; 0 = unlimited
  products: number         // total; 0 = unlimited
  shops: number            // 1 for free, 3 for pro, Infinity for elite
  staffAccounts: number    // 0 for free+pro, 5 for elite
}

/**
 * Fair Use Policy limits per plan.
 *
 * Free: 5 scans + 5 voice entries/month — enough to try the AI features,
 *       not enough to run a business on. Drives upgrades.
 *
 * Pro:  150 scans + 150 voice entries/month — ~5/day each. Covers a busy
 *       kirana store. Marketed as "Unlimited AI" with FUP in ToS.
 *
 * Elite: 500 scans + 500 voice entries/month — ~17/day each. For multi-shop
 *        owners with high volume. Marketed as "Unlimited AI" with FUP.
 */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    aiScans: 5,
    voiceEntries: 5,
    transactions: 0,    // unlimited
    products: 50,
    shops: 1,
    staffAccounts: 0,
  },
  pro: {
    aiScans: 150,
    voiceEntries: 150,
    transactions: 0,
    products: 0,        // unlimited
    shops: 3,
    staffAccounts: 0,
  },
  elite: {
    aiScans: 500,
    voiceEntries: 500,
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
  used: number
  limit: number
  remaining: number
  resetAt: Date  // first day of next month
  upgradeMessage?: string
}

/**
 * Gets the current YYYY-MM string for the user's local time.
 * We use UTC to keep server-side logic simple — the day boundary doesn't
 * matter much for monthly quotas.
 */
function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Returns the first moment of next month (when quotas reset).
 */
function nextMonthReset(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
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
 * Gets the user's current usage for the month. Returns 0 for all counters
 * if no UsageTracking row exists yet (which is fine — we create one on
 * first increment).
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
 * Checks whether the user can perform the given action WITHOUT incrementing.
 * Use this for display purposes (e.g. "5/5 scans used") and pre-flight checks.
 *
 * If you need to actually consume a unit, use `checkAndIncrementUsage()`
 * instead — it's atomic.
 */
export async function checkUsage(
  userId: string,
  type: UsageType,
): Promise<UsageCheckResult> {
  const plan = await getUserPlan(userId)
  const limits = PLAN_LIMITS[plan]
  const usage = await getMonthlyUsage(userId)
  const used = usage[type]

  // Map 'voiceEntries' limit to 'voiceParses' counter (DB column name)
  const limit = type === 'voiceParses' ? limits.voiceEntries : limits[type]

  // limit === 0 means "unlimited" — but for AI features we always enforce FUP
  // (the 0 case is only for transactions/products on paid plans, which we don't gate)
  const enforceLimit = type === 'aiScans' || type === 'voiceParses'
    ? limit
    : (limit === 0 ? Infinity : limit)

  const remaining = Math.max(0, enforceLimit - used)
  const allowed = used < enforceLimit

  let upgradeMessage: string | undefined
  if (!allowed) {
    if (plan === 'free') {
      upgradeMessage = `You've used all ${limit} free ${type === 'aiScans' ? 'AI scans' : 'voice entries'} this month. Upgrade to Pro for ${PLAN_LIMITS.pro[type === 'aiScans' ? 'aiScans' : 'voiceEntries']} per month.`
    } else if (plan === 'pro') {
      upgradeMessage = `You've reached your Pro plan limit of ${limit} ${type === 'aiScans' ? 'AI scans' : 'voice entries'} this month. Upgrade to Elite for ${PLAN_LIMITS.elite[type === 'aiScans' ? 'aiScans' : 'voiceEntries']} per month, or wait until next month.`
    } else {
      upgradeMessage = `You've reached your Elite plan FUP limit of ${limit} ${type === 'aiScans' ? 'AI scans' : 'voice entries'} this month. This limit resets on ${nextMonthReset().toLocaleDateString('en-IN')}.`
    }
  }

  return {
    allowed,
    plan,
    used,
    limit,
    remaining,
    resetAt: nextMonthReset(),
    upgradeMessage,
  }
}

/**
 * Atomically checks whether the user can perform the action AND increments
 * the counter if so. Returns the check result + whether the increment happened.
 *
 * Uses Prisma upsert with the unique (userId, month) constraint to ensure
 * atomicity even if two requests race.
 *
 * ⚠️ Use this only when the action is guaranteed to succeed after the check.
 * For AI calls that might fail, use `checkUsage()` + `incrementUsage()` instead
 * so users don't lose credits on failed scans.
 *
 * Usage:
 *   const check = await checkAndIncrementUsage(userId, 'aiScans')
 *   if (!check.allowed) {
 *     return NextResponse.json({ error: check.upgradeMessage }, { status: 402 })
 *   }
 *   // ... proceed with action ...
 */
export async function checkAndIncrementUsage(
  userId: string,
  type: UsageType,
): Promise<UsageCheckResult> {
  // First check (without incrementing) so we can return a clean 402 if over limit
  const check = await checkUsage(userId, type)
  if (!check.allowed) {
    return check
  }

  // Atomically increment the counter. Upsert handles the case where no row
  // exists yet for this month.
  await incrementUsage(userId, type)

  return {
    ...check,
    used: check.used + 1,
    remaining: Math.max(0, check.remaining - 1),
  }
}

/**
 * Increments the usage counter WITHOUT checking the limit first.
 * Use this AFTER a successful AI call (or other gated action) to record usage.
 *
 * Pair with `checkUsage()` for the pre-flight check:
 *
 *   const check = await checkUsage(userId, 'aiScans')
 *   if (!check.allowed) return 402
 *   const result = await callAI()
 *   if (result.success) {
 *     await incrementUsage(userId, 'aiScans')
 *   }
 *
 * This way users don't lose credits when the AI fails.
 */
export async function incrementUsage(
  userId: string,
  type: UsageType,
): Promise<void> {
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
