/**
 * Tests for subscription.ts — pricing config consistency
 *
 * 🔒 AUDIT FIX V5: These tests verify that the pricing is consistent across
 * all systems (subscription.ts, usage-limits.ts, create-order/route.ts).
 * Was: 3 different pricing configs that contradicted each other.
 * Now: single source of truth (PRICING_CONFIG) verified by these tests.
 */
import { PRICING_CONFIG, type Plan } from '@/lib/subscription'

describe('subscription.ts — Pricing config consistency', () => {
  describe('PRICING_CONFIG', () => {
    it('has exactly 3 plans: free, pro, elite', () => {
      const plans = Object.keys(PRICING_CONFIG)
      expect(plans).toContain('free')
      expect(plans).toContain('pro')
      expect(plans).toContain('elite')
      expect(plans).toHaveLength(3)
    })

    it('free plan costs ₹0', () => {
      expect(PRICING_CONFIG.free.price).toBe(0)
      expect(PRICING_CONFIG.free.priceInPaise.monthly).toBe(0)
    })

    it('pro plan costs ₹299/month (matches Razorpay)', () => {
      expect(PRICING_CONFIG.pro.price).toBe(299)
      expect(PRICING_CONFIG.pro.priceInPaise.monthly).toBe(29900)
      expect(PRICING_CONFIG.pro.priceInPaise.yearly).toBe(299900)
    })

    it('elite plan costs ₹599/month (matches Razorpay)', () => {
      expect(PRICING_CONFIG.elite.price).toBe(599)
      expect(PRICING_CONFIG.elite.priceInPaise.monthly).toBe(59900)
      expect(PRICING_CONFIG.elite.priceInPaise.yearly).toBe(599900)
    })

    it('yearly price is a discount vs monthly × 12', () => {
      expect(PRICING_CONFIG.pro.yearlyPrice).toBeLessThan(PRICING_CONFIG.pro.price * 12)
      expect(PRICING_CONFIG.elite.yearlyPrice).toBeLessThan(PRICING_CONFIG.elite.price * 12)
      // Pro: ₹2999/yr vs ₹3588/yr (₹299×12) = 16% discount
      expect(PRICING_CONFIG.pro.yearlyPrice).toBe(2999)
      expect(PRICING_CONFIG.elite.yearlyPrice).toBe(5999)
    })
  })

  describe('Plan limits consistency', () => {
    it('free has lower AI limits than pro', () => {
      expect(PRICING_CONFIG.free.limits.dailyAiScans).toBeLessThan(PRICING_CONFIG.pro.limits.dailyAiScans)
      expect(PRICING_CONFIG.free.limits.dailyVoiceEntries).toBeLessThanOrEqual(PRICING_CONFIG.pro.limits.dailyVoiceEntries)
    })

    it('free has limited products, pro has unlimited (0)', () => {
      expect(PRICING_CONFIG.free.limits.products).toBe(50)
      expect(PRICING_CONFIG.pro.limits.products).toBe(0) // 0 = unlimited
    })

    it('pro has lower limits than elite', () => {
      expect(PRICING_CONFIG.pro.limits.dailyAiScans).toBeLessThan(PRICING_CONFIG.elite.limits.dailyAiScans)
      expect(PRICING_CONFIG.pro.limits.dailyVoiceEntries).toBeLessThanOrEqual(PRICING_CONFIG.elite.limits.dailyVoiceEntries)
    })

    it('free has 1 shop, pro has 3, elite has unlimited', () => {
      expect(PRICING_CONFIG.free.limits.shops).toBe(1)
      expect(PRICING_CONFIG.pro.limits.shops).toBe(3)
      expect(PRICING_CONFIG.elite.limits.shops).toBe(Infinity)
    })

    it('only elite has staff accounts', () => {
      expect(PRICING_CONFIG.free.limits.staff).toBe(0)
      expect(PRICING_CONFIG.pro.limits.staff).toBe(0)
      expect(PRICING_CONFIG.elite.limits.staff).toBe(5)
    })

    it('every plan has a monthly AI cost cap', () => {
      for (const plan of Object.keys(PRICING_CONFIG) as Plan[]) {
        expect(PRICING_CONFIG[plan].limits.monthlyAiCostCapInr).toBeGreaterThan(0)
      }
    })

    it('AI cost cap scales with plan price (pro > free, elite > pro)', () => {
      expect(PRICING_CONFIG.free.limits.monthlyAiCostCapInr).toBeLessThan(PRICING_CONFIG.pro.limits.monthlyAiCostCapInr)
      expect(PRICING_CONFIG.pro.limits.monthlyAiCostCapInr).toBeLessThan(PRICING_CONFIG.elite.limits.monthlyAiCostCapInr)
    })
  })

  describe('Features consistency', () => {
    it('free plan has all basic features enabled', () => {
      const free = PRICING_CONFIG.free.features
      expect(free.aiScanner).toBe(true)
      expect(free.voiceEntry).toBe(true)
      expect(free.gstrExport).toBe(true)
      expect(free.whatsappSharing).toBe(true)
    })

    it('elite plan has ALL features enabled', () => {
      const elite = PRICING_CONFIG.elite.features
      Object.values(elite).forEach(enabled => {
        expect(enabled).toBe(true)
      })
    })

    it('multiShop and staffAccess only on pro+ and elite respectively', () => {
      expect(PRICING_CONFIG.free.features.multiShop).toBe(false)
      expect(PRICING_CONFIG.pro.features.multiShop).toBe(true)
      expect(PRICING_CONFIG.free.features.staffAccess).toBe(false)
      expect(PRICING_CONFIG.pro.features.staffAccess).toBe(false)
      expect(PRICING_CONFIG.elite.features.staffAccess).toBe(true)
    })
  })

  describe('priceInPaise matches price', () => {
    it('monthly paise = price × 100', () => {
      for (const plan of ['free', 'pro', 'elite'] as Plan[]) {
        expect(PRICING_CONFIG[plan].priceInPaise.monthly).toBe(PRICING_CONFIG[plan].price * 100)
      }
    })

    it('yearly paise = yearlyPrice × 100', () => {
      for (const plan of ['free', 'pro', 'elite'] as Plan[]) {
        expect(PRICING_CONFIG[plan].priceInPaise.yearly).toBe(PRICING_CONFIG[plan].yearlyPrice * 100)
      }
    })
  })
})
