/**
 * @jest-environment node
 *
 * The node environment is required: next/server needs the Web Request and
 * Response globals, which jsdom does not provide.
 *
 * BEHAVIOURAL impersonation guardrail tests — these INVOKE the real route
 * handlers, rather than reading their source as text.
 *
 * WHY THIS FILE EXISTS ALONGSIDE impersonation-guardrails.test.ts:
 * that suite greps route files for the string `assertNotImpersonated`. It is
 * useful as a checklist, but it cannot tell whether the guard is actually
 * REACHED at runtime — a call placed after an early return, inside a branch
 * that never executes, or below the destructive work itself would still match.
 *
 * This repo has been burned by that exact distinction: 31 "behavioural tests"
 * once validated extracted helper files that nothing imported, while the
 * shipped inline copies had silently diverged.
 *
 * So this file mocks an impersonated session and calls the handlers.
 *
 * WHAT THIS FOUND (audit 2026-07-27): /api/staff POST, PATCH and DELETE had no
 * guard at all. A sub-account carries its own email and password and shares
 * the owner's data scope, so creating one while impersonating converts a
 * time-boxed, audited 5-minute support session into PERMANENT access under a
 * credential the admin chose — appearing as a staff account the shopkeeper
 * created themselves. That is the most valuable thing an attacker with a
 * support console could do, and nothing stopped it.
 */

const mockGetServerSession = jest.fn()

jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))

// The DB must never be reached by a correctly-guarded route. Any call here is
// itself a failure: it means the destructive work started before the check.
const dbTouched: string[] = []
const dbProxy: unknown = new Proxy(
  {},
  {
    get(_t, model: string) {
      return new Proxy(
        {},
        {
          get(_t2, op: string) {
            return (...__args: unknown[]) => {
              dbTouched.push(`${model}.${op}`)
              return Promise.resolve(null)
            }
          },
        },
      )
    },
  },
)
jest.mock('@/lib/db', () => ({ db: dbProxy }))

const OWNER_ID = 'usr_owner_1'

function impersonatedSession() {
  return {
    user: { id: OWNER_ID, role: 'owner', email: 'shop@test.local', isImpersonated: true },
  }
}

function normalOwnerSession() {
  return {
    user: { id: OWNER_ID, role: 'owner', email: 'shop@test.local', isImpersonated: false },
  }
}

async function callHandler(
  modulePath: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
) {
  jest.resetModules()
  const mod = await import(modulePath)
  const handler = (mod as Record<string, unknown>)[method] as
    | ((req: unknown) => Promise<Response>)
    | undefined
  if (!handler) throw new Error(`${modulePath} does not export ${method}`)

  const req = {
    method,
    url: 'http://localhost:3000/api/test?from=2026-07-01&to=2026-07-31',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body ?? {},
  }
  return handler(req)
}

describe('an impersonating admin cannot create or change sub-accounts', () => {
  beforeEach(() => {
    dbTouched.length = 0
    mockGetServerSession.mockResolvedValue(impersonatedSession())
  })

  it('refuses POST /api/staff — the permanent-backdoor path', async () => {
    // Without the guard this creates a login the admin controls, scoped to the
    // shopkeeper's books, outliving the 5-minute impersonation window.
    const res = await callHandler('@/app/api/staff/route', 'POST', {
      name: 'Backdoor',
      email: 'attacker@evil.test',
      password: 'hunter2hunter2',
      role: 'staff',
    })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(JSON.stringify(json)).toMatch(/impersonat/i)
  })

  it('refuses PATCH /api/staff — silently widening a sub-account is the same hole', async () => {
    const res = await callHandler('@/app/api/staff/route', 'PATCH', {
      id: 'staff_1',
      permissions: { all: true },
    })
    expect(res.status).toBe(403)
  })

  it('refuses DELETE /api/staff', async () => {
    const res = await callHandler('@/app/api/staff/route', 'DELETE', { id: 'staff_1' })
    expect(res.status).toBe(403)
  })

  it('refuses BEFORE touching the database', async () => {
    // A guard placed after the write is not a guard. If any query ran, the
    // check was in the wrong place.
    await callHandler('@/app/api/staff/route', 'POST', {
      email: 'x@y.test',
      password: 'longenough123',
    })
    expect(dbTouched).toEqual([])
  })
})

describe('an impersonating admin cannot export the invoice register', () => {
  beforeEach(() => {
    dbTouched.length = 0
    mockGetServerSession.mockResolvedValue(impersonatedSession())
  })

  it('refuses GET /api/gstr-export', async () => {
    // Dumps invoice numbers, party names, GSTINs and amounts — the
    // shopkeeper's records AND their customers', who are third parties to
    // EkBook. account/export and export/full were blocked; this was not,
    // because getAuthUserIdWithModule did not expose isImpersonated.
    const res = await callHandler('@/app/api/gstr-export/route', 'GET')
    expect(res.status).toBe(403)
    expect(dbTouched).toEqual([])
  })
})

describe('support can still do its job', () => {
  beforeEach(() => {
    dbTouched.length = 0
    mockGetServerSession.mockResolvedValue(impersonatedSession())
  })

  it('allows GET /api/staff — reading the account structure changes nothing', async () => {
    // Over-blocking is its own failure: if support cannot see the account,
    // impersonation is useless and someone will disable the guard entirely.
    const res = await callHandler('@/app/api/staff/route', 'GET')
    expect(res.status).not.toBe(403)
  })
})

describe('the real owner is never blocked', () => {
  beforeEach(() => {
    dbTouched.length = 0
    mockGetServerSession.mockResolvedValue(normalOwnerSession())
  })

  it('allows POST /api/staff for a genuine owner session', async () => {
    // The guard must key on isImpersonated, not on the route being sensitive.
    // Blocking the owner from managing their own staff would be a regression
    // that no amount of security justifies.
    const res = await callHandler('@/app/api/staff/route', 'POST', {
      email: 'realstaff@shop.test',
      password: 'longenough123',
    })
    expect(res.status).not.toBe(403)
  })

  it('allows GET /api/gstr-export for a genuine owner session', async () => {
    const res = await callHandler('@/app/api/gstr-export/route', 'GET')
    expect(res.status).not.toBe(403)
  })
})
