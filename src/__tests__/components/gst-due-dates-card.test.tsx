/**
 * @jest-environment jsdom
 *
 * 9b-4: the Due dates card — what each row says, and that a tap opens the
 * return on its own month.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockOfflineFetch = jest.fn()
jest.mock('@/lib/offline-fetch', () => ({ offlineFetch: (...a: unknown[]) => mockOfflineFetch(...a) }))
jest.mock('@/lib/haptic', () => ({ haptic: { click: jest.fn() } }))
const store = { setPendingReportType: jest.fn(), setPendingReportMonth: jest.fn(), setView: jest.fn() }
jest.mock('@/store/app-store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel(store) }))

import { GstDueDates, periodLabel } from '@/components/reports/GstDueDates'

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body })
const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <GstDueDates />
  </QueryClientProvider>,
)

beforeEach(() => { mockOfflineFetch.mockReset(); Object.values(store).forEach((f) => f.mockReset()) })

describe('Due dates card', () => {
  it('late first, then the next ones, with the day and the count', async () => {
    mockOfflineFetch.mockReturnValue(ok({ status: 'regular', frequency: 'monthly', items: [
      { form: 'GSTR-3B', fp: '102026', day: '2026-11-20', status: 'overdue', daysLeft: -2, basis: '' },
      { form: 'GSTR-1', fp: '112026', day: '2026-12-11', status: 'due', daysLeft: 19, basis: '' },
    ] }))
    renderCard()
    expect(await screen.findByText('GSTR-3B · Oct 2026')).toBeInTheDocument()
    // never "late": the app only knows Mark as Filed
    expect(screen.getByText('Not marked filed')).toBeInTheDocument()
    expect(screen.queryByText(/late/)).not.toBeInTheDocument()
    expect(screen.getByText('Due 20 Nov')).toBeInTheDocument()
    expect(screen.getByText('GSTR-1 · Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('in 19 days')).toBeInTheDocument()
  })

  it('a tap opens that return on its month', async () => {
    mockOfflineFetch.mockReturnValue(ok({ status: 'regular', frequency: 'monthly', items: [
      { form: 'GSTR-3B', fp: '102026', day: '2026-11-20', status: 'overdue', daysLeft: -2, basis: '' },
    ] }))
    renderCard()
    fireEvent.click(await screen.findByText('GSTR-3B · Oct 2026'))
    expect(store.setPendingReportMonth).toHaveBeenCalledWith('2026-10')
    expect(store.setPendingReportType).toHaveBeenCalledWith('gstr-3b')
    expect(store.setView).toHaveBeenCalledWith('reports')
  })

  it('past ones beyond the two most recent fold behind "+N earlier", and open on a tap', async () => {
    const past = (fp: string, day: string) => ({ form: 'GSTR-3B', fp, day, status: 'overdue', daysLeft: -30, basis: '' })
    mockOfflineFetch.mockReturnValue(ok({ status: 'regular', frequency: 'monthly', items: [
      past('082026', '2026-09-20'), past('092026', '2026-10-20'), past('102026', '2026-11-20'),
      { form: 'GSTR-1', fp: '112026', day: '2026-12-11', status: 'due', daysLeft: 19, basis: '' },
    ] }))
    renderCard()
    expect(await screen.findByText('GSTR-3B · Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('GSTR-3B · Sep 2026')).toBeInTheDocument()
    expect(screen.queryByText('GSTR-3B · Aug 2026')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('+1 earlier not marked filed'))
    expect(screen.getByText('GSTR-3B · Aug 2026')).toBeInTheDocument()
    expect(screen.queryByText(/earlier not marked filed/)).not.toBeInTheDocument()
  })

  it('nothing due (or not registered) shows nothing', async () => {
    mockOfflineFetch.mockReturnValue(ok({ status: 'unregistered', items: [] }))
    const { container } = renderCard()
    await new Promise((r) => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('period names: a quarter, a year, a month', () => {
    expect(periodLabel('GSTR-3B', '122026', true)).toBe('Oct–Dec 2026')
    expect(periodLabel('PMT-06', '112026', true)).toBe('Nov 2026')
    expect(periodLabel('CMP-08', '092026', false)).toBe('Jul–Sep 2026')
    expect(periodLabel('GSTR-4', '032026', false)).toBe('FY 2025-26')
    expect(periodLabel('GSTR-1', '102026', false)).toBe('Oct 2026')
  })
})
