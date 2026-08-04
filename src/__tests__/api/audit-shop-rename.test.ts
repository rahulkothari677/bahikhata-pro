/**
 * @jest-environment node
 *
 * BEHAVIOURAL tests for renaming a shop.
 *
 * WHY (audit 2026-08-03): a shop could be created and never changed. The route
 * exported GET and POST only, and the only code anywhere that touched a Shop
 * row afterwards was "delete my entire account". An owner who typed their own
 * shop's name wrong was stuck with it.
 *
 * The visible symptom was worse than a typo. The default shop is seeded ONCE
 * from Setting.shopName. Change your business name in Settings afterwards and
 * the Manage Shops card kept showing the ORIGINAL name indefinitely — the app
 * disagreed with itself about the name of the same shop, and neither screen
 * could fix it.
 *
 * Two rules are load-bearing here and each has a test:
 *
 *  1. The rename must be scoped by userId. `update({ where: { id } })` matches
 *     on the primary key alone, so it would let anyone rename anyone's shop by
 *     guessing an id. updateMany with userId in the WHERE is what prevents it.
 *
 *  2. The Settings -> Shop name sync is ONE WAY. Setting.shopName is printed on
 *     invoices, GSTR-1 and e-invoice IRN payloads. A rename box in a shop list
 *     must never rewrite a GST document identity as a side effect.
 */

const mockShopUpdateMany = jest.fn()
const mockShopFindFirst = jest.fn()
const mockSettingUpsert = jest.fn()
const mockSettingFindUnique = jest.fn()

jest.mock('@/lib/db', () => ({
  db: {
    shop: {
      updateMany: (...a: unknown[]) => mockShopUpdateMany(...a),
      findFirst: (...a: unknown[]) => mockShopFindFirst(...a),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    setting: {
      upsert: (...a: unknown[]) => mockSettingUpsert(...a),
      findUnique: (...a: unknown[]) => mockSettingFindUnique(...a),
    },
  },
}))

const mockOwnerOnly = jest.fn()
jest.mock('@/lib/get-auth', () => ({
  getAuthUserIdOwnerOnly: (...a: unknown[]) => mockOwnerOnly(...a),
  getAuthUserId: (...a: unknown[]) => mockOwnerOnly(...a),
  // The settings route gates on the module-aware variant.
  getAuthUserIdWithModule: (...a: unknown[]) => mockOwnerOnly(...a),
}))

jest.mock('@/lib/usage-limits', () => ({
  checkEntityLimit: jest.fn().mockResolvedValue({ allowed: true, plan: 'pro', used: 0, limit: 3, remaining: 3 }),
}))

import { PATCH } from '@/app/api/shops/route'

const OWNER = 'user_owner'

function patchReq(body: unknown) {
  return new Request('https://app.test/api/shops', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOwnerOnly.mockResolvedValue({ userId: OWNER, error: null })
  mockShopUpdateMany.mockResolvedValue({ count: 1 })
  mockShopFindFirst.mockResolvedValue({ id: 'shop_1', userId: OWNER, name: 'Sharma Kirana Store' })
})

describe('renaming a shop', () => {
  it('renames the shop and returns the new value', async () => {
    const res = await PATCH(patchReq({ id: 'shop_1', name: 'Sharma Kirana Store' }))
    expect(res.status).toBe(200)
    expect((await res.json()).shop.name).toBe('Sharma Kirana Store')

    const [args] = mockShopUpdateMany.mock.calls[0] as any[]
    expect(args.data.name).toBe('Sharma Kirana Store')
  })

  it('scopes the write by userId so one owner cannot rename another owner\'s shop', async () => {
    await PATCH(patchReq({ id: 'shop_belonging_to_someone_else', name: 'Hijacked' }))

    const [args] = mockShopUpdateMany.mock.calls[0] as any[]
    // The specific regression: a WHERE carrying only the id.
    expect(args.where).toEqual(expect.objectContaining({ userId: OWNER }))
  })

  it('404s when the id matches nothing the caller owns', async () => {
    mockShopUpdateMany.mockResolvedValue({ count: 0 })
    const res = await PATCH(patchReq({ id: 'someone_elses_shop', name: 'Hijacked' }))
    expect(res.status).toBe(404)
  })

  it('trims surrounding whitespace', async () => {
    await PATCH(patchReq({ id: 'shop_1', name: '   Sharma Kirana   ' }))
    const [args] = mockShopUpdateMany.mock.calls[0] as any[]
    expect(args.data.name).toBe('Sharma Kirana')
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '     '],
  ])('rejects a %s name without writing', async (_label, name) => {
    const res = await PATCH(patchReq({ id: 'shop_1', name }))
    expect(res.status).toBe(400)
    expect(mockShopUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects a name beyond the column limit without writing', async () => {
    const res = await PATCH(patchReq({ id: 'shop_1', name: 'x'.repeat(201) }))
    expect(res.status).toBe(400)
    expect(mockShopUpdateMany).not.toHaveBeenCalled()
  })

  it('refuses staff and CA sub-accounts — renaming a shop is an owner action', async () => {
    mockOwnerOnly.mockResolvedValue({
      userId: null,
      error: new Response(JSON.stringify({ error: 'Owner only' }), { status: 403 }),
    })
    const res = await PATCH(patchReq({ id: 'shop_1', name: 'Staff Rename' }))
    expect(res.status).toBe(403)
    expect(mockShopUpdateMany).not.toHaveBeenCalled()
  })
})

describe('the business name in Settings reaches the default shop', () => {
  // Requiring a fresh module registry: the settings route pulls in a wide
  // dependency graph, so it is imported lazily inside each test.
  async function putSettings(body: Record<string, unknown>) {
    const { PUT } = await import('@/app/api/settings/route')
    return PUT(new Request('https://app.test/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any)
  }

  beforeEach(() => {
    mockSettingUpsert.mockResolvedValue({ userId: OWNER, shopName: 'Sharma Kirana Store' })
    mockSettingFindUnique.mockResolvedValue({ userId: OWNER, shopName: 'My Shop' })
  })

  it('updates the default shop when the business name changes', async () => {
    await putSettings({ shopName: 'Sharma Kirana Store' })

    const syncCall = mockShopUpdateMany.mock.calls.find(
      ([a]: any[]) => a?.where?.isDefault === true,
    )
    expect(syncCall).toBeDefined()
    expect((syncCall as any[])[0].where).toEqual(
      expect.objectContaining({ userId: OWNER, isDefault: true }),
    )
    expect((syncCall as any[])[0].data.name).toBe('Sharma Kirana Store')
  })

  it('leaves shops alone when the save does not touch the business name', async () => {
    await putSettings({ hideProfit: true })
    expect(mockShopUpdateMany).not.toHaveBeenCalled()
  })

  it('still saves the settings when the shop sync fails', async () => {
    // A stale label is what the situation already was; it must not cost the
    // user their settings save.
    mockShopUpdateMany.mockRejectedValue(new Error('connection reset'))
    const res = await putSettings({ shopName: 'Sharma Kirana Store' })
    expect(res.status).toBe(200)
  })
})
