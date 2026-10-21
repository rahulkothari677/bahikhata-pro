/**
 * #254 (Phase 6a): the two profit reports show sales with no cost price as
 * their own figure, so every row adds up on screen (revenue = cost + no cost
 * price + profit), and never print a margin that was not measured.
 *
 * Found on the local check: the desktop row read ₹110 revenue, ₹8 cost, ₹2
 * profit — the other ₹100 was nowhere; and a return showed a green "↗20%".
 */
import React from 'react'
import { describe, test, expect, afterEach } from '@jest/globals'
import { render, screen, cleanup, within } from '@testing-library/react'
import { BillWiseProfit } from '@/components/reports/BillWiseProfit'
import { ItemWiseProfit } from '@/components/reports/ItemWiseProfit'
import { marginText } from '@/components/reports/NoCostNote'

afterEach(cleanup)

const bill = (over: Record<string, unknown>) => ({ id: 'b1', invoiceNo: 'INV-0012', date: '2026-10-21', type: 'sale', partyName: 'Walk-in customer', itemCount: 2, revenue: 110, cogs: 8, noCost: 100, profit: 2, margin: 20, ...over })
const billData = (bills: any[], totalNoCost: number) => ({ summary: { totalBills: bills.length, totalRevenue: 0, totalCogs: 0, totalProfit: 0, totalNoCost, avgMargin: 7.8 }, bills })

describe('marginText', () => {
  test('null is "No cost price"; a number is a %', () => {
    expect(marginText(null)).toBe('No cost price')
    expect(marginText(undefined)).toBe('No cost price')
    expect(marginText(20)).toBe('20%')
    expect(marginText(0)).toBe('0%')
  })
})

describe('Bill-wise profit', () => {
  test('a "No cost price" column appears when a bill has some, and each row carries its amount', () => {
    render(<BillWiseProfit data={billData([bill({}), bill({ id: 'b2', invoiceNo: 'INV-0001', noCost: 0, revenue: 100, cogs: 90, profit: 10, margin: 10 })], 100)} />)
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'No cost price' })).toBeTruthy()
    const row = within(table).getByText('INV-0012').closest('tr')!
    expect(within(row).getByText('₹100')).toBeTruthy()
    expect(within(within(table).getByText('INV-0001').closest('tr')!).getByText('—')).toBeTruthy()
    expect(screen.getByText(/with no cost price/)).toBeTruthy()
  })

  test('no column, and no note, when nothing sold without a cost price', () => {
    render(<BillWiseProfit data={billData([bill({ noCost: 0 })], 0)} />)
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'No cost price' })).toBeNull()
    expect(screen.queryByText(/with no cost price/)).toBeNull()
  })

  test('a return shows "—" for margin, never a green percentage', () => {
    render(<BillWiseProfit data={billData([bill({ id: 'c1', invoiceNo: 'CN-0002', type: 'credit-note', revenue: -110, cogs: -8, noCost: -100, profit: -2, margin: 20 })], -100)} />)
    const row = within(screen.getByRole('table')).getByText('CN-0002').closest('tr')!
    expect(within(row).queryByText('20%')).toBeNull()
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0)
  })

  test('a bill where nothing had a cost price says so in the margin', () => {
    render(<BillWiseProfit data={billData([bill({ cogs: 0, noCost: 110, profit: 0, margin: null })], 110)} />)
    const row = within(screen.getByRole('table')).getByText('INV-0012').closest('tr')!
    expect(within(row).getByText('No cost price')).toBeTruthy()
  })
})

describe('6a-2: an older bill that does not add up shows the difference, not a made-up cost', () => {
  test('Bill-wise: a "Not matched" column only when a bill has one; the cost stays the real cost', () => {
    // live INV-0004: 3 × ₹230 = ₹690 cost; it stored ₹38.58 profit where its lines give ₹38.57
    render(<BillWiseProfit data={{ summary: { totalBills: 1, totalRevenue: 728.57, totalCogs: 690, totalProfit: 38.58, totalNoCost: 0, totalUnmatched: 0.01, avgMargin: 5.3 }, bills: [bill({ invoiceNo: 'INV-0004', itemCount: 1, revenue: 728.57, cogs: 690, noCost: 0, profit: 38.58, unmatched: 0.01, margin: 5.3 })] }} />)
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Not matched' })).toBeTruthy()
    const row = within(table).getByText('INV-0004').closest('tr')!
    expect(within(row).getByText('₹690')).toBeTruthy()
    expect(screen.getByText(/not matched to items/)).toBeTruthy()
  })
  test('no column when every bill adds up', () => {
    render(<BillWiseProfit data={billData([bill({ unmatched: 0 })], 100)} />)
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'Not matched' })).toBeNull()
  })
  test('Item-wise: the difference is one more row, and the total is the bills\' total', () => {
    render(<ItemWiseProfit data={{ summary: { totalProducts: 1, totalRevenue: 728.57, totalCogs: 690, totalProfit: 38.58, totalNoCost: 0, totalUnmatched: 0.01, avgMargin: 5.3 }, items: [
      { productName: 'Atta', totalQty: 3, revenue: 728.57, cogs: 690, noCost: 0, profit: 38.57, margin: 5.3 },
    ] }} />)
    const table = screen.getByRole('table')
    const row = within(table).getByText('Not matched to items').closest('tr')!
    expect(within(row).getByText('₹0.01')).toBeTruthy()
    expect(within(table).getByText('₹38.58')).toBeTruthy() // footer total = the bills'
  })
})

describe('Item-wise profit', () => {
  const data = { summary: { totalProducts: 2, totalRevenue: 210, totalCogs: 8, totalProfit: 2, totalNoCost: 200, avgMargin: 20 }, items: [
    { productName: 'TEST Loose Tea', totalQty: 2, revenue: 200, cogs: 0, noCost: 200, profit: 0, margin: null },
    { productName: 'Parle-G', totalQty: 1, revenue: 10, cogs: 8, noCost: 0, profit: 2, margin: 20 },
  ] }

  test('an item with no cost price: "No cost price" for its margin and as its phone headline, never "₹0"', () => {
    render(<ItemWiseProfit data={data} />)
    const row = within(screen.getByRole('table')).getByText('TEST Loose Tea').closest('tr')!
    expect(within(row).getByText('No cost price')).toBeTruthy()
    // phone row (ReportRows): the headline value
    const phone = screen.getAllByText('TEST Loose Tea').map((el) => el.closest('summary')).find(Boolean)!
    expect(within(phone as HTMLElement).getByText('No cost price')).toBeTruthy()
  })
})
