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

const mockState: Record<string, any> = { sales: null, udhaar: null, items: null, customers: null, profit: null }
jest.mock('@/hooks/use-insights', () => ({ useInsights: (section: string) => mockState[section] }))
jest.mock('@/lib/haptic', () => ({ haptic: { click: jest.fn() } }))
const mockNav = jest.fn()
jest.mock('@/lib/handle-nav-action', () => ({ handleNavAction: (...a: unknown[]) => mockNav(...a) }))

import { SalesSection, MODE_DOT, categoryLabel } from '@/components/insights/SalesSection'
import { UdhaarSection, AGE_DOT } from '@/components/insights/UdhaarSection'
import { ItemsSection, ABC_DOT } from '@/components/insights/ItemsSection'
import { CustomersSection, SEG_DOT } from '@/components/insights/CustomersSection'
import { ProfitSection } from '@/components/insights/ProfitSection'
import { abcGroups, customerGroups } from '@/lib/insights'
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

const ITEMS = {
  totals: { sold: 15, items: 16, stockValue: 7969.5, outOfStock: 1 },
  abc: [{ id: 'a', count: 6, amount: 43181.26, share: 80 }, { id: 'b', count: 5, amount: 8024.25, share: 15 }, { id: 'c', count: 4, amount: 2651.49, share: 5 }, { id: 'none', count: 1, amount: 0, share: 0 }],
  stock: { out: 1, low: 2, notSoldPeriod: { count: 1, stockValue: 1200 }, notSold90: { count: 0, stockValue: 0 } },
  top: {
    sales: [{ id: 'i1', name: 'Tata Tea Gold 500g', sales: 10254.36, qty: 36, profit: 1614.36 }],
    qty: [{ id: 'i2', name: 'Parle-G Biscuit 100g', sales: 459.23, qty: 47, profit: 91.23 }],
    profit: [{ id: 'i1', name: 'Tata Tea Gold 500g', sales: 10254.36, qty: 36, profit: 1614.36 }],
  },
}
const CUSTOMERS = {
  totals: { bought: 4, customers: 7, newCount: 1, walkInShare: 28 },
  groups: [{ id: 'new', count: 1, amount: 4525.05, share: 9 }, { id: 'regular', count: 3, amount: 45000, share: 91 }, { id: 'occasional', count: 0, amount: 0, share: 0 }, { id: 'quiet', count: 1, amount: 900, share: 0 }, { id: 'inactive', count: 2, amount: 0, share: 0 }],
  namedVsWalkIn: [{ id: 'named', count: 0, amount: 49525.05, share: 72 }, { id: 'walkin', count: 0, amount: 19000, share: 28 }],
  top: { sales: [{ id: 'c1', name: 'Ramesh Verma', sales: 20000, bills: 9, profit: 3000 }], bills: [{ id: 'c1', name: 'Ramesh Verma', sales: 20000, bills: 9, profit: 3000 }], profit: [] },
}

describe('Items', () => {
  test('A/B/C groups and stock rows are the engine’s; switching to Quantity ranks by quantity', () => {
    mockState.items = ok(ITEMS)
    render(<ItemsSection range={range} period="This Month" hideProfit={false} t={t} />)
    expect(screen.getByText('A items · 6')).toBeTruthy()
    expect(screen.getByText('No sale · 1')).toBeTruthy()
    expect(screen.getByText(formatINR(43181.26))).toBeTruthy()
    expect(screen.getByText('Not sold this period · 1')).toBeTruthy()
    expect(screen.getByText('36 sold · 16% margin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Quantity' }))
    expect(screen.getByText('Parle-G Biscuit 100g')).toBeTruthy()
    expect(screen.getByText('See all 16 in Items')).toBeTruthy()
  })
  test('hide profit: no Profit sort and no margin', () => {
    mockState.items = ok({ ...ITEMS, top: { sales: ITEMS.top.sales.map((x) => ({ ...x, profit: null })), qty: [], profit: [] } })
    render(<ItemsSection range={range} period="This Month" hideProfit t={t} />)
    expect(screen.queryByRole('button', { name: 'Profit' })).toBeNull()
    expect(screen.queryByText(/margin/)).toBeNull()
  })
})

describe('Customers', () => {
  test('groups, walk-in share and the top list; a customer opens their khata', () => {
    mockState.customers = ok(CUSTOMERS)
    render(<CustomersSection range={range} period="This Month" hideProfit={false} t={t} />)
    expect(screen.getByText('Regular · 3')).toBeTruthy()
    expect(screen.getByText('Gone quiet · 1')).toBeTruthy()
    expect(screen.getByText('period before')).toBeTruthy()
    expect(screen.getAllByText('28%').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Ramesh Verma/ }))
    expect(useAppStore.getState().selectedPartyId).toBe('c1')
  })
})

const PROFIT = {
  totals: { profit: 8291, netSales: 53857, margin: 15.4, previous: 7000, afterExpenses: -14258, expenses: 23349, income: 800 },
  unmatched: { sales: 0, profit: 0.01 },
  byCategory: [
    { id: 'Tea', sales: 10254.36, profit: 1614.36, margin: 15.7 },
    { id: '__typed', sales: 500, profit: 0, margin: null },
    { id: '__unmatched', sales: 0, profit: 0.01, margin: null },
  ],
  lowest: [{ id: 'l1', name: 'Lays Magic Masala 52g', sales: 400, profit: 38, margin: 9.5 }],
  costUp: [{ id: 'o1', name: 'Fortune Sunflower Oil 1L', previous: 130, latest: 140, salePrice: 155, earnNow: 15, earnBefore: 25, date: '2026-10-10T05:00:00Z' }],
}

describe('Profit', () => {
  test('totals with the change on before; every category row, the typed-in and gap rows named; margins and cost rises', () => {
    mockState.profit = ok(PROFIT)
    render(<ProfitSection range={range} t={t} />)
    expect(screen.getByText('↑ 18% on the period before')).toBeTruthy()
    expect(screen.getByText(formatINR(-14258))).toBeTruthy()
    expect(screen.getByText('Typed-in items (no cost price)')).toBeTruthy()
    expect(screen.getByText('no cost price')).toBeTruthy()
    expect(screen.getByText('Not matched to items')).toBeTruthy()
    expect(screen.getByText('9.5%')).toBeTruthy()
    expect(screen.getByText('Cost ₹130 → ₹140 · you earn ₹15 a unit (was ₹25)')).toBeTruthy()
    expect(screen.getByText('+7.7%')).toBeTruthy()
  })
  test('a failed load is an error, never ₹0 profit', () => {
    mockState.profit = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() }
    render(<ProfitSection range={range} t={t} />)
    expect(screen.queryByText('₹0')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('words and colours', () => {
  test('every group id the engine can send has a label and a colour', () => {
    for (const id of ['cash', 'upi', 'card', 'bank', 'other', 'udhaar', 'nobody']) expect({ id, label: !!en[`ins.mode.${id}`], dot: !!MODE_DOT[id] }).toEqual({ id, label: true, dot: true })
    for (const g of udhaarAge([], new Date())) expect({ id: g.id, label: !!en[`ins.age.${g.id}`], dot: !!AGE_DOT[g.id] }).toEqual({ id: g.id, label: true, dot: true })
    for (const g of abcGroups([], 0).groups) expect({ id: g.id, label: !!en[`ins.abc.${g.id}`], dot: !!ABC_DOT[g.id] }).toEqual({ id: g.id, label: true, dot: true })
    for (const g of customerGroups([], new Date())) expect({ id: g.id, label: !!en[`ins.seg.${g.id}`], sub: !!en[`ins.seg_d.${g.id}`], dot: !!SEG_DOT[g.id] }).toEqual({ id: g.id, label: true, sub: true, dot: true })
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
