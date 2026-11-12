/**
 * @jest-environment node
 *
 * 9b-1 (#106): the settings API stores monthly / quarterly filing, clears it, and
 * refuses anything else — never a guess.
 */
const mockUpsert = jest.fn()
jest.mock('@/lib/db', () => ({
  db: {
    setting: {
      upsert: (...a: unknown[]) => mockUpsert(...a),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    invoiceCounter: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    shop: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}))
jest.mock('@/lib/get-auth', () => ({
  getAuthUserIdWithModule: jest.fn().mockResolvedValue({ userId: 'user_1', error: null }),
}))

import { PUT } from '@/app/api/settings/route'

const put = (body: unknown) => PUT(new Request('https://app.test/api/settings', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as never)

beforeEach(() => {
  mockUpsert.mockReset()
  mockUpsert.mockImplementation(async (args: { create: object }) => ({ id: 's1', userId: 'user_1', ...args.create }))
})

describe('filing frequency in settings (9b-1)', () => {
  it('stores "quarterly" and "monthly"', async () => {
    for (const f of ['quarterly', 'monthly']) {
      const res = await put({ gstFilingFrequency: f })
      expect(res.status).toBe(200)
      expect(mockUpsert.mock.calls.at(-1)[0].update.gstFilingFrequency).toBe(f)
    }
  })

  it('null clears it back to "not answered"', async () => {
    await put({ gstFilingFrequency: null })
    expect(mockUpsert.mock.calls.at(-1)[0].update.gstFilingFrequency).toBeNull()
  })

  it('anything else is refused and nothing is written', async () => {
    const res = await put({ gstFilingFrequency: 'yearly' })
    expect(res.status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
