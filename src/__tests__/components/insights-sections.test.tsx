/**
 * @jest-environment jsdom
 *
 * 🔒 GUARD: Insights → Sales and Udhaar draw the engine's numbers, and only
 * those (Phase 5c-2).
 *
 * Renders the real sections with an engine answer and checks: the totals and
 * rows on screen are the answer's; a failed load is an error with Try again,
 * never a row of ₹0 that reads as "nothing sold"; an empty period says so;
 * every word has an English and a Hindi entry; every group the engine can send
 * has a label and a colour; tapping a balance opens that party.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { translations } from '@/lib/i18n'
import { udhaarAge } from '@/lib/insights'
import { formatINR } from '@/lib/utils'

const mockState: { sales: any; udhaar: any } = { sales: null, udhaar: null }
jest.mock('@/hooks/use-insights', () => ({ useInsights: (section: 'sales' | 'udhaar') => mockState[section] }))
jest.mock('@/lib/haptic', () => ({ haptic: { click: jest.fn() } }))
const mockNav = jest.fn()
jest.mock('@/lib/handle-nav-action', () => ({ handleNavAction: (...a: unknown[]) => mockNav(...a) }))

import { SalesSection, MODE_DOT, categoryLabel } from '@/components/insights/SalesSection'
import { UdhaarSection, AGE_DOT } from '@/components/insights/UdhaarSection'
import { useAppStore } from '@/store/app-store'

const en = translations.en as unknown as Record<string, string>
const hi = translations.hi as unknown as Record<string, string>
const used = new Set<string>()
const t = (k: string) => { used.add(k); return en[k] ?? `MISSING:${k}` }
const range = { from: new Date('2026-08-31T18:30:00Z'), to: new Date('2026-09-30T18:29:59Z') }
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: jest.fn() })

const SALES = {
  totals: { sales: 56764.35, bills: 64, averageBill: 886.94, returns: 0, previous: 50682.46 },
  payments: [
    { id: 'cash', count: 0, amount: 20000, share: 35 }, { id: 'upi', count: 0, amount: 18000, share: 32 },
    { id: 'udhaar', count: 0, amount: 12764.35, share: 22 }, { id: 'card', count: 0, amount: 6000, share: 11 },
  ],
  billsValue: 56764.35,
  calendar: [1, 2, 3].map((d) => ({ day: new Date(Date.UTC(2026, 8, d)).toISOString(), label: `0${d} Sep`, amount: d === 2 ? 0 : 1000 * d })),
  hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, perDay: h === 18 ? 1520 : h === 10 ? 400 : 0, bills: h === 18 ? 12 : h === 10 ? 3 : 0 })),
  categories: [{ id: 'Tea', count: 0, amount: 10254.36, share: 19 }, { id: '', count: 0, amount: 43600, share: 81 }, { id: '__unmatched', count: 0, amount: 2.64, share: 0 }],
  beforeGst: 53857, unmatched: 2.64,
}
const UDHAAR = {
  totals: { toCollect: 18619.27, customers: 4, collected: 1000, given: 6170.59 },
  age: [
    { id: 'd15', count: 1, amount: 275.02, share: 1 }, { id: 'd30', count: 0, amount: 0, share: 0 }, { id: 'd60', count: 0, amount: 0, share: 0 },
    { id: 'over', count: 3, amount: 18344.25, share: 99 }, { id: 'opening', count: 0, amount: 0, share: 0 },
  ],
  biggest: [{ id: 'p1', name: 'Ramesh Verma', balance: 7260, oldestUnpaid: '2026-08-03T12:15:13Z' }, { id: 'p2', name: 'Sunita Devi', balance: 275.02, oldestUnpaid: null }],
  toPay: { total: 1500, suppliers: 1, biggest: [{ id: 's1', name: 'Mahalaxmi Suppliers', balance: 1500 }] },
}

afterEach(cleanup)

describe('Sales', () => {
  test('totals, change on before, payments and categories are the engine\'s', () => {
    mockState.sales = ok(SALES)
    render(<SalesSection range={range} t={t} />)
    for (const v of [formatINR(56764.35), '64', formatINR(886.94), formatINR(12764.35), formatINR(10254.36)]) expect(screen.getAllByText(v, { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText('↑ 12% on the period before')).toBeTruthy()
    expect(screen.getByText('Not matched to items')).toBeTruthy()
    expect(screen.getByText('No category')).toBeTruthy()
    expect(screen.getByText('Udhaar (not paid yet)')).toBeTruthy()
    // Three days → three day buttons; the busiest hour is read out first.
    expect(screen.getAllByRole('button', { name: /Sep:/ }).length).toBe(3)
    expect(screen.getByText(formatINR(1520))).toBeTruthy()
  })
  test('an empty period says so — no payments card of ₹0 rows', () => {
    mockState.sales = ok({ ...SALES, totals: { ...SALES.totals, sales: 0, bills: 0, averageBill: 0, previous: 0 }, payments: [], categories: [] })
    render(<SalesSection range={range} t={t} />)
    expect(screen.getByText('No sales in this period')).toBeTruthy()
    expect(screen.queryByText('How customers paid')).toBeNull()
    expect(screen.queryByText(/on the period before/)).toBeNull()
  })
  test('a failed load is an error with Try again — never ₹0', () => {
    const refetch = jest.fn()
    mockState.sales = { data: undefined, isLoading: false, isError: true, refetch }
    render(<SalesSection range={range} t={t} />)
    expect(screen.queryByText('₹0')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('Udhaar', () => {
  test('every age group drawn with the engine\'s amounts; a balance opens its party; reminders open', () => {
    mockState.udhaar = ok(UDHAAR)
    useAppStore.setState({ currentView: 'dashboard' } as never)
    render(<UdhaarSection range={range} t={t} />)
    for (const id of ['d15', 'd30', 'd60', 'over', 'opening']) expect(screen.getAllByText(en[`ins.age.${id}`]).length).toBeGreaterThan(0)
    expect(screen.getAllByText(formatINR(18344.25)).length).toBe(1)
    expect(screen.getByText('See all 4 in Khata')).toBeTruthy()
    expect(screen.getAllByText('Opening balance').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Ramesh Verma/ }))
    expect(useAppStore.getState().selectedPartyId).toBe('p1')
    expect(useAppStore.getState().currentView).toBe('party-profile')
    fireEvent.click(screen.getByRole('button', { name: 'Plan reminders' }))
    expect(mockNav).toHaveBeenCalledWith(expect.objectContaining({ id: 'whatsapp-reminders' }), { previousView: 'dashboard' })
  })
  test('nobody owes: says so, no age card, no reminders button', () => {
    mockState.udhaar = ok({ ...UDHAAR, totals: { toCollect: 0, customers: 0, collected: 0, given: 0 }, age: UDHAAR.age.map((g) => ({ ...g, count: 0, amount: 0, share: 0 })), biggest: [] })
    render(<UdhaarSection range={range} t={t} />)
    expect(screen.getByText('Nobody owes you money')).toBeTruthy()
    expect(screen.queryByText('How old the udhaar is')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Plan reminders' })).toBeNull()
  })
})

describe('words and colours', () => {
  test('every group id the engine can send has a label and a colour', () => {
    for (const id of ['cash', 'upi', 'card', 'bank', 'other', 'udhaar', 'nobody']) expect({ id, label: !!en[`ins.mode.${id}`], dot: !!MODE_DOT[id] }).toEqual({ id, label: true, dot: true })
    for (const g of udhaarAge([], new Date())) expect({ id: g.id, label: !!en[`ins.age.${g.id}`], dot: !!AGE_DOT[g.id] }).toEqual({ id: g.id, label: true, dot: true })
    expect(['__unmatched', '__typed', ''].map((id) => categoryLabel(id, t)).some((l) => l.startsWith('MISSING'))).toBe(false)
  })
  test('every word used on these screens exists in English and Hindi (runs after the renders above)', () => {
    expect(used.size).toBeGreaterThan(30)
    expect([...used].filter((k) => !en[k])).toEqual([])
    expect([...used].filter((k) => !hi[k])).toEqual([])
    const insKeys = Object.keys(en).filter((k) => k.startsWith('ins.'))
    expect(insKeys.filter((k) => !hi[k])).toEqual([])
  })
})
