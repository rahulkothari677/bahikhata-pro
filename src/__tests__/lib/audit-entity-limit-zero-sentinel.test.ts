/**
 * @jest-environment node
 *
 * BEHAVIOURAL tests that plan entity limits mean what the pricing page says.
 *
 * WHY (audit 2026-08-03): `0` meant two opposite things in PRICING_CONFIG and
 * checkEntityLimit read both the same way.
 *
 *   products: 0        → UNLIMITED (Pro, Elite)
 *   shops:    Infinity → UNLIMITED (Elite)
 *   staff:    0        → NONE ALLOWED (Free and Pro — staff is Elite-only)
 *
 * An early `if (limit === 0 || limit === Infinity) return { allowed: true }`
 * turned "you get zero staff seats" into "you get unlimited staff seats".
 *
 * Found by probing the live deployment, not by reading the code: a Pro account
 * created three staff accounts with no error, while the fourth SHOP on that
 * same account was refused with a correct 402. Two entities, one function, one
 * route shape — the difference is what isolated the sentinel.
 *
 * The cost ran both ways. Staff seats are the Elite tier's headline feature
 * (₹599 vs ₹299), so Free and Pro users had it for free; and Elite
 * subscribers, who paid for it, were the only ones a cap ever applied to.
 *
 * It had also already been half-fixed once. A V17-Ext change made the staff
 * count include CA sub-accounts specifically to stop "a Pro owner (limit 0)"
 * creating unlimited CAs — but the early return sat above that code and made
 * it unreachable for Free and Pro, the exact plans it was written for. A fix
 * below a short-circuit is not a fix, and nothing failed to say so.
 *
 * These tests drive the real checkEntityLimit with a stubbed database.
 */

const mockUserFindUnique = jest.fn()
const mockSubFindFirst = jest.fn()
const mockUserCount = jest.fn()
const mockProductCount = jest.fn()
const mockShopCount = jest.fn()

jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      count: (...a: unknown[]) => mockUserCount(...a),
    },
    subscription: { findFirst: (...a: unknown[]) => mockSubFindFirst(...a) },
    product: { count: (...a: unknown[]) => mockProductCount(...a) },
    shop: { count: (...a: unknown[]) => mockShopCount(...a) },
    usageTracking: { findUnique: jest.fn() },
    aiUsageLog: { count: jest.fn() },
  },
}))

jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue({ success: true, remaining: 99, retryAfterSec: 0 }),
}))

import { checkEntityLimit } from '@/lib/usage-limits'

/** A non-founder user on the given plan, with a live subscription to match. */
function onPlan(plan: 'free' | 'pro' | 'elite') {
  mockUserFindUnique.mockResolvedValue({ plan, email: 'shopkeeper@example.com' })
  mockSubFindFirst.mockResolvedValue(
    plan === 'free'
      ? null
      : { id: 'sub_1', plan, status: 'active', endDate: new Date(Date.now() + 86400_000) },
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUserCount.mockResolvedValue(0)
  mockProductCount.mockResolvedValue(0)
  mockShopCount.mockResolvedValue(0)
})

describe('staff seats are Elite-only and the limit is enforced', () => {
  // The bug, stated as the thing a user could do.
  it.each(['free', 'pro'] as const)(
    'refuses the FIRST staff account on the %s plan, which grants zero',
    async (plan) => {
      onPlan(plan)
      mockUserCount.mockResolvedValue(0) // no sub-accounts yet

      const result = await checkEntityLimit('user_1', 'staff')

      expect(result.allowed).toBe(false)
      expect(result.limit).toBe(0)
      // The specific regression: an "unlimited" answer for a zero grant.
      expect(result.remaining).not.toBe(Infinity)
    },
  )

  it('does not consult the database when the grant is zero', async () => {
    // A limit of zero needs no count — and must not reach the catch that
    // returns allowed:true on a DB error, which would hand out a paid seat
    // every time the database hiccuped.
    onPlan('pro')
    await checkEntityLimit('user_1', 'staff')
    expect(mockUserCount).not.toHaveBeenCalled()
  })

  it('allows Elite up to 5 sub-accounts and refuses the 6th', async () => {
    onPlan('elite')

    mockUserCount.mockResolvedValue(4)
    expect((await checkEntityLimit('user_1', 'staff')).allowed).toBe(true)

    mockUserCount.mockResolvedValue(5)
    const atCap = await checkEntityLimit('user_1', 'staff')
    expect(atCap.allowed).toBe(false)
    expect(atCap.limit).toBe(5)
  })
})

describe('the 0-means-unlimited sentinel still applies where it should', () => {
  // Control. If these break, the fix went too far and started charging for
  // things the plans give away.
  it('leaves Pro products unlimited (products: 0 DOES mean unlimited)', async () => {
    onPlan('pro')
    mockProductCount.mockResolvedValue(10_000)
    const result = await checkEntityLimit('user_1', 'products')
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(Infinity)
  })

  it('still caps Free products at 50', async () => {
    onPlan('free')
    mockProductCount.mockResolvedValue(50)
    expect((await checkEntityLimit('user_1', 'products')).allowed).toBe(false)
  })

  it('still caps Pro shops at 3 — the control that exposed the staff bug', async () => {
    onPlan('pro')
    mockShopCount.mockResolvedValue(3)
    const result = await checkEntityLimit('user_1', 'shops')
    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(3)
  })

  it('leaves Elite shops unlimited', async () => {
    onPlan('elite')
    mockShopCount.mockResolvedValue(999)
    expect((await checkEntityLimit('user_1', 'shops')).allowed).toBe(true)
  })
})

describe('the upgrade prompt names a plan that actually sells the thing', () => {
  it('does not tell a Free user to buy Pro for staff — Pro also grants zero', async () => {
    onPlan('free')
    const msg = (await checkEntityLimit('user_1', 'staff')).upgradeMessage || ''
    expect(msg).toMatch(/Elite/)
    expect(msg).not.toMatch(/Upgrade to Pro/)
  })

  it('points a Pro user at Elite for staff', async () => {
    onPlan('pro')
    expect((await checkEntityLimit('user_1', 'staff')).upgradeMessage).toMatch(/Elite/)
  })

  it('offers no upsell to an Elite user already at the cap', async () => {
    onPlan('elite')
    mockUserCount.mockResolvedValue(5)
    const msg = (await checkEntityLimit('user_1', 'staff')).upgradeMessage || ''
    expect(msg).not.toMatch(/Upgrade to/)
  })

  it('points a Free user at Pro for products, where Pro genuinely is the answer', async () => {
    onPlan('free')
    mockProductCount.mockResolvedValue(50)
    expect((await checkEntityLimit('user_1', 'products')).upgradeMessage).toMatch(/Pro/)
  })
})

describe('founders still bypass everything', () => {
  it('grants a founder unlimited staff regardless of plan', async () => {
    mockUserFindUnique.mockResolvedValue({ plan: 'free', email: 'rahulkothari677@gmail.com' })
    const result = await checkEntityLimit('user_1', 'staff')
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(Infinity)
  })
})
