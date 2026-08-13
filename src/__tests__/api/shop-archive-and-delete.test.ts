/**
 * @jest-environment node
 *
 * A shop can be put away. A shop with books can never be deleted.
 *
 * WHY (#21, audit 2026-08-13). A shop created by mistake, or one that has
 * closed, had no exit. It sat in the picker forever, and the only way out on
 * offer was deleting the entire account.
 *
 * The two actions answer two different situations, and conflating them is the
 * dangerous outcome this file exists to prevent:
 *
 *   ARCHIVE  the shop traded. Bills, customers, stock. Those are books, and
 *            books are kept — GST and income-tax retention are not ours to
 *            waive. Hidden from the picker, nothing else changed, reversible.
 *
 *   DELETE   the shop holds nothing at all. The typo case. Nothing to keep and
 *            nothing to lose.
 *
 * No confirmation dialog can make deleting a traded shop safe: the shopkeeper
 * cannot know what they are agreeing to, so the server refuses instead.
 */

const counts = { product: 0, party: 0, transaction: 0, document: 0 }
const mockShopFindFirst = jest.fn()
const mockShopCount = jest.fn()
const mockShopDeleteMany = jest.fn()
const mockShopUpdateMany = jest.fn()

jest.mock('@/lib/db', () => ({
  db: {
    shop: {
      findFirst: (...a: unknown[]) => mockShopFindFirst(...a),
      count: (...a: unknown[]) => mockShopCount(...a),
      deleteMany: (...a: unknown[]) => mockShopDeleteMany(...a),
      updateMany: (...a: unknown[]) => mockShopUpdateMany(...a),
      findMany: jest.fn(async () => []),
      create: jest.fn(),
    },
    product: { count: jest.fn(async () => counts.product) },
    party: { count: jest.fn(async () => counts.party) },
    transaction: { count: jest.fn(async () => counts.transaction) },
    document: { count: jest.fn(async () => counts.document) },
    setting: { findUnique: jest.fn() },
  },
}))

const mockAuth = jest.fn()
jest.mock('@/lib/get-auth', () => ({ getAuthUserIdOwnerOnly: (...a: unknown[]) => mockAuth(...a) }))
jest.mock('@/lib/usage-limits', () => ({ checkEntityLimit: jest.fn() }))

import { DELETE } from '@/app/api/shops/route'

const USER = 'user_1'
const req = (qs: string) => new Request(`https://app.test/api/shops?${qs}`, { method: 'DELETE' }) as never

beforeEach(() => {
  jest.clearAllMocks()
  counts.product = 0; counts.party = 0; counts.transaction = 0; counts.document = 0
  mockAuth.mockResolvedValue({ userId: USER })
  mockShopFindFirst.mockResolvedValue({ id: 'shop_2', userId: USER, name: 'Second Shop', archivedAt: null })
  mockShopCount.mockResolvedValue(2)          // two active shops, so removal is allowed
  mockShopDeleteMany.mockResolvedValue({ count: 1 })
  mockShopUpdateMany.mockResolvedValue({ count: 1 })
})

describe('an empty shop can simply go', () => {
  it('deletes it when nothing was ever recorded against it', async () => {
    const res = await DELETE(req('id=shop_2'))
    expect(res.status).toBe(200)
    expect(mockShopDeleteMany).toHaveBeenCalled()
  })

  it('scopes the delete by userId, not by id alone', async () => {
    // `delete({ where: { id } })` matches the primary key and ignores
    // ownership — one shopkeeper could remove another's shop by guessing.
    await DELETE(req('id=shop_2'))
    const [args] = mockShopDeleteMany.mock.calls[0] as [{ where: Record<string, unknown> }]
    expect(args.where).toEqual(expect.objectContaining({ userId: USER }))
  })

  it('404s for a shop the caller does not own, and deletes nothing', async () => {
    mockShopFindFirst.mockResolvedValue(null)
    const res = await DELETE(req('id=someone_elses'))
    expect(res.status).toBe(404)
    expect(mockShopDeleteMany).not.toHaveBeenCalled()
  })
})

describe('a shop that traded is never deleted', () => {
  it.each([
    ['a bill', 'transaction'],
    ['a customer', 'party'],
    ['a product', 'product'],
    ['a document', 'document'],
  ])('refuses when the shop holds %s', async (_label, key) => {
    ;(counts as Record<string, number>)[key] = 1
    const res = await DELETE(req('id=shop_2'))
    expect(res.status).toBe(409)
    expect(mockShopDeleteMany).not.toHaveBeenCalled()
  })

  it('tells the shopkeeper what is in there, rather than just refusing', async () => {
    counts.transaction = 3
    counts.party = 2
    const body = await (await DELETE(req('id=shop_2'))).json()
    expect(body.message).toMatch(/3 bill/)
    expect(body.message).toMatch(/2 customer/)
  })

  it('points them at archiving, which is the thing they can actually do', async () => {
    counts.transaction = 1
    const body = await (await DELETE(req('id=shop_2'))).json()
    expect(body.message).toMatch(/put it away|archive/i)
  })

  it('but archiving that same shop is allowed', async () => {
    counts.transaction = 99
    const res = await DELETE(req('id=shop_2&archive=1'))
    expect(res.status).toBe(200)
    expect(mockShopUpdateMany).toHaveBeenCalled()
    // and nothing was destroyed
    expect(mockShopDeleteMany).not.toHaveBeenCalled()
  })
})

describe('archiving keeps the books', () => {
  it('sets archivedAt rather than removing the row', async () => {
    await DELETE(req('id=shop_2&archive=1'))
    const [args] = mockShopUpdateMany.mock.calls[0] as [{ data: { archivedAt: unknown } }]
    expect(args.data.archivedAt).toBeInstanceOf(Date)
  })

  it('scopes the archive by userId too', async () => {
    await DELETE(req('id=shop_2&archive=1'))
    const [args] = mockShopUpdateMany.mock.calls[0] as [{ where: Record<string, unknown> }]
    expect(args.where).toEqual(expect.objectContaining({ userId: USER }))
  })

  it('says the books are still there, because a shop disappearing is alarming', async () => {
    const body = await (await DELETE(req('id=shop_2&archive=1'))).json()
    expect(body.message).toMatch(/still there|kept/i)
  })
})

describe('the last shop cannot leave', () => {
  it('refuses to delete it', async () => {
    // Otherwise the shopkeeper archives their way to zero, GET treats that as a
    // brand new user and creates a fresh "My Shop" — which looks exactly like
    // their books having been wiped.
    mockShopCount.mockResolvedValue(1)
    const res = await DELETE(req('id=shop_2'))
    expect(res.status).toBe(400)
    expect(mockShopDeleteMany).not.toHaveBeenCalled()
  })

  it('refuses to archive it either', async () => {
    mockShopCount.mockResolvedValue(1)
    const res = await DELETE(req('id=shop_2&archive=1'))
    expect(res.status).toBe(400)
    expect(mockShopUpdateMany).not.toHaveBeenCalled()
  })

  it('explains what to do instead', async () => {
    mockShopCount.mockResolvedValue(1)
    const body = await (await DELETE(req('id=shop_2'))).json()
    expect(body.message).toMatch(/create another/i)
  })
})

describe('the obvious refusals', () => {
  it('requires a shop id', async () => {
    expect((await DELETE(req('archive=1'))).status).toBe(400)
  })

  it('requires an owner', async () => {
    mockAuth.mockResolvedValue({ userId: null, error: new Response('no', { status: 401 }) })
    expect((await DELETE(req('id=shop_2'))).status).toBe(401)
    expect(mockShopDeleteMany).not.toHaveBeenCalled()
  })
})
