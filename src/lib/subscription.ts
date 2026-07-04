import { db } from '@/lib/db'

/**
 * 🔒 AUDIT FIX V5 (Critical): Unified pricing across ALL systems.
 *
 * Was: 3 different pricing configs that contradicted each other:
 *   - subscription.ts: 4 tiers (Free/Pro ₹99/Business ₹299/Enterprise)
 *   - usage-limits.ts: 3 tiers (free/pro ₹299/elite ₹599)
 *   - create-order/route.ts: accepts 'pro'/'elite' at ₹299/₹599
 *   - Landing page: Pro ₹99, Business ₹299
 *
 * Now: SINGLE source of truth. This file defines the pricing, and both
 * usage-limits.ts and create-order/route.ts import from it.
 *
 * Final pricing (matches Razorpay):
 *   - Free: ₹0 — 20 AI scans/day, 20 voice/day, 50 products, 1 shop
 *   - Pro: ₹299/mo (₹2999/yr) — 50 AI scans/day, 50 voice/day, 3 shops
 *   - Elite: ₹599/mo (₹5999/yr) — 100 AI scans/day, 100 voice/day, unlimited shops, 5 staff
 */

export type Plan = 'free' | 'pro' | 'elite'

export interface PlanConfig {
  name: string
  price: number          // monthly price in INR
  yearlyPrice: number    // yearly price in INR (save ~16%)
  priceInPaise: {        // for Razorpay (₹1 = 100 paise)
    monthly: number
    yearly: number
  }
  color: string
  popular?: boolean
  limits: {
    transactions: number     // per month (0 = unlimited)
    products: number          // max products (0 = unlimited)
    dailyAiScans: number      // per day
    dailyVoiceEntries: number // per day
    monthlyAiCostCapInr: number // per-user monthly AI cost cap
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

/**
 * THE single source of truth for all pricing.
 * Used by: usage-limits.ts, create-order/route.ts, subscription/status/route.ts,
 * landing page, and PaywallModal.
 */
export const PRICING_CONFIG: Record<Plan, PlanConfig> = {
  free: {
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    priceInPaise: { monthly: 0, yearly: 0 },
    color: 'text-slate-600',
    limits: {
      transactions: 0,        // unlimited
      products: 50,
      dailyAiScans: 20,
      dailyVoiceEntries: 20,
      monthlyAiCostCapInr: 15,
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
  pro: {
    name: 'Pro',
    price: 299,
    yearlyPrice: 2999,
    priceInPaise: { monthly: 29900, yearly: 299900 },
    color: 'text-amber-600',
    popular: true,
    limits: {
      transactions: 0,
      products: 0,             // unlimited
      dailyAiScans: 50,
      dailyVoiceEntries: 50,
      monthlyAiCostCapInr: 75,
      shops: 3,
      staff: 0,
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
      staffAccess: false,
      prioritySupport: false,
    },
  },
  elite: {
    name: 'Elite',
    price: 599,
    yearlyPrice: 5999,
    priceInPaise: { monthly: 59900, yearly: 599900 },
    color: 'text-violet-600',
    limits: {
      transactions: 0,
      products: 0,
      dailyAiScans: 100,
      dailyVoiceEntries: 100,
      monthlyAiCostCapInr: 150,
      shops: Infinity,         // unlimited
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
}

// Legacy export for backward compatibility (code that imports PLANS)
export const PLANS = PRICING_CONFIG

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
  const plan = (user?.plan as Plan) || 'free'
  const planConfig = PRICING_CONFIG[plan] || PRICING_CONFIG.free
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

  const plan = (user?.plan as Plan) || 'free'
  const planConfig = PRICING_CONFIG[plan] || PRICING_CONFIG.free
  const usage = await getMonthlyUsage(userId)

  return {
    plan,
    planConfig,
    renewsAt: user?.renewsAt,
    trialEndsAt: user?.trialEndsAt,
    cancelled: !!user?.cancelledAt,
    usage: {
      transactions: { used: usage.transactions, limit: planConfig.limits.transactions },
      aiScans: { used: usage.aiScans, limit: planConfig.limits.dailyAiScans },
      voiceParses: { used: usage.voiceParses, limit: planConfig.limits.dailyVoiceEntries },
      products: { used: usage.products, limit: planConfig.limits.products },
    },
  }
}

/**
 * Response shape for limit-reached errors (HTTP 402).
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
