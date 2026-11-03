/**
 * @jest-environment jsdom
 *
 * 9a-3: the supplier-bills screen — the credit that is fine first, then only the bills
 * that need the shop, each with its reason and one action.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Gstr2bReconciliation } from '@/components/reports/Gstr2bReconciliation'
import { offlineFetch } from '@/lib/offline-fetch'
import { useAppStore } from '@/store/app-store'

jest.mock('@/lib/offline-fetch', () => ({ offlineFetch: jest.fn() }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never
})

const A = '08AAATS1234A1Z5'
const C = '08CCCTS1234C1Z5'
const line = (no: string, over: object = {}) => ({
  id: `L-${no}`, docType: 'invoice', supplierGstin: A, supplierName: 'Sharma Traders', supplierPartyId: 'party-a',
  invoiceNumber: no, originalNumber: null, invoiceDate: '10-10-2026', taxableValue: 1000, igst: 0, cgst: 90, sgst: 90,
  totalAmount: 1180, itcAvailable: true, itcReason: null, isReverseCharge: false, ...over,
})
const buy = (id: string, no: string, over: object = {}) => ({
  purchaseId: id, invoiceNumber: no, purchaseDate: '2026-10-10T06:30:00.000Z', partyName: 'Sharma Traders', partyGstin: A,
  partyPhone: '9829012345', taxableValue: 1000, igst: 0, cgst: 90, sgst: 90, totalAmount: 1180, ...over,
})
const pair = (no: string, over: object = {}) => ({
  supplierGstin: A, invoiceNumber: no, invoiceDate: '10-10-2026', twoBTaxable: 10000, twoBIgst: 0, twoBCgst: 900, twoBSgst: 900,
  twoBTotal: 11800, purchaseId: `p-${no}`, purchaseTotal: 11800, purchaseInvoiceNo: no, partyName: 'Sharma Traders',
  partyPhone: '9829012345', amountDifference: 0, itcAvailable: true, itcReason: null, via: 'number', status: 'matched', ...over,
})
const payload = {
  monthYear: '102026', hasImport: true,
  ims: { state: 'deemed-accepted', daysLeft: -5, message: 'You can still change it on the portal until you file GSTR-3B.' },
  importInfo: { importedAt: '2026-11-15T00:00:00.000Z', invoiceCount: 6 },
  summary: { matched: 2, booksOnly: 1, twoBOnly: 1, matchedItc: 1800, deferredItc: 54, missingItc: 126 },
  matched: [], booksOnly: [], twoBOnly: [],
  groups: {
    matched: [pair('SUP-901')],
    amountDiffers: [pair('SB-1182', { twoBTotal: 11920, amountDifference: 120, status: 'amount_mismatch' })],
    noCredit: [pair('SUP-990', { twoBTotal: 1180, twoBCgst: 90, twoBSgst: 90, itcReason: 'P', status: 'itc_not_available' })],
    sameBill: [{ line: line('RO/0012'), candidates: [buy('p-ro12', 'RO-12')] }],
    notInBooks: [line('X-9', { supplierGstin: C, supplierName: null, supplierPartyId: null, totalAmount: 826, taxableValue: 700, cgst: 63, sgst: 63 })],
    notMine: [],
    notes: [line('CN-14', { docType: 'credit-note', totalAmount: 590, taxableValue: 500, cgst: 45, sgst: 45 })],
    waiting: [buy('p-977', 'SUP-977', { totalAmount: 354, taxableValue: 300, cgst: 27, sgst: 27 })],
  },
}

const fetchMock = offlineFetch as jest.Mock
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Gstr2bReconciliation />
  </QueryClientProvider>,
)
const decisionsSent = () => fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/gstr-2b/decisions').map((c) => ({ method: c[1].method, ...JSON.parse(c[1].body) }))

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/gstr-2b/reconcile')
    ? { ok: true, json: async () => payload }
    : { ok: true, json: async () => ({ success: true }) }))
  delete (window as any).__ledgerPreset
})

describe('the supplier-bills screen (9a-3)', () => {
  it('the credit that is fine comes first, then the bills that need you, with their reasons', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('credit-ready')).toBeTruthy())
    expect(screen.getByTestId('credit-ready').textContent).toMatch(/₹1,800.*input credit ready · 1 bill matches your books/)
    expect(screen.getByText('Nothing to do on the portal for these')).toBeTruthy()
    const order = Array.from(document.querySelectorAll('[data-testid="supplier-bills"] h3, [data-testid="supplier-bills"] [data-testid="credit-ready"]')).map((e) => (e.matches('h3') ? e.firstChild?.textContent : '₹')?.trim())
    expect(order).toEqual(['₹', 'Needs your decision', '2B says no credit', 'Notes from suppliers', 'Waiting for suppliers'])
    expect(screen.getByText(/Amount differs by ₹120/)).toBeTruthy()
    expect(screen.getByText('Same bill? Number written differently')).toBeTruthy()
    expect(screen.getByText('Not in your books')).toBeTruthy()
    expect(screen.getByText('No credit on this bill')).toBeTruthy()
    expect(screen.getByText(/Credit note · GST ₹90/)).toBeTruthy()
    expect(screen.getByText('Change it on the portal before you file GSTR-3B')).toBeTruthy()
  })

  it('"Same bill" sends the answer about that purchase', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Same bill' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Same bill' }))
    await waitFor(() => expect(decisionsSent()).toEqual([{ method: 'POST', supplierGstin: A, documentNumber: 'RO/0012', decision: 'same-bill', purchaseId: 'p-ro12' }]))
  })

  it('"Not mine" shows the three portal steps; "Done on the portal" records it', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not mine' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Not mine' }))
    const sheet = await screen.findByTestId('not-mine-sheet')
    expect(within(sheet).getByText(/Recompute GSTR-2B/)).toBeTruthy()
    expect(decisionsSent()).toEqual([]) // nothing recorded until the shop says it is done
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done on the portal' }))
    await waitFor(() => expect(decisionsSent()).toEqual([{ method: 'POST', supplierGstin: C, documentNumber: 'X-9', decision: 'not-mine' }]))
  })

  it('"Add as purchase" opens the purchase form filled in from 2B — it saves nothing', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add as purchase' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Add as purchase' }))
    expect((window as any).__ledgerPreset).toMatchObject({ type: 'purchase', data: { partyName: C, invoiceNo: 'X-9', date: '2026-10-10' } })
    expect(useAppStore.getState().currentView).toBe('new-purchase')
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/transactions'))).toBe(false)
  })

  it('reminders and the supplier ask open WhatsApp with the message typed', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Remind' })).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Remind' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919829012345\?text=.*SUP-977/)
    expect(screen.getByRole('link', { name: 'Ask supplier' }).getAttribute('href')).toMatch(/SB-1182/)
  })

  it('calm when fine: everything matched → no countdown, no decision list', async () => {
    const calm = { ...payload, groups: { ...payload.groups, amountDiffers: [], sameBill: [], notInBooks: [] } }
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => calm }))
    mount()
    await waitFor(() => expect(screen.getByTestId('credit-ready')).toBeTruthy())
    expect(screen.queryByText(/before you file GSTR-3B/)).toBeNull()
    expect(screen.queryByText('Needs your decision')).toBeNull()
  })

  it('the matched list is folded until asked for', async () => {
    mount()
    const fold = await screen.findByRole('button', { name: /^Matched/ })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Sharma Traders · SUP-901')).toBeNull()
    fireEvent.click(fold)
    expect(screen.getByText('Sharma Traders · SUP-901')).toBeTruthy()
  })
})
