/**
 * @jest-environment node
 *
 * What the backup WRITES must be what the restore can READ.
 *
 * WHY (audit 2026-08-14). Adding payments to the backup was only half a fix,
 * and the first attempt at the other half was wrong in a way that looked right.
 *
 * `/api/payments?all=1` returned raw Payment rows, which carry `partyId`. The
 * restore route resolves a payment's owner by `payment.partyName`, because it
 * rebuilds every party with a FRESH id — the old partyId in a backup file
 * points at nothing on the new device. Name is the only join key that survives
 * the round trip, which is why the transaction export carries `partyName` too.
 *
 * So the file would have contained all 25 payments, the Backup button would
 * have reported success, and on restore every single one would have been
 * skipped with "backup has no party name". Silent, deferred to the moment of
 * recovery, and dressed up to look fixed — the same failure as omitting them.
 *
 * These tests hold the two ends together: the shape the export produces, and
 * the field the restore reads.
 */

const mockPaymentFindMany = jest.fn()
const mockPaymentCount = jest.fn()

jest.mock('@/lib/db', () => ({
  db: {
    payment: {
      findMany: (...a: unknown[]) => mockPaymentFindMany(...a),
      count: (...a: unknown[]) => mockPaymentCount(...a),
    },
    party: { findFirst: jest.fn() },
  },
}))

const mockAuthContext = jest.fn()
jest.mock('@/lib/get-auth', () => ({
  getAuthContext: (...a: unknown[]) => mockAuthContext(...a),
  assertCanWrite: jest.fn(),
}))

jest.mock('@/lib/staff-permissions', () => ({ canAccessModule: () => true }))
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  rateLimitedResponse: jest.fn(),
}))

import { GET } from '@/app/api/payments/route'
import { billKey } from '@/lib/backup-keys'

const USER = 'user_1'

/** A Payment row as Prisma returns it with the party relation included. */
const ROW = {
  id: 'pay_1',
  userId: USER,
  partyId: 'party_old_id',
  amount: 500,
  date: new Date('2026-08-01'),
  mode: 'cash',
  type: 'received',
  notes: null,
  party: { name: 'Anita Devi' },
  allocations: [
    {
      amount: 500,
      transaction: { invoiceNo: 'INV-001', date: new Date('2026-07-20'), totalAmount: 1180 },
    },
  ],
}

function allReq() {
  return new Request('https://app.test/api/payments?all=1') as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthContext.mockResolvedValue({ userId: USER, error: null, role: 'owner', permissions: [] })
  mockPaymentFindMany.mockResolvedValue([ROW])
  mockPaymentCount.mockResolvedValue(1)
})

describe('the export carries what the restore joins on', () => {
  it('includes the party NAME on every payment', async () => {
    // The exact regression: a file full of payments that all skip on restore.
    const body = await (await GET(allReq())).json()
    expect(body.payments[0].partyName).toBe('Anita Devi')
  })

  it('asks the database for the name rather than hoping it is there', async () => {
    await GET(allReq())
    const [args] = mockPaymentFindMany.mock.calls[0] as any[]
    expect(args.include?.party?.select?.name).toBe(true)
  })

  it('keeps the amount and the direction', async () => {
    // 'received' and 'paid' move a balance opposite ways; losing the direction
    // is as damaging as losing the row.
    const body = await (await GET(allReq())).json()
    expect(body.payments[0]).toMatchObject({ amount: 500, type: 'received' })
  })

  it('does not leave a nested party object in the file', async () => {
    // Flattened to partyName. A nested relation object is dead weight in a file
    // a phone has to hold in memory, and the restore never looks at it.
    const body = await (await GET(allReq())).json()
    expect(body.payments[0].party).toBeUndefined()
  })
})

describe('the export carries WHICH BILLS each payment settled', () => {
  /*
   * due = totalAmount − paidAmount − Σ(allocations). Lose the allocations and
   * the party's overall balance is still right while every individual invoice
   * shows its money owing — the disagreement invoice-due.ts exists to prevent,
   * and the stale "Due" that invites collecting the same money twice.
   */
  it('includes the allocations', async () => {
    const body = await (await GET(allReq())).json()
    expect(body.payments[0].allocations).toHaveLength(1)
    expect(body.payments[0].allocations[0].amount).toBe(500)
  })

  it('asks the database for them, with the bill identity attached', async () => {
    await GET(allReq())
    const [args] = mockPaymentFindMany.mock.calls[0] as any[]
    const alloc = args.include?.allocations?.select
    expect(alloc?.amount).toBe(true)
    expect(alloc?.transaction?.select).toEqual(
      expect.objectContaining({ invoiceNo: true, date: true, totalAmount: true }),
    )
  })

  it('identifies the bill by a key, not by an id that will not exist', async () => {
    const body = await (await GET(allReq())).json()
    const key = body.payments[0].allocations[0].billKey
    // Must equal what the restore computes from the transaction it recreates.
    expect(key).toBe(billKey({ invoiceNo: 'INV-001', date: '2026-07-20', totalAmount: 1180 }))
    expect(key).not.toContain('party_old_id')
  })

  it('an unallocated payment exports an empty list, not a missing field', async () => {
    // A payment against no particular bill (a plain udhaar receipt) is normal.
    // `undefined` and `[]` must not be confused: one means "this file is too
    // old to say", the other means "this payment settled nothing specific".
    mockPaymentFindMany.mockResolvedValue([{ ...ROW, allocations: [] }])
    const body = await (await GET(allReq())).json()
    expect(body.payments[0].allocations).toEqual([])
  })
})

describe('the restore can resolve every payment the export wrote', () => {
  /*
   * The restore's own rule, reproduced: build a name -> id map from the parties
   * that were just recreated, refuse to guess when a name is ambiguous.
   */
  const resolve = (name: string | null | undefined, parties: { id: string; name: string }[]) => {
    const byName = new Map<string, string>()
    const ambiguous = new Set<string>()
    for (const p of parties) {
      if (byName.has(p.name)) ambiguous.add(p.name)
      byName.set(p.name, p.id)
    }
    if (!name || ambiguous.has(name)) return null
    return byName.get(name) || null
  }

  it('finds the party on the new device, where every id is different', async () => {
    const body = await (await GET(allReq())).json()
    // The party was recreated by the restore, so its id changed.
    const recreated = [{ id: 'party_brand_new_id', name: 'Anita Devi' }]

    expect(resolve(body.payments[0].partyName, recreated)).toBe('party_brand_new_id')
    // And proves the old id really is useless — this is why name is the key.
    expect(recreated.some(p => p.id === body.payments[0].partyId)).toBe(false)
  })

  it('would resolve nothing if the export dropped the name', async () => {
    // The control. Without this the test above passes on a broken export too.
    const recreated = [{ id: 'party_brand_new_id', name: 'Anita Devi' }]
    expect(resolve(undefined, recreated)).toBeNull()
  })
})

describe('a capped list is reported, not quietly shortened', () => {
  it('flags truncation so the export can refuse to write a partial file', async () => {
    mockPaymentCount.mockResolvedValue(12_000)
    const body = await (await GET(allReq())).json()
    expect(body.truncated).toBe(true)
    expect(body.total).toBe(12_000)
  })

  it('is not flagged when everything fits', async () => {
    const body = await (await GET(allReq())).json()
    expect(body.truncated).toBe(false)
  })
})

describe('one shop cannot back up another shop', () => {
  it('scopes the query by userId and excludes deleted rows', async () => {
    await GET(allReq())
    const [args] = mockPaymentFindMany.mock.calls[0] as any[]
    expect(args.where).toEqual(expect.objectContaining({ userId: USER, deletedAt: null }))
  })

  it('counts the same set it reads, so truncation is measured honestly', async () => {
    await GET(allReq())
    const [findArgs] = mockPaymentFindMany.mock.calls[0] as any[]
    const [countArgs] = mockPaymentCount.mock.calls[0] as any[]
    expect(countArgs.where).toEqual(findArgs.where)
  })
})
