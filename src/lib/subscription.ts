import { db } from '@/lib/db'

/**
 * Subscription Plans — pricing tiers and limits.
 */

export interface PlanConfig {
  name: string
  price: number
  yearlyPrice: number
  color: string
  popular?: boolean
  limits: {
    transactions: number     // per month (0 = unlimited)
    products: number          // max products (0 = unlimited)
    aiScans: number           // per month (0 = unlimited)
    voiceParses: number       // per month (0 = unlimited)
    shops: number             // max shops
    staff: number             // max staff accounts
  }
  features: {
    aiScanner: boolean
    voiceEntry: boolean
    gstrExport: boolean
    whatsappSharing: boolean
    smartInsights: boolean
    recurringEntries: boolean
    advancedReports: boolean
    multiShop: boolean
    staffAccess: boolean
    prioritySupport: boolean
  }
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    color: 'text-slate-600',
    limits: {
      transactions: 50,      // 50 per month
      products: 50,           // 50 products max
      aiScans: 3,             // 3 total (not per month)
      voiceParses: 0,         // no voice on free
      shops: 1,
      staff: 0,
    },
    features: {
      aiScanner: true,        // 3 free scans to try
      voiceEntry: false,
      gstrExport: false,
      whatsappSharing: false,
      smartInsights: false,
      recurringEntries: false,
      advancedReports: false,
      multiShop: false,
      staffAccess: false,
      prioritySupport: false,
    },
  },
  pro: {
    name: 'Pro',
    price: 99,
    yearlyPrice: 999,
    color: 'text-amber-600',
    popular: true,
    limits: {
      transactions: 0,        // unlimited
      products: 0,            // unlimited
      aiScans: 100,           // 100 per month
      voiceParses: 100,       // 100 per month
      shops: 1,
      staff: 0,
    },
    features: {
      aiScanner: true,
      voiceEntry: true,
      gstrExport: true,
      whatsappSharing: true,
      smartInsights: true,
      recurringEntries: true,
      advancedReports: false,
      multiShop: false,
      staffAccess: false,
      prioritySupport: false,
    },
  },
  business: {
    name: 'Business',
    price: 299,
    yearlyPrice: 2999,
    color: 'text-violet-600',
    limits: {
      transactions: 0,        // unlimited
      products: 0,            // unlimited
      aiScans: 0,             // unlimited
      voiceParses: 0,         // unlimited
      shops: 3,
      staff: 5,
    },
    features: {
      aiScanner: true,
      voiceEntry: true,
      gstrExport: true,
      whatsappSharing: true,
      smartInsights: true,
      recurringEntries: true,
      advancedReports: true,
      multiShop: true,
      staffAccess: true,
      prioritySupport: true,
    },
  },
  enterprise: {
    name: 'Enterprise',
    price: 0,                 // custom pricing
    yearlyPrice: 0,
    color: 'text-blue-600',
    limits: {
      transactions: 0,
      products: 0,
      aiScans: 0,
      voiceParses: 0,
      shops: 0,               // unlimited
      staff: 0,               // unlimited
    },
    features: {
      aiScanner: true,
      voiceEntry: true,
      gstrExport: true,
      whatsappSharing: true,
      smartInsights: true,
      recurringEntries: true,
      advancedReports: true,
      multiShop: true,
      staffAccess: true,
      prioritySupport: true,
    },
  },
}

/**
 * Get the current month string (YYYY-MM format).
 */
export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Get or create usage tracking record for the current month.
 * Defensive — returns default zeros if table doesn't exist yet.
 */
export async function getMonthlyUsage(userId: string) {
  const month = getCurrentMonth()
  try {
    let usage = await db.usageTracking.findUnique({
      where: { userId_month: { userId, month } },
    })
    if (!usage) {
      usage = await db.usageTracking.create({
        data: { userId, month },
      })
    }
    return usage
  } catch {
    // Table doesn't exist yet — return defaults
    return {
      id: 'temp',
      userId,
      month,
      transactions: 0,
      aiScans: 0,
      voiceParses: 0,
      products: 0,
      updatedAt: new Date(),
    }
  }
}

/**
 * Increment usage counters (called after creating a transaction, AI scan, etc.)
 */
export async function incrementUsage(
  userId: string,
  field: 'transactions' | 'aiScans' | 'voiceParses' | 'products',
  count: number = 1,
) {
  const month = getCurrentMonth()
  await db.usageTracking.upsert({
    where: { userId_month: { userId, month } },
    create: { userId, month, [field]: count },
    update: { [field]: { increment: count } },
  })
}

/**
 * Check if user can perform an action based on their plan limits.
 * Returns { allowed: boolean, reason?: string, used: number, limit: number }
 */
export async function checkLimit(
  userId: string,
  field: 'transactions' | 'aiScans' | 'voiceParses' | 'products',
): Promise<{ allowed: boolean; reason?: string; used: number; limit: number }> {
  // Get user's plan
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  const plan = user?.plan || 'free'
  const planConfig = PLANS[plan] || PLANS.free

  // Get limit for this field
  const limit = planConfig.limits[field]

  // 0 = unlimited
  if (limit === 0) {
    const usage = await getMonthlyUsage(userId)
    return { allowed: true, used: usage[field], limit: 0 }
  }

  // Check current usage
  const usage = await getMonthlyUsage(userId)
  const used = usage[field]

  if (used >= limit) {
    return {
      allowed: false,
      reason: `You've reached your ${field} limit (${used}/${limit}) on the ${planConfig.name} plan. Upgrade to continue.`,
      used,
      limit,
    }
  }

  return { allowed: true, used, limit }
}

/**
 * Check if a specific feature is enabled for the user's plan.
 */
export async function hasFeature(
  userId: string,
  feature: keyof PlanConfig['features'],
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  const plan = user?.plan || 'free'
  const planConfig = PLANS[plan] || PLANS.free
  return planConfig.features[feature]
}

/**
 * Get the user's current plan + usage summary.
 */
export async function getSubscriptionStatus(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { plan: true, renewsAt: true, trialEndsAt: true, cancelledAt: true },
  })

  const plan = user?.plan || 'free'
  const planConfig = PLANS[plan] || PLANS.free
  const usage = await getMonthlyUsage(userId)

  return {
    plan,
    planConfig,
    renewsAt: user?.renewsAt,
    trialEndsAt: user?.trialEndsAt,
    cancelled: !!user?.cancelledAt,
    usage: {
      transactions: { used: usage.transactions, limit: planConfig.limits.transactions },
      aiScans: { used: usage.aiScans, limit: planConfig.limits.aiScans },
      voiceParses: { used: usage.voiceParses, limit: planConfig.limits.voiceParses },
      products: { used: usage.products, limit: planConfig.limits.products },
    },
  }
}

/**
 * Response shape for limit-reached errors (HTTP 402).
 * Frontend catches this and shows the PaywallModal.
 */
export const LIMIT_REACHED_CODE = 402

export function limitReachedResponse(field: string, used: number, limit: number) {
  const readableField: Record<string, string> = {
    transactions: 'transactions',
    aiScans: 'AI bill scans',
    voiceParses: 'voice entries',
    products: 'products',
  }
  const fieldName = readableField[field] || field
  return {
    status: LIMIT_REACHED_CODE,
    body: {
      error: 'limit_reached',
      field,
      used,
      limit,
      message: `You've used ${used}/${limit} ${fieldName} on the Free plan. Upgrade to Pro for unlimited access.`,
    },
  }
}
