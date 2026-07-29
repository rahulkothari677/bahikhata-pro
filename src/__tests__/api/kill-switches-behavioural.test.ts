/**
 * @jest-environment node
 *
 * BEHAVIOURAL tests that the admin panel's kill switches actually kill.
 *
 * WHY (audit 2026-07-28): they did not. Feature flags were read exclusively by
 * the BROWSER, from the public /api/feature-flags endpoint, and used only to
 * show or hide UI. Not one API route consulted them. `isFeatureEnabled` — the
 * server-side helper written for exactly this — had no callers at all.
 *
 * So switching "New Signups" off in the admin panel hid the signup button
 * while POST /api/auth/register carried on creating accounts for anything that
 * posted to it directly. The founder pulls the switch during an abuse wave,
 * watches the button vanish, and believes it worked.
 *
 * The AI routes are worse, because each call spends real money with a provider.
 * The switch exists so it can be pulled when costs spike; pulling it did
 * nothing.
 *
 * These tests invoke the real handlers with the flag off and assert the request
 * is refused BEFORE any work happens.
 */

const mockIsFeatureEnabled = jest.fn()
jest.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => mockIsFeatureEnabled(...a),
}))

const mockGetAuthUserIdWithModule = jest.fn()
jest.mock('@/lib/get-auth', () => ({
  getAuthUserIdWithModule: (...a: unknown[]) => mockGetAuthUserIdWithModule(...a),
  getAuthContext: jest.fn(),
  assertCanWrite: jest.fn(),
  getAuthContextForWrite: jest.fn(),
}))

// Any database call here is a failure: it means work began before the switch
// was consulted.
const dbTouched: string[] = []
jest.mock('@/lib/db', () => ({
  db: new Proxy({}, {
    get: (_t, model: string) => new Proxy({}, {
      get: (_t2, op: string) => (...__a: unknown[]) => {
        dbTouched.push(`${model}.${op}`)
        return Promise.resolve(null)
      },
    }),
  }),
  withConnectionRetry: (fn: () => Promise<unknown>) => fn(),
}))

jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue({ success: true }),
  getClientIP: () => '1.2.3.4',
  rateLimitedResponse: jest.fn(),
}))

import { NextRequest } from 'next/server'

const post = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  jest.clearAllMocks()
  dbTouched.length = 0
  mockGetAuthUserIdWithModule.mockResolvedValue({ userId: 'user-1', error: null })
})

describe('new_signups', () => {
  it('refuses to create an account when the switch is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const { POST } = await import('@/app/api/auth/register/route')

    const res = await POST(
      post('http://localhost/api/auth/register', {
        name: 'Test', email: 'blocked@example.com', password: 'LongEnough@123',
      }),
    )

    expect(res.status).toBe(503)
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('new_signups')
    // Refused before the user table was even consulted.
    expect(dbTouched).toEqual([])
  })

  it('checks the switch BEFORE the rate limiter, so it cannot be outlasted', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const rateLimit = (await import('@/lib/rate-limit')).rateLimit
    const { POST } = await import('@/app/api/auth/register/route')

    await POST(post('http://localhost/api/auth/register', {
      name: 'Test', email: 'x@example.com', password: 'LongEnough@123',
    }))

    expect(rateLimit).not.toHaveBeenCalled()
  })
})

describe('the AI routes cost money, so their switches must hold', () => {
  const cases: Array<[string, string, string]> = [
    ['ai_scanner', '@/app/api/scan-bill/route', 'http://localhost/api/scan-bill'],
    ['voice_entry', '@/app/api/voice-parse/route', 'http://localhost/api/voice-parse'],
  ]

  for (const [flag, mod, url] of cases) {
    it(`${flag}: returns 503 and spends nothing when switched off`, async () => {
      mockIsFeatureEnabled.mockResolvedValue(false)
      const { POST } = await import(mod)

      const res = await POST(post(url, { image: 'data:image/png;base64,AAAA', text: 'hello' }))

      expect(res.status).toBe(503)
      expect(mockIsFeatureEnabled).toHaveBeenCalledWith(flag)
      expect(dbTouched).toEqual([])

      const body = await res.json()
      // The message must tell the shopkeeper what to do instead, not just fail.
      expect(String(body.message).toLowerCase()).toContain('manually')
    })

    it(`${flag}: is checked only after authentication, so it leaks nothing`, async () => {
      mockGetAuthUserIdWithModule.mockResolvedValue({
        userId: null,
        error: (await import('next/server')).NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      })
      mockIsFeatureEnabled.mockResolvedValue(false)
      const { POST } = await import(mod)

      const res = await POST(post(url, {}))
      expect(res.status).toBe(401)
    })
  }
})
