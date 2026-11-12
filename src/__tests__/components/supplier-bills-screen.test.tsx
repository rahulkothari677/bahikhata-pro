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
import { NAV_REGISTRY, showsForGstStatus } from '@/lib/nav-registry'

jest.mock('@/lib/offline-fetch', () => ({ offlineFetch: jest.fn() }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
let mockSetting: Record<string, unknown> = { gstRegistered: true }
jest.mock('@/hooks/use-setting', () => ({ useSetting: () => ({ setting: mockSetting, hideProfit: false }) }))

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
    notes: [line('CN-14', { docType: 'credit-note', totalAmount: 590, taxableValue: 500, cgst: 45, sgst: 45 }), line('CN-15', { docType: 'credit-note', totalAmount: 236, taxableValue: 200, cgst: 18, sgst: 18 })],
    notesToRecord: [line('CN-14', { docType: 'credit-note', totalAmount: 590, taxableValue: 500, cgst: 45, sgst: 45 })],
    notesOffered: [{ line: line('CN-15', { docType: 'credit-note', totalAmount: 236, taxableValue: 200, cgst: 18, sgst: 18 }), candidates: [buy('d-3', 'DN-0003', { totalAmount: 236 })] }],
    notesRecorded: [],
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
  mockSetting = { gstRegistered: true }
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
    expect(screen.getByText('Credit note · not in your books')).toBeTruthy()
    expect(screen.getByText(/Portal: accept, reduce credit ₹90/)).toBeTruthy()
    expect(screen.getByText('Recorded as DN-0003?')).toBeTruthy()
    expect(screen.getByText('Change it on the portal before you file GSTR-3B')).toBeTruthy()
  })

  it('"Same bill" sends the answer about that purchase', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Same bill' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Same bill' }))
    await waitFor(() => expect(decisionsSent()).toEqual([{ method: 'POST', supplierGstin: A, docType: 'invoice', documentNumber: 'RO/0012', decision: 'same-bill', purchaseId: 'p-ro12' }]))
  })

  it('"Not mine" shows the three portal steps; "Done on the portal" records it', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not mine' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Not mine' }))
    const sheet = await screen.findByTestId('not-mine-sheet')
    expect(within(sheet).getByText(/Recompute GSTR-2B/)).toBeTruthy()
    expect(decisionsSent()).toEqual([]) // nothing recorded until the shop says it is done
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done on the portal' }))
    await waitFor(() => expect(decisionsSent()).toEqual([{ method: 'POST', supplierGstin: C, docType: 'invoice', documentNumber: 'X-9', decision: 'not-mine' }]))
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

  it('9a-4: "Record it" opens the return-to-supplier form filled from the note; "Yes, that one" links it', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record it' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Yes, that one' }))
    await waitFor(() => expect(decisionsSent()).toEqual([{ method: 'POST', supplierGstin: A, docType: 'credit-note', documentNumber: 'CN-15', decision: 'same-bill', purchaseId: 'd-3' }]))
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }))
    expect((window as any).__ledgerPreset).toMatchObject({ type: 'debit-note', data: { partyId: 'party-a', notes: "Supplier's credit note CN-14" } })
    expect(useAppStore.getState().currentView).toBe('new-purchase')
  })

  it('9a-4: coming back from a form fetches fresh, even inside the app-wide cache time', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 2 * 60 * 1000 } } })
    const view = () => <QueryClientProvider client={client}><Gstr2bReconciliation /></QueryClientProvider>
    const first = render(view())
    await waitFor(() => expect(screen.getByTestId('credit-ready')).toBeTruthy())
    const calls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/gstr-2b/reconcile')).length
    expect(calls()).toBe(1)
    first.unmount() // off to the purchase form…
    render(view())  // …and back
    await waitFor(() => expect(calls()).toBe(2))
  })

  it('9a-5: a composition shop is told this is not for it — no 2B fetched, no credit actions', async () => {
    mockSetting = { gstRegistered: true, compositionCategory: 'trader' }
    mount()
    expect(screen.getByTestId('supplier-bills-composition').textContent).toMatch(/Supplier bills are for regular GST shops/)
    expect(screen.queryByTestId('credit-ready')).toBeNull()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/gstr-2b/reconcile'))).toBe(false)
  })

  it('9a-5: the reports list and search hide Supplier bills from a composition shop, show it to a regular one', () => {
    const entry = NAV_REGISTRY.find((d) => d.id === 'gstr-2b')!
    expect(showsForGstStatus(entry, 'regular')).toBe(true)
    expect(showsForGstStatus(entry, 'composition')).toBe(false)
  })

  it('9b-2: a quarterly filer sees the quarter — "Oct–Dec 2026", only December’s 2B asked for, back a quarter at a time', async () => {
    mockSetting = { gstRegistered: true, gstFilingFrequency: 'quarterly' }
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 12), doNotFake: ['setTimeout', 'setInterval', 'queueMicrotask', 'nextTick', 'setImmediate'] })
    try {
      mount()
      await waitFor(() => expect(screen.getByText('Oct–Dec 2026')).toBeTruthy())
      const months = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/gstr-2b/reconcile')).map((u) => new URL(u, 'http://x').searchParams.get('month'))
      await waitFor(() => expect(months()).toContain('2026-12'))
      expect(months()).not.toContain('2026-11')
      fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
      await waitFor(() => expect(screen.getByText(/^Jul–Sept? 2026$/)).toBeTruthy()) // en-IN writes "Sept"
      await waitFor(() => expect(months()).toContain('2026-09'))
    } finally {
      jest.useRealTimers()
    }
  })

  it('9b-2: a credit note says until when it can stay Pending', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/gstr-2b/reconcile')
      ? { ok: true, json: async () => ({ ...payload, notesPendingUntil: '2026-12-20T00:00:00.000Z' }) }
      : { ok: true, json: async () => ({ success: true }) }))
    mount()
    await waitFor(() => expect(screen.getByText(/Decide by 20 Dec 2026/)).toBeTruthy())
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
