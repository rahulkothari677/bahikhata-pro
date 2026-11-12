/**
 * @jest-environment node
 *
 * 9b-4: /api/gst-due-dates — nothing for a shop that is not registered; a
 * regular shop's list drops the returns it has filed.
 */
let mockSetting: Record<string, unknown> | null
const mockG1 = jest.fn()
const mockG3 = jest.fn()
jest.mock('@/lib/db', () => ({
  db: {
    setting: { findUnique: jest.fn(async () => mockSetting) },
    gstr1Snapshot: { findMany: (...a: unknown[]) => mockG1(...a) },
    gstReturn: { findMany: (...a: unknown[]) => mockG3(...a) },
  },
}))
jest.mock('@/lib/get-auth', () => ({
  getAuthContext: jest.fn().mockResolvedValue({ userId: 'user_1', role: 'owner', permissions: null, error: null }),
}))
jest.mock('@/lib/staff-permissions', () => ({ canAccessModule: () => true }))
jest.mock('@/lib/timezone', () => ({ istDateString: () => '2026-11-22' }))

import { GET } from '@/app/api/gst-due-dates/route'

beforeEach(() => { mockG1.mockReset().mockResolvedValue([]); mockG3.mockReset().mockResolvedValue([]) })

it('a shop that is not registered has nothing due', async () => {
  mockSetting = { gstRegistered: false }
  const body = await (await GET()).json()
  expect(body).toEqual({ status: 'unregistered', items: [] })
  expect(mockG1).not.toHaveBeenCalled()
})

it('a monthly shop in Rajasthan: October 3B late when not filed; filed ones drop', async () => {
  mockSetting = { gstRegistered: true, gstin: '08AAACG1234K1ZT', state: 'Rajasthan', gstFilingFrequency: null }
  mockG1.mockResolvedValue([{ monthYear: '082026' }, { monthYear: '092026' }, { monthYear: '102026' }])
  mockG3.mockResolvedValue([{ monthYear: '082026' }, { monthYear: '092026' }])
  const body = await (await GET()).json()
  expect(body.frequency).toBe('monthly')
  expect(body.items.map((r: { form: string; fp: string; status: string; daysLeft: number }) => `${r.form} ${r.fp} ${r.status} ${r.daysLeft}`)).toEqual([
    'GSTR-3B 102026 overdue -2',
    'GSTR-1 112026 due 19',
    'GSTR-3B 112026 due 28',
  ])
  // asked only about the four periods the list covers
  expect(mockG1.mock.calls[0][0].where.monthYear.in).toEqual(['082026', '092026', '102026', '112026'])
})
