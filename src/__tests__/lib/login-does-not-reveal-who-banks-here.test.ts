/**
 * @jest-environment node
 *
 * Login must not tell an attacker which emails have accounts.
 *
 * WHY (#28, audit 2026-08-13). `authorize()` returned null the instant no user
 * matched, and ran a full bcrypt comparison when one did. bcrypt at cost 12
 * takes roughly 240ms ON PURPOSE — so "no such account" answered in a few
 * milliseconds while "wrong password" took a quarter of a second, and that gap
 * reads straight off the browser's network tab. No tools required.
 *
 * On its own that is only a leak. Combined with any breached password dump it
 * tells an attacker exactly which shopkeepers are worth spending guesses on —
 * and #17's per-account limit is what makes each of those guesses expensive.
 * Removing the list is worth more than rate-limiting the guessing.
 *
 * THE FIX HAD TO BE MEASURED, NOT ASSUMED, which is why these tests count the
 * bcrypt calls rather than reading the source. A comparison that is skipped,
 * short-circuited, or optimised away leaves the timing gap exactly as it was
 * while the code still *looks* right.
 */

const mockRateLimit = jest.fn()
jest.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => mockRateLimit(...a) }))

const mockFindUnique = jest.fn()
jest.mock('@/lib/db', () => ({
  db: { user: { findUnique: (...a: unknown[]) => mockFindUnique(...a) } },
}))

const mockCompare = jest.fn()
jest.mock('bcryptjs', () => ({
  compare: (...a: unknown[]) => mockCompare(...a),
  hash: jest.fn(),
}))
jest.mock('@upstash/redis', () => ({ Redis: class {} }))

import { authOptions } from '@/lib/auth'

const authorize = (authOptions.providers[0] as any).options.authorize as (
  c: Record<string, string> | undefined,
  r: unknown,
) => Promise<unknown>

const req = () => ({ headers: { 'x-forwarded-for': '1.2.3.4' } })
const creds = (email: string) => ({ email, password: 'hunter2' })

const REAL_USER = {
  id: 'u1', email: 'real@example.com', name: 'Shop', password: '$2b$12$realhashforarealuser',
  role: 'owner', ownerId: null, permissions: null, tokenVersion: 1,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRateLimit.mockResolvedValue({ success: true, resetAt: 0, remaining: 9, retryAfterSec: 0 })
  mockCompare.mockResolvedValue(false)
})

describe('both answers cost the same', () => {
  it('does a bcrypt comparison even when the account does NOT exist', async () => {
    // The whole fix. Skipping the comparison is what made the two paths
    // distinguishable, and it is invisible in a response body.
    mockFindUnique.mockResolvedValue(null)
    await authorize(creds('nobody@example.com'), req())
    expect(mockCompare).toHaveBeenCalledTimes(1)
  })

  it('does the same number of comparisons as a real account', async () => {
    mockFindUnique.mockResolvedValue(null)
    await authorize(creds('nobody@example.com'), req())
    const missing = mockCompare.mock.calls.length

    jest.clearAllMocks()
    mockRateLimit.mockResolvedValue({ success: true, resetAt: 0, remaining: 9, retryAfterSec: 0 })
    mockCompare.mockResolvedValue(false)
    mockFindUnique.mockResolvedValue(REAL_USER)
    await authorize(creds('real@example.com'), req())

    expect(mockCompare.mock.calls.length).toBe(missing)
  })

  it('compares against a real cost-12 hash, not an empty string', async () => {
    /*
     * A dummy that is not a valid bcrypt hash returns immediately, which
     * reintroduces the exact gap this exists to close — while the code still
     * reads as though it were fixed.
     */
    mockFindUnique.mockResolvedValue(null)
    await authorize(creds('nobody@example.com'), req())
    const [, hash] = mockCompare.mock.calls[0] as [string, string]
    expect(hash).toMatch(/^\$2[aby]\$12\$/)
    expect(hash.length).toBeGreaterThanOrEqual(59)
  })

  it('still refuses the login, whatever the dummy comparison returns', async () => {
    // The equaliser must never become a way in. Even if bcrypt somehow said
    // true, there is no user to return.
    mockFindUnique.mockResolvedValue(null)
    mockCompare.mockResolvedValue(true)
    await expect(authorize(creds('nobody@example.com'), req())).resolves.toBeNull()
  })
})

describe('the answers are otherwise identical', () => {
  it('returns null for an unknown email', async () => {
    mockFindUnique.mockResolvedValue(null)
    await expect(authorize(creds('nobody@example.com'), req())).resolves.toBeNull()
  })

  it('returns null for a known email with the wrong password', async () => {
    mockFindUnique.mockResolvedValue(REAL_USER)
    mockCompare.mockResolvedValue(false)
    await expect(authorize(creds('real@example.com'), req())).resolves.toBeNull()
  })
})

describe('a correct password still logs in', () => {
  // The feature has to survive the fix. A guard proving only the new
  // restriction would pass happily on a login that refuses everyone.
  it('returns the user', async () => {
    mockFindUnique.mockResolvedValue(REAL_USER)
    mockCompare.mockResolvedValue(true)
    await expect(authorize(creds('real@example.com'), req())).resolves.toMatchObject({
      id: 'u1', email: 'real@example.com',
    })
  })

  it('compares against that user\'s own stored hash', async () => {
    mockFindUnique.mockResolvedValue(REAL_USER)
    mockCompare.mockResolvedValue(true)
    await authorize(creds('real@example.com'), req())
    expect(mockCompare).toHaveBeenCalledWith('hunter2', REAL_USER.password)
  })
})
