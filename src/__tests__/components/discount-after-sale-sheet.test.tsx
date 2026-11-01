/**
 * @jest-environment jsdom
 *
 * Phase 8f — the "Discount after sale" sheet: amount → GST split → one button.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockOfflineFetch = jest.fn()
jest.mock('@/lib/offline-fetch', () => ({
  offlineFetch: (...a: unknown[]) => mockOfflineFetch(...a),
  isQueuedResponse: () => false,
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import { DiscountAfterSaleSheet, type DiscountSale } from '@/components/ledger/DiscountAfterSaleSheet'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
})
beforeEach(() => mockOfflineFetch.mockReset())

// ₹1,000 atta at 5% (₹1,050) + ₹600 toor dal at 0%. Sold 20 Oct 2026, FY 2026-27.
const SALE: DiscountSale = {
  id: 's1', invoiceNo: 'INV-0003', date: '2026-10-20T06:30:00Z', partyId: 'p1',
  party: { name: 'Gupta Kirana Bhandar', gstin: '08AAAPG1234C1Z5' },
  totalAmount: 1650, isInterState: false,
  items: [{ gstRate: 5, total: 1050, hsn: '1101', unit: 'kg' }, { gstRate: 0, total: 600, hsn: '0713', unit: 'kg' }],
  reversalTransactions: [],
}

function show(sale: DiscountSale = SALE, chargesGst = true, due = 1650) {
  const qc = new QueryClient()
  const onClose = jest.fn()
  render(<QueryClientProvider client={qc}><DiscountAfterSaleSheet sale={sale} chargesGst={chargesGst} due={due} onClose={onClose} /></QueryClientProvider>)
  return { onClose }
}
const type = (v: string) => fireEvent.change(screen.getByLabelText(/Discount in rupees|Discount as a percentage/), { target: { value: v } })

test('₹165 off: the GST split, the buyer\'s reversal, and the saved note', async () => {
  mockOfflineFetch.mockResolvedValue({ ok: true, json: async () => ({ transaction: { invoiceNo: 'CN-0002' } }) })
  const { onClose } = show()
  type('165')
  const split = screen.getByTestId('discount-gst-split').textContent!
  expect(split).toMatch(/Value before GST₹160(\.00)?/)
  expect(split).toMatch(/CGST₹2\.50/)
  expect(split).toMatch(/SGST₹2\.50/)
  expect(split).toMatch(/Customer gets₹165(\.00)?/)
  expect(screen.getByText(/Gupta Kirana Bhandar must reverse ₹5(\.00)? of input credit/)).toBeInTheDocument()
  expect(screen.getByText(/Last date for this note: 30 Nov 2027/)).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /Give ₹165(\.00)? discount/ }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const [url, init] = mockOfflineFetch.mock.calls[0]
  expect(url).toBe('/api/transactions')
  const body = JSON.parse(init.body)
  expect(body).toMatchObject({
    type: 'credit-note', originalTransactionId: 's1', partyId: 'p1', noteType: 'C',
    noteReason: 'post-sale-discount', affectsStock: false, paidAmount: 0,
  })
  expect(body.items.map((l: any) => [l.hsn, l.gstRate, l.unitPrice, l.priceIncludesGst])).toEqual([['1101', 5, 105, true], ['0713', 0, 60, true]])
})

test('"Cash back" records the discount as paid out', async () => {
  mockOfflineFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  show()
  type('50')
  fireEvent.click(screen.getByRole('radio', { name: 'Cash back' }))
  fireEvent.click(screen.getByRole('button', { name: /Give ₹50(\.00)? discount/ }))
  await waitFor(() => expect(mockOfflineFetch).toHaveBeenCalled())
  expect(JSON.parse(mockOfflineFetch.mock.calls[0][1].body).paidAmount).toBe(50)
})

test('a bill already paid in full starts on "Cash back" — nothing is left on the khata to reduce', () => {
  show(SALE, true, 0)
  type('50')
  expect(screen.getByRole('radio', { name: 'Cash back' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: 'Less to pay (khata)' })).toHaveAttribute('aria-checked', 'false')
})

test('in %: 10% of ₹1,650 = ₹165', () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: '%' }))
  type('10')
  expect(screen.getByText(/=/).textContent).toMatch(/₹165/)
})

test('more than is left on the bill: says the most, and cannot save', () => {
  show({ ...SALE, reversalTransactions: [{ type: 'credit-note', totalAmount: 1000 }] })
  type('700')
  expect(screen.getByRole('alert').textContent).toMatch(/At most ₹650(\.00)? can come off this bill/)
  expect(screen.getByRole('button', { name: /Give ₹700/ })).toBeDisabled()
})

test('#351 past the s.34(2) date: says so, and still gives it on the khata — no GST', async () => {
  // Sold May 2024 (FY 2024-25) → the last date was 30 Nov 2025.
  mockOfflineFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  show({ ...SALE, date: '2024-05-10T06:30:00Z' })
  expect(screen.getByText('Too late to lower the GST on this bill')).toBeInTheDocument()
  expect(screen.getByText(/Last date was 30 Nov 2025\. Give it on the khata, without GST\./)).toBeInTheDocument()
  type('165')
  // No GST rows, no reversal, no "last date" line — none of it applies outside GST.
  expect(screen.queryByTestId('discount-gst-split')).not.toBeInTheDocument()
  expect(screen.queryByText(/must reverse/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Last date for this note/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Give ₹165(\.00)? discount \(no GST\)/ }))
  await waitFor(() => expect(mockOfflineFetch).toHaveBeenCalled())
  expect(JSON.parse(mockOfflineFetch.mock.calls[0][1].body)).toMatchObject({ outsideGst: true, noteReason: 'post-sale-discount', affectsStock: false })
})

test('inside the date the note is a normal GST note (outsideGst false)', async () => {
  mockOfflineFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  show()
  type('50')
  fireEvent.click(screen.getByRole('button', { name: /Give ₹50(\.00)? discount$/ }))
  await waitFor(() => expect(mockOfflineFetch).toHaveBeenCalled())
  expect(JSON.parse(mockOfflineFetch.mock.calls[0][1].body).outsideGst).toBe(false)
})

test('a shop that charges no GST: just the amount — no GST rows, no date, no reversal', () => {
  show({ ...SALE, date: '2024-05-10T06:30:00Z' }, false)
  type('100')
  expect(screen.queryByTestId('discount-gst-split')).not.toBeInTheDocument()
  expect(screen.queryByText(/Last date/)).not.toBeInTheDocument()
  expect(screen.queryByText(/must reverse/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Give ₹100(\.00)? discount/ })).toBeEnabled()
})

test('a walk-in sale has no khata: no choice, the discount is cash back', async () => {
  mockOfflineFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  show({ ...SALE, partyId: null, party: null })
  type('20')
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  expect(screen.queryByText(/must reverse/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Give ₹20(\.00)? discount/ }))
  await waitFor(() => expect(mockOfflineFetch).toHaveBeenCalled())
  expect(JSON.parse(mockOfflineFetch.mock.calls[0][1].body).paidAmount).toBe(20)
})
