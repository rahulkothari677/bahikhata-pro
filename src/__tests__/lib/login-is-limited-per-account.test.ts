/**
 * @jest-environment node
 *
 * One account cannot be guessed forever by rotating IP addresses.
 *
 * WHY (#17, audit 2026-08-13). Login was limited to 10 attempts per minute
 * PER IP ADDRESS and nothing else. That stops one machine guessing quickly. It
 * does nothing about the attack that actually matters — the same account
 * guessed from many addresses at once. Botnets and residential proxy pools make
 * that cheap, and every request looks like a first attempt, so the number of
 * guesses against one shopkeeper's account was limited only by how many
 * addresses an attacker could rent.
 *
 * A CORRECTION THIS TEST EXISTS TO PIN: an earlier report of mine said the
 * `User` table already had a `lockedUntil` column that nothing used, and that
 * enforcing it was the fix. That was wrong. `lockedUntil` is on `Setting` and
 * is the ACCOUNTING PERIOD lock — locking the books before a date. It has
 * nothing to do with login. There was no lockout infrastructure at all.
 *
 * WHY A RATE LIMIT AND NOT AN ACCOUNT LOCK: locking the account outright would
 * let anyone lock a shopkeeper out of their own books by deliberately failing
 * their login. A short rolling window means the worst an attacker achieves is
 * a wait, and only while they keep paying for it.
 */

const mockRateLimit = jest.fn()
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

const mockFindUnique = jest.fn()
jest.mock('@/lib/db', () => ({
  db: { user: { findUnique: (...a: unknown[]) => mockFindUnique(...a) } },
}))

jest.mock('bcryptjs', () => ({ compare: jest.fn(async () => true), hash: jest.fn() }))
jest.mock('@upstash/redis', () => ({ Redis: class {} }))

import { authOptions } from '@/lib/auth'

/** The credentials provider's authorize(), reached the way NextAuth reaches it. */
const authorize = (authOptions.providers[0] as any).options.authorize as (
  c: Record<string, string> | undefined,
  r: unknown,
) => Promise<unknown>

const req = (ip = '1.2.3.4') => ({ headers: { 'x-forwarded-for': ip } })
const creds = (email = 'shop@example.com') => ({ email, password: 'hunter2' })

/** Every key the code asked the limiter about, in order. */
const keys = () => mockRateLimit.mock.calls.map((c) => String(c[0]))
const accountKeys = () => keys().filter((k) => k.startsWith('login:acct:'))
const ipKeys = () => keys().filter((k) => k.startsWith('login:') && !k.startsWith('login:acct:'))

beforeEach(() => {
  jest.clearAllMocks()
  mockRateLimit.mockResolvedValue({ success: true, resetAt: 0, remaining: 9, retryAfterSec: 0 })
  mockFindUnique.mockResolvedValue({
    id: 'u1', email: 'shop@example.com', name: 'Shop', password: 'hashed',
    role: 'owner', ownerId: null, permissions: null, tokenVersion: 1,
  })
})

describe('the test reaches the real login code', () => {
  it('authorize exists and returns the user on a good password', async () => {
    // Without this, every assertion below could be passing on a no-op.
    const user = await authorize(creds(), req())
    expect(user).toMatchObject({ id: 'u1', email: 'shop@example.com' })
  })
})

describe('there is a limit per account, not only per address', () => {
  it('asks the limiter about the account as well as the address', async () => {
    await authorize(creds(), req())
    expect(ipKeys()).toHaveLength(1)
    expect(accountKeys()).toHaveLength(1)
  })

  it('uses the SAME account key from two different addresses', async () => {
    // This is the whole point. Rotating IPs must not reset the count.
    await authorize(creds(), req('1.1.1.1'))
    await authorize(creds(), req('9.9.9.9'))
    const [first, second] = accountKeys()
    expect(first).toBe(second)
    // ...while the address keys correctly differ.
    const [ipA, ipB] = ipKeys()
    expect(ipA).not.toBe(ipB)
  })

  it('treats the same email in different case as one account', async () => {
    await authorize(creds('Shop@Example.com '), req())
    await authorize(creds('shop@example.com'), req())
    const [a, b] = accountKeys()
    expect(a).toBe(b)
  })

  it('gives different accounts different budgets', async () => {
    await authorize(creds('one@example.com'), req())
    await authorize(creds('two@example.com'), req())
    const [a, b] = accountKeys()
    expect(a).not.toBe(b)
  })

  it('refuses the attempt once the account budget is spent', async () => {
    // Address limit fine, account limit exhausted.
    mockRateLimit.mockImplementation(async (key: string) =>
      String(key).startsWith('login:acct:')
        ? { success: false, resetAt: 0, remaining: 0, retryAfterSec: 900 }
        : { success: true, resetAt: 0, remaining: 9, retryAfterSec: 0 },
    )
    await expect(authorize(creds(), req())).rejects.toThrow(/too many/i)
  })

  it('does not even look the user up once the budget is spent', async () => {
    // A refused attempt must cost the attacker a lookup and a bcrypt compare
    // of nothing at all.
    mockRateLimit.mockResolvedValue({ success: false, resetAt: 0, remaining: 0, retryAfterSec: 900 })
    await expect(authorize(creds(), req())).rejects.toThrow()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('allows a reasonable number of tries before refusing', async () => {
    // A shopkeeper who has forgotten their password must get several goes.
    const [, opts] = mockRateLimit.mock.calls[0] ?? []
    await authorize(creds(), req())
    const accountCall = mockRateLimit.mock.calls.find((c) => String(c[0]).startsWith('login:acct:'))
    const o = accountCall?.[1] as { limit: number; windowSec: number }
    expect(o.limit).toBeGreaterThanOrEqual(5)
    expect(o.limit).toBeLessThanOrEqual(20)
    expect(o.windowSec).toBeGreaterThanOrEqual(300)
    void opts
  })
})

describe('the limit does not become an account-enumeration oracle', () => {
  it('says the same thing whichever limit was hit', async () => {
    // A distinct "this account is locked" would confirm the account exists,
    // handing an attacker the list of accounts worth attacking.
    mockRateLimit.mockImplementation(async (key: string) =>
      String(key).startsWith('login:acct:')
        ? { success: false, resetAt: 0, remaining: 0, retryAfterSec: 900 }
        : { success: true, resetAt: 0, remaining: 9, retryAfterSec: 0 },
    )
    const accountMsg = await authorize(creds(), req()).catch((e: Error) => e.message)

    jest.clearAllMocks()
    mockRateLimit.mockResolvedValue({ success: false, resetAt: 0, remaining: 0, retryAfterSec: 60 })
    const ipMsg = await authorize(creds(), req()).catch((e: Error) => e.message)

    expect(accountMsg).toBe(ipMsg)
  })

  it('the message still reaches the client through the catch block', async () => {
    // authorize() swallows every other error and returns null. The rate-limit
    // error is re-thrown only because it contains "Too many" — so the wording
    // and that filter are load-bearing together.
    mockRateLimit.mockResolvedValue({ success: false, resetAt: 0, remaining: 0, retryAfterSec: 60 })
    await expect(authorize(creds(), req())).rejects.toThrow(/Too many/)
  })
})

describe("shopkeepers' emails are not written into a third-party service", () => {
  it('hashes the email into the key instead of using it raw', async () => {
    await authorize(creds('someone@realshop.in'), req())
    const key = accountKeys()[0]
    expect(key).not.toContain('someone@realshop.in')
    expect(key).not.toContain('realshop')
    // sha256 hex, truncated — bounded length whatever is typed in.
    expect(key).toMatch(/^login:acct:[0-9a-f]{32}$/)
  })

  it('keeps the key bounded even for an absurdly long email', async () => {
    await authorize(creds('a'.repeat(5000) + '@x.com'), req())
    expect(accountKeys()[0]).toMatch(/^login:acct:[0-9a-f]{32}$/)
  })
})
