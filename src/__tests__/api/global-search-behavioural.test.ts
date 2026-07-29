/**
 * @jest-environment node
 *
 * BEHAVIOURAL tests for /api/search — these INVOKE the real route handler.
 *
 * WHY THIS FILE EXISTS (audit 2026-07-28):
 * GlobalSearch used to fetch `/api/transactions?limit=200` and filter the
 * results in the browser with `.includes()`. It therefore only ever searched
 * the 200 most recent transactions. A shop writing 20 bills a day passes that
 * in under two weeks, and from then on searching an older invoice number
 * returned "No results for ..." — which a shopkeeper reads as "that bill is
 * gone", not "I only looked at the recent ones".
 *
 * The bug got worse the more the shop sold. It was verified against a seeded
 * 250-transaction shop before the fix: the old path could not see INV-0001 at
 * all (`couldFind: false`), while the new endpoint returns it.
 *
 * These assertions are about BEHAVIOUR, not source text. This repo has been
 * burned repeatedly by tests that read a file as a string and assert its
 * contents — most recently sentry.client.config.ts, which such a test declared
 * correct for months while the file never executed at all.
 */

const mockGetAuthContext = jest.fn()

jest.mock('@/lib/get-auth', () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
}))

type Call = { model: string; op: string; args: any }
const calls: Call[] = []
let failNextQuery = false

jest.mock('@/lib/db', () => {
  const handler = {
    get(_t: unknown, model: string) {
      return new Proxy(
        {},
        {
          get(_t2: unknown, op: string) {
            return (args: any) => {
              calls.push({ model, op, args })
              if (failNextQuery) return Promise.reject(new Error('simulated database outage'))
              return Promise.resolve([])
            }
          },
        },
      )
    },
  }
  return {
    db: new Proxy({}, handler),
    // Pass-through: the real wrapper retries Neon cold starts, which is not
    // what these tests are about.
    withConnectionRetry: (fn: () => Promise<unknown>) => fn(),
  }
})

import { GET } from '@/app/api/search/route'
import { NextRequest } from 'next/server'

const OWNER = {
  userId: 'user-1',
  actingUserId: 'user-1',
  role: 'owner',
  permissions: null,
  isImpersonated: false,
}

const req = (q: string) => new NextRequest(`http://localhost:3000/api/search?q=${encodeURIComponent(q)}`)

const findCall = (model: string) => calls.find(c => c.model === model && c.op === 'findMany')

beforeEach(() => {
  calls.length = 0
  failNextQuery = false
  mockGetAuthContext.mockResolvedValue(OWNER)
})

describe('search happens in the database, not over a fetched page', () => {
  it('queries all three tables, scoped to the signed-in user', async () => {
    await GET(req('sharma'))

    for (const model of ['product', 'party', 'transaction']) {
      const call = findCall(model)
      // Named per model so a failure says WHICH table stopped being searched.
      expect({ model, searchedInSql: !!call }).toEqual({ model, searchedInSql: true })
      expect(call!.args.where.userId).toBe('user-1')
    }
  })

  it('does NOT cap the rows it searches — only the rows it returns', async () => {
    // THE regression. The old code searched a 200-row window; the fix must
    // search everything and cap only the output. If `take` ever grows into
    // something that looks like a search window again, this fails.
    await GET(req('INV-0001'))

    const txn = findCall('transaction')!
    expect(txn.args.take).toBeLessThanOrEqual(10)
    expect(txn.args.where.OR).toEqual(
      expect.arrayContaining([expect.objectContaining({ invoiceNo: expect.anything() })]),
    )
    // No date floor, no "recent only" filter — an invoice from three years ago
    // must be reachable.
    expect(txn.args.where.date).toBeUndefined()
  })

  it('excludes voided bills from live results', async () => {
    await GET(req('sharma'))
    expect(findCall('transaction')!.args.where.deletedAt).toBeNull()
    expect(findCall('party')!.args.where.deletedAt).toBeNull()
  })

  it('searches invoice number, notes, payee and party name', async () => {
    await GET(req('sharma'))
    const keys = findCall('transaction')!.args.where.OR.flatMap((c: object) => Object.keys(c))
    expect(keys).toEqual(expect.arrayContaining(['invoiceNo', 'notes', 'payeeName', 'party']))
  })
})

describe('staff permissions are enforced on the server', () => {
  // GlobalSearch is a shortcut into modules a staff member may be blocked from
  // opening. If the server does not gate it, the search box becomes a way to
  // read data the UI hides.
  it('a staff member without Purchases/Sales gets no transactions, and the table is never queried', async () => {
    mockGetAuthContext.mockResolvedValue({
      ...OWNER,
      role: 'staff',
      permissions: { dashboard: true, sales: false, purchases: false, inventory: true, scanner: false, reports: false, incomeExpense: false, parties: false, settings: false },
    })

    const res = await GET(req('sharma'))
    const body = await res.json()

    expect(body.transactions).toEqual([])
    expect(body.parties).toEqual([])
    expect({ blockedModuleHitDb: !!findCall('transaction') }).toEqual({ blockedModuleHitDb: false })
    expect({ blockedModuleHitDb: !!findCall('party') }).toEqual({ blockedModuleHitDb: false })
    // Still allowed to search stock.
    expect(findCall('product')).toBeTruthy()
  })

  it('rejects an unauthenticated caller', async () => {
    const { NextResponse } = await import('next/server')
    mockGetAuthContext.mockResolvedValue({
      userId: null, actingUserId: null, role: 'owner', permissions: null, isImpersonated: false,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const res = await GET(req('sharma'))
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })
})

describe('the empty state tells the truth', () => {
  it('a database failure returns 503, NOT an empty result set', async () => {
    // This is the whole point. Returning `{ transactions: [] }` on an outage
    // renders as "No results for INV-0001" — indistinguishable from the bill
    // not existing. A shopkeeper would conclude their record was lost.
    failNextQuery = true

    const res = await GET(req('INV-0001'))
    expect(res.status).toBe(503)

    const body = await res.json()
    expect(body.transactions).toBeUndefined()
  })

  it('a one-character query is refused without touching the database', async () => {
    const res = await GET(req('a'))
    const body = await res.json()

    expect(body.tooShort).toBe(true)
    // A single character matches everything — it must never reach Postgres.
    expect(calls.map(c => `${c.model}.${c.op}`)).toEqual([])
  })

  it('trims whitespace before deciding the query is too short', async () => {
    const body = await (await GET(req('   '))).json()
    expect(body.tooShort).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('bounds an absurdly long query instead of shipping it to Postgres', async () => {
    await GET(req('x'.repeat(5000)))
    const term = findCall('product')!.args.where.OR[0].name.contains
    expect(term.length).toBeLessThanOrEqual(100)
  })
})
