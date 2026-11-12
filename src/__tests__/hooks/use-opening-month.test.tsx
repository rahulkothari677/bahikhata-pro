/**
 * @jest-environment jsdom
 *
 * 9b-4: a return screen opens on the month the Due dates list asked for — once —
 * and on this month otherwise. GSTR-1 and GSTR-3B both read it.
 */
import { renderHook } from '@testing-library/react'
import { readCode } from '@/test-support/read-source'

const state: { pendingReportMonth: string | null; setPendingReportMonth: jest.Mock } = {
  pendingReportMonth: null, setPendingReportMonth: jest.fn(),
}
jest.mock('@/store/app-store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel(state) }))

import { useOpeningMonth } from '@/hooks/use-opening-month'

beforeEach(() => { state.pendingReportMonth = null; state.setPendingReportMonth.mockReset() })

it('opens on the asked month and clears it', () => {
  state.pendingReportMonth = '2026-10'
  const { result } = renderHook(() => useOpeningMonth())
  expect(result.current).toBe('2026-10')
  expect(state.setPendingReportMonth).toHaveBeenCalledWith(null)
})

it('with nothing asked, this month', () => {
  const now = new Date()
  const { result } = renderHook(() => useOpeningMonth())
  expect(result.current).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  expect(state.setPendingReportMonth).not.toHaveBeenCalled()
})

it.each(['components/reports/Gstr1Report.tsx', 'components/reports/Gstr3bReport.tsx'])('%s opens on it', (file) => {
  expect(readCode(file)).toMatch(/const \[month, setMonth\] = useState\(useOpeningMonth\(\)\)/)
})
