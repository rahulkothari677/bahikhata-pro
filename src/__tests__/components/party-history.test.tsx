/**
 * @jest-environment jsdom
 *
 * #327 / #328 (31 Oct): a customer's history — his June chat view back, 30 at a time,
 * with a search and filters so one entry among hundreds is easy to find.
 */
import React, { useState } from 'react'
import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  filterHistory, historyKind, matchesSearch, onRight, direction, dayTotals, periodTotals, paidOnBill,
  GAVE_ENTRY_TYPES, LEDGER_BILL_TYPES, HISTORY_PAGE, type HistoryEntry, type HistoryFilter, type HistoryKind,
} from '@/lib/party-history'
import { computeStatementRunningBalance } from '@/lib/statement-balance'
import { billDayKey } from '@/lib/bill-days'
import { PartyHistory, PartyHistoryView } from '@/components/parties/PartyHistory'
import { offlineFetch } from '@/lib/offline-fetch'

jest.mock('@/lib/offline-fetch', () => ({ offlineFetch: jest.fn() }))

/**
 * The server, played by the app's own rules (filterHistory, periodTotals, pages of 30) —
 * src/__tests__/db/party-history-parity.db.test.ts proves the real database query gives
 * the same answers on the local copy.
 */
function LocalHistory({ entries, t, balWords, onOpenBill, monthTotals }: {
  entries: HistoryEntry[]; t: (k: string) => string; balWords: (b: number) => string; onOpenBill: (id: string) => void
  monthTotals?: Record<string, { gave: number; got: number }>
}) {
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(HISTORY_PAGE)
  const rows = filterHistory(entries, { filter, q, label: (k: HistoryKind) => t(`bahi.${k}`) })
  return (
    <PartyHistoryView
      entries={rows.slice(0, shown)}
      dayTotals={Object.fromEntries(periodTotals(rows, (e) => billDayKey(e.date)))}
      monthTotals={monthTotals ?? Object.fromEntries(periodTotals(rows, (e) => billDayKey(e.date).slice(0, 7)))}
      total={rows.length}
      status="ready"
      onRetry={() => {}}
      onMore={() => setShown((n) => n + HISTORY_PAGE)}
      loadingMore={false}
      filter={filter}
      onFilter={(f) => { setFilter(f); setShown(HISTORY_PAGE) }}
      q={q}
      onQ={(v) => { setQ(v); setShown(HISTORY_PAGE) }}
      t={t}
      balWords={balWords}
      onOpenBill={onOpenBill}
    />
  )
}

const label = (k: string) => ({ sale: 'Sale', purchase: 'Purchase', got: 'Got payment', gave: 'Gave payment', return_in: 'Return from them', return_out: 'Return to them' } as Record<string, string>)[k]
const words: Record<string, string> = {
  'bahi.history': 'History', 'bahi.search_ph': 'Search amount, bill no., note, date', 'bahi.f.all': 'All', 'bahi.f.bills': 'Bills',
  'bahi.f.payments': 'Payments', 'bahi.f.unpaid': 'Unpaid', 'bahi.view': 'How to show', 'bahi.view.chat': 'Chat', 'bahi.view.ledger': 'Ledger',
  'bahi.no_match': 'No entry matches “{q}”', 'bahi.older': 'Show {n} older ({m} more)', 'bahi.empty': 'No bills or payments yet',
  'bahi.sale': 'Sale', 'bahi.got': 'Got payment', 'bahi.purchase': 'Purchase', 'bahi.gave': 'Gave payment', 'bahi.due': '{v} due', 'bahi.paid': 'paid',
  'bahi.items_n': '{n} items', 'items.count_1': '1 item',
}
const t = (k: string) => words[k] ?? k

const sale = (n: number, amount: number, due = 0): HistoryEntry => ({ id: `s${n}`, type: 'sale', date: new Date(2026, 9, 20 - (n % 20), 10).toISOString(), amount, due, invoiceNo: `INV-${String(n).padStart(4, '0')}`, itemCount: 2, runningBalance: 1000 })
const pay = (n: number, amount: number): HistoryEntry => ({ id: `p${n}`, type: 'payment-received', isPayment: true, date: new Date(2026, 9, 12, 18).toISOString(), amount, paymentMode: 'upi', notes: 'Diwali', runningBalance: 500 })

describe('the rules', () => {
  it('what an entry is, and which way it went — You gave (red ↑, right) / You got (green ↓, left)', () => {
    expect(historyKind({ type: 'sale' })).toBe('sale')
    expect(historyKind({ type: 'payment-received', isPayment: true })).toBe('got')
    expect(historyKind({ type: 'payment-paid', isPayment: true })).toBe('gave')
    // gave: goods or money left the shop
    expect(['sale', 'gave', 'return_out'].map((k) => direction(k as any))).toEqual(['gave', 'gave', 'gave'])
    // got: came in
    expect(['got', 'purchase', 'return_in'].map((k) => direction(k as any))).toEqual(['got', 'got', 'got'])
    expect(onRight('sale')).toBe(true)
    expect(onRight('got')).toBe(false) // a sale and a payment received never sit on the same side
  })
  it('a day header totals what was given and got that day', () => {
    expect(dayTotals([sale(1, 700), sale(2, 150.5), pay(3, 300)])).toEqual({ gave: 850.5, got: 300 })
  })
  it('a month adds up: last month closed + gave − got = this month closed (paid at the counter counts; a later settlement only once)', () => {
    const tx = [
      { id: 'a', date: '2026-09-10T05:00:00.000Z', type: 'sale' as const, totalAmount: 1000, paidAmount: 0 },
      { id: 'b', date: '2026-10-03T05:00:00.000Z', type: 'sale' as const, totalAmount: 250, paidAmount: 90 },
      // part-settled later by payment p2: its due falls, its effect on the balance does not
      { id: 'c', date: '2026-10-05T05:00:00.000Z', type: 'sale' as const, totalAmount: 720, paidAmount: 88, allocatedAmount: 200 },
      { id: 'd', date: '2026-10-07T05:00:00.000Z', type: 'credit-note' as const, totalAmount: 100, paidAmount: 0 },
    ]
    const pays = [
      { id: 'p1', date: '2026-09-20T05:00:00.000Z', type: 'received' as const, amount: 300 },
      { id: 'p2', date: '2026-10-09T05:00:00.000Z', type: 'received' as const, amount: 200 },
    ]
    // balance now: 1000 − 300 + 160 + 632 − 100 − 200 = 1192
    const st = computeStatementRunningBalance(tx, pays, 1192) as unknown as HistoryEntry[]
    const month = (e: HistoryEntry) => String(e.date).slice(0, 7)
    const tot = periodTotals(st, month)
    const close = (m: string) => st.find((e) => month(e) === m)!.runningBalance
    expect(tot.get('2026-10')).toEqual({ gave: 970, got: 90 + 88 + 100 + 200 })
    expect(close('2026-09') + tot.get('2026-10')!.gave - tot.get('2026-10')!.got).toBeCloseTo(close('2026-10'), 2)
    expect(close('2026-10')).toBe(1192)
    expect(paidOnBill(st.find((e) => e.id === 'c')!)).toBe(88)
  })
  it('period totals count every matching entry, not only the ones on screen', () => {
    // 40 sales on one day: the first page shows 30, the day's total still adds all 40
    const one = Array.from({ length: 40 }, (_, i) => ({ ...sale(1, 10), id: `d${i}` }))
    const tot = periodTotals(one, (e) => String(e.date).slice(0, 10))
    expect([...tot.values()]).toEqual([{ gave: 400, got: 0 }])
  })
  it('search: an amount (₹1,200 / 1200 / 1200.50), a bill number, a note, a date, a word', () => {
    expect(matchesSearch(sale(1, 1200), '1200', label)).toBe(true)
    expect(matchesSearch(sale(1, 1200), '₹1,200', label)).toBe(true)
    expect(matchesSearch(sale(1, 1200.5), '1200.50', label)).toBe(true)
    expect(matchesSearch(sale(1, 1200), '1300', label)).toBe(false)
    expect(matchesSearch(sale(42, 50), 'inv-0042', label)).toBe(true)
    expect(matchesSearch(pay(1, 300), 'diwali', label)).toBe(true)
    expect(matchesSearch(pay(1, 300), '12 oct', label)).toBe(true)
    expect(matchesSearch(pay(1, 300), 'got', label)).toBe(true)
  })
  it('filters: bills, payments, unpaid', () => {
    const all = [sale(1, 100, 0), sale(2, 200, 50), pay(3, 70)]
    expect(filterHistory(all, { filter: 'bills', q: '', label }).map((e) => e.id)).toEqual(['s1', 's2'])
    expect(filterHistory(all, { filter: 'payments', q: '', label }).map((e) => e.id)).toEqual(['p3'])
    expect(filterHistory(all, { filter: 'unpaid', q: '', label }).map((e) => e.id)).toEqual(['s2'])
  })
})

describe('the history card', () => {
  beforeEach(() => window.localStorage.clear())
  const many = Array.from({ length: 75 }, (_, i) => sale(i + 1, 100 + i))

  it('shows 30, then "Show older" adds 30 more', () => {
    render(<LocalHistory entries={many} t={t} balWords={(b) => `they owe ₹${b}`} onOpenBill={() => {}} />)
    expect(screen.getAllByText(/INV-\d{4}/).length).toBe(HISTORY_PAGE)
    fireEvent.click(screen.getByRole('button', { name: 'Show 30 older (45 more)' }))
    expect(screen.getAllByText(/INV-\d{4}/).length).toBe(60)
  })
  it('opens in the chat view; the ledger view is one tap and is remembered', () => {
    const { unmount } = render(<LocalHistory entries={many} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-history-view="chat"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    expect(document.querySelector('[data-history-view="ledger"]')).not.toBeNull()
    unmount()
    render(<LocalHistory entries={many} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-history-view="ledger"]')).not.toBeNull()
  })
  it('a search finds one bill among 75, and says so when nothing matches', () => {
    render(<LocalHistory entries={many} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    fireEvent.change(screen.getByLabelText('Search amount, bill no., note, date'), { target: { value: 'INV-0063' } })
    const found = screen.getAllByText(/INV-\d{4}/).map((n) => n.textContent)
    expect(found).toEqual(['INV-0063 · 2 items'])
    fireEvent.change(screen.getByLabelText('Search amount, bill no., note, date'), { target: { value: 'zzz' } })
    expect(screen.getByText('No entry matches “zzz”')).toBeTruthy()
  })
  it('every bubble says which way it went, and the key says what red and green mean', () => {
    render(<LocalHistory entries={[sale(1, 700), pay(2, 300)]} t={(k) => ({ ...words, 'bahi.you_gave': 'You gave', 'bahi.you_got': 'You got', 'bahi.bal': 'Bal.' } as Record<string, string>)[k] ?? k} balWords={() => ''} onOpenBill={() => {}} />)
    const dirs = Array.from(document.querySelectorAll('[data-direction]')).map((n) => n.getAttribute('data-direction'))
    expect(dirs.sort()).toEqual(['gave', 'got'])
    expect(document.querySelector('[data-history-key]')?.textContent).toContain('You gave')
    expect(document.querySelectorAll('[data-history-day]').length).toBeGreaterThan(0)
  })
  it('each month opens with its totals and the balance it closed on; the month totals come from the server, over the whole month', () => {
    const oct = { ...sale(1, 700), date: new Date(2026, 9, 20, 10).toISOString(), runningBalance: 1200 }
    const sep = { ...pay(2, 300), date: new Date(2026, 8, 5, 10).toISOString(), runningBalance: 500 }
    const tw = (k: string) => ({ ...words, 'bahi.month_close': 'Closed on: {v}', 'bahi.month_now': 'So far: {v}' } as Record<string, string>)[k] ?? k
    const onlyDate = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick'] as const
    // the month still running says "so far", never "closed on"
    jest.useFakeTimers({ now: new Date(2026, 9, 25, 12), doNotFake: [...onlyDate] })
    const running = render(<LocalHistory entries={[oct, sep]} t={tw} balWords={(b) => `owe ${b}`} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-history-month="2026-10"]')?.textContent).toContain('So far: owe 1200')
    expect(document.querySelector('[data-history-month="2026-09"]')?.textContent).toContain('Closed on: owe 500')
    running.unmount()
    jest.useFakeTimers({ now: new Date(2026, 10, 15, 12), doNotFake: [...onlyDate] })
    const { unmount } = render(<LocalHistory entries={[oct, sep]} t={tw} balWords={(b) => `owe ${b}`} onOpenBill={() => {}} />)
    const months = Array.from(document.querySelectorAll('[data-history-month]'))
    expect(months.map((m) => m.getAttribute('data-history-month'))).toEqual(['2026-10', '2026-09'])
    expect(months[0].textContent).toContain('₹700')
    expect(months[0].textContent).toContain('Closed on: owe 1200')
    expect(months[1].textContent).toContain('₹300')
    unmount()
    // The month's totals are the server's, over the whole month — not a sum of what is loaded.
    render(<LocalHistory entries={[oct, sep]} t={tw} balWords={(b) => `owe ${b}`} onOpenBill={() => {}} monthTotals={{ '2026-10': { gave: 9100, got: 2500 }, '2026-09': { gave: 0, got: 300 } }} />)
    const fromServer = Array.from(document.querySelectorAll('[data-history-month]'))
    expect(fromServer[0].textContent).toContain('₹9,100')
    expect(fromServer[0].textContent).toContain('₹2,500')
    jest.useRealTimers()
  })
  it('a day cut by "Show older" still shows the whole day in its header and month', () => {
    const one = Array.from({ length: 40 }, (_, i) => ({ ...sale(1, 10), id: `d${i}` }))
    render(<LocalHistory entries={one} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelectorAll('[data-direction]').length).toBe(HISTORY_PAGE)
    expect(document.querySelector('[data-history-day]')?.textContent).toContain('₹400')
    expect(document.querySelector('[data-history-month]')?.textContent).toContain('₹400')
  })
  it('a part-paid bill says what was paid on it, so the day total adds up on screen', () => {
    const b = { ...sale(1, 720, 632), delta: 632 }
    render(<LocalHistory entries={[b]} t={(k) => ({ ...words, 'bahi.paid_v': '{v} paid' } as Record<string, string>)[k] ?? k} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-direction]')?.textContent).toContain('₹88 paid')
    expect(document.querySelector('[data-history-day]')?.textContent).toContain('₹88')
  })
  it('in the bahi, money paid on a bill sits in the other column of the same line', () => {
    window.localStorage.setItem('bahikhata:party-history-view', 'ledger')
    const b = { ...sale(1, 720, 632), delta: 632 }
    render(<LocalHistory entries={[b]} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    const cells = Array.from(document.querySelectorAll('[data-history-view="ledger"] li button > span')).map((n) => n.textContent)
    expect(cells.slice(1)).toEqual(['₹720', '₹88'])
    // the detail line (bill no., items, time) wraps on a phone, never cut short with "…"
    const detail = Array.from(document.querySelectorAll('[data-history-view="ledger"] li button span')).find((n) => n.textContent?.startsWith('INV-0001 · 2 items'))
    expect(detail).toBeTruthy()
    expect(detail!.className).not.toMatch(/\btruncate\b/)
  })
  it('tapping a bill opens it', () => {
    const open = jest.fn()
    render(<LocalHistory entries={[sale(7, 250)]} t={t} balWords={() => ''} onOpenBill={open} />)
    fireEvent.click(screen.getByText(/INV-0007/))
    expect(open).toHaveBeenCalledWith('s7')
  })
})

describe('#327 Step B — the rules the database query is written from', () => {
  it('GAVE_ENTRY_TYPES is exactly the stored types whose direction is "gave"', () => {
    const stored = [
      { type: 'sale' }, { type: 'purchase' }, { type: 'credit-note' }, { type: 'debit-note' },
      { type: 'payment-received', isPayment: true }, { type: 'payment-paid', isPayment: true },
    ]
    const gave = stored.filter((s) => direction(historyKind(s)) === 'gave').map((s) => s.type)
    expect([...GAVE_ENTRY_TYPES].sort()).toEqual(gave.sort())
  })
  it('LEDGER_BILL_TYPES is exactly the bill types computePartyBalance sums', () => {
    const src: string = fs.readFileSync(path.join(process.cwd(), 'src/lib/party-balance.ts'), 'utf8')
    const summed = Array.from(src.matchAll(/where: \{ userId, partyId, type: '([a-z-]+)', deletedAt: null \}/g)).map((m) => m[1])
    expect(summed.length).toBe(4)
    expect([...LEDGER_BILL_TYPES].sort()).toEqual(summed.sort())
  })
})

describe('#327 Step B — the card asks the database for its pages', () => {
  const fetchMock = offlineFetch as jest.Mock
  const page = (entries: HistoryEntry[], nextCursor: string | null, total: number) =>
    ({ ok: true, json: async () => ({ entries, nextCursor, total, days: {}, months: {} }) })
  const mount = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PartyHistory partyId="p1" version={1} t={t} balWords={() => ''} onOpenBill={() => {}} />
    </QueryClientProvider>,
  )
  const urls = () => fetchMock.mock.calls.map((c) => new URL(String(c[0]), 'http://x'))
  beforeEach(() => { fetchMock.mockReset(); window.localStorage.clear() })

  it('30 at a time; "Show older" sends the cursor; the count of what is left comes from the server', async () => {
    fetchMock
      .mockResolvedValueOnce(page(Array.from({ length: 30 }, (_, i) => sale(i + 1, 100)), 'c1', 75))
      .mockResolvedValueOnce(page(Array.from({ length: 30 }, (_, i) => sale(i + 31, 100)), 'c2', 75))
    mount()
    await waitFor(() => expect(screen.getAllByText(/INV-\d{4}/).length).toBe(30))
    expect(urls()[0].pathname).toBe('/api/parties/p1/history')
    expect(urls()[0].searchParams.get('limit')).toBe('30')
    expect(urls()[0].searchParams.get('filter')).toBe('all')
    expect(urls()[0].searchParams.get('cursor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 30 older (45 more)' }))
    await waitFor(() => expect(screen.getAllByText(/INV-\d{4}/).length).toBe(60))
    expect(urls()[1].searchParams.get('cursor')).toBe('c1')
  })
  it('a filter and a search go to the server, with the shown words for each kind', async () => {
    fetchMock.mockResolvedValue(page([sale(1, 100)], null, 1))
    mount()
    await waitFor(() => expect(screen.getByText(/INV-0001/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
    await waitFor(() => expect(urls().some((u) => u.searchParams.get('filter') === 'payments')).toBe(true))
    fireEvent.change(screen.getByLabelText('Search amount, bill no., note, date'), { target: { value: 'diwali' } })
    await waitFor(() => expect(urls().some((u) => u.searchParams.get('q') === 'diwali')).toBe(true))
    expect(JSON.parse(urls()[0].searchParams.get('labels')!)).toMatchObject({ sale: 'Sale', got: 'Got payment' })
  })
  it('a failed load says so and offers to try again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) }).mockResolvedValueOnce(page([sale(1, 100)], null, 1))
    mount()
    await waitFor(() => expect(screen.getByText('bahi.load_failed')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'bahi.retry' }))
    await waitFor(() => expect(screen.getByText(/INV-0001/)).toBeTruthy())
  })
})
