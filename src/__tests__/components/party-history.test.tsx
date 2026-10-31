/**
 * @jest-environment jsdom
 *
 * #327 / #328 (31 Oct): a customer's history — his June chat view back, 30 at a time,
 * with a search and filters so one entry among hundreds is easy to find.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { filterHistory, historyKind, matchesSearch, onRight, direction, dayTotals, periodTotals, paidOnBill, HISTORY_PAGE, type HistoryEntry } from '@/lib/party-history'
import { computeStatementRunningBalance } from '@/lib/statement-balance'
import { PartyHistory } from '@/components/parties/PartyHistory'

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
    render(<PartyHistory entries={many} t={t} balWords={(b) => `they owe ₹${b}`} onOpenBill={() => {}} />)
    expect(screen.getAllByText(/INV-\d{4}/).length).toBe(HISTORY_PAGE)
    fireEvent.click(screen.getByRole('button', { name: 'Show 30 older (45 more)' }))
    expect(screen.getAllByText(/INV-\d{4}/).length).toBe(60)
  })
  it('opens in the chat view; the ledger view is one tap and is remembered', () => {
    const { unmount } = render(<PartyHistory entries={many} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-history-view="chat"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    expect(document.querySelector('[data-history-view="ledger"]')).not.toBeNull()
    unmount()
    render(<PartyHistory entries={many} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-history-view="ledger"]')).not.toBeNull()
  })
  it('a search finds one bill among 75, and says so when nothing matches', () => {
    render(<PartyHistory entries={many} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    fireEvent.change(screen.getByLabelText('Search amount, bill no., note, date'), { target: { value: 'INV-0063' } })
    const found = screen.getAllByText(/INV-\d{4}/).map((n) => n.textContent)
    expect(found).toEqual(['INV-0063 · 2 items'])
    fireEvent.change(screen.getByLabelText('Search amount, bill no., note, date'), { target: { value: 'zzz' } })
    expect(screen.getByText('No entry matches “zzz”')).toBeTruthy()
  })
  it('every bubble says which way it went, and the key says what red and green mean', () => {
    render(<PartyHistory entries={[sale(1, 700), pay(2, 300)]} t={(k) => ({ ...words, 'bahi.you_gave': 'You gave', 'bahi.you_got': 'You got', 'bahi.bal': 'Bal.' } as Record<string, string>)[k] ?? k} balWords={() => ''} onOpenBill={() => {}} />)
    const dirs = Array.from(document.querySelectorAll('[data-direction]')).map((n) => n.getAttribute('data-direction'))
    expect(dirs.sort()).toEqual(['gave', 'got'])
    expect(document.querySelector('[data-history-key]')?.textContent).toContain('You gave')
    expect(document.querySelectorAll('[data-history-day]').length).toBeGreaterThan(0)
  })
  it('each month opens with its totals and the balance it closed on; a capped oldest month shows no short total', () => {
    const oct = { ...sale(1, 700), date: new Date(2026, 9, 20, 10).toISOString(), runningBalance: 1200 }
    const sep = { ...pay(2, 300), date: new Date(2026, 8, 5, 10).toISOString(), runningBalance: 500 }
    const tw = (k: string) => ({ ...words, 'bahi.month_close': 'Closed on: {v}', 'bahi.month_now': 'So far: {v}' } as Record<string, string>)[k] ?? k
    const onlyDate = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick'] as const
    // the month still running says "so far", never "closed on"
    jest.useFakeTimers({ now: new Date(2026, 9, 25, 12), doNotFake: [...onlyDate] })
    const running = render(<PartyHistory entries={[oct, sep]} t={tw} balWords={(b) => `owe ${b}`} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-history-month="2026-10"]')?.textContent).toContain('So far: owe 1200')
    expect(document.querySelector('[data-history-month="2026-09"]')?.textContent).toContain('Closed on: owe 500')
    running.unmount()
    jest.useFakeTimers({ now: new Date(2026, 10, 15, 12), doNotFake: [...onlyDate] })
    const { unmount } = render(<PartyHistory entries={[oct, sep]} t={tw} balWords={(b) => `owe ${b}`} onOpenBill={() => {}} />)
    const months = Array.from(document.querySelectorAll('[data-history-month]'))
    expect(months.map((m) => m.getAttribute('data-history-month'))).toEqual(['2026-10', '2026-09'])
    expect(months[0].textContent).toContain('₹700')
    expect(months[0].textContent).toContain('Closed on: owe 1200')
    expect(months[1].textContent).toContain('₹300')
    unmount()
    render(<PartyHistory entries={[oct, sep]} t={tw} balWords={(b) => `owe ${b}`} onOpenBill={() => {}} notice={<p>latest only</p>} />)
    const capped = Array.from(document.querySelectorAll('[data-history-month]'))
    expect(capped[0].textContent).toContain('₹700')
    expect(capped[1].textContent).not.toContain('₹')
    jest.useRealTimers()
  })
  it('a day cut by "Show older" still shows the whole day in its header and month', () => {
    const one = Array.from({ length: 40 }, (_, i) => ({ ...sale(1, 10), id: `d${i}` }))
    render(<PartyHistory entries={one} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelectorAll('[data-direction]').length).toBe(HISTORY_PAGE)
    expect(document.querySelector('[data-history-day]')?.textContent).toContain('₹400')
    expect(document.querySelector('[data-history-month]')?.textContent).toContain('₹400')
  })
  it('a part-paid bill says what was paid on it, so the day total adds up on screen', () => {
    const b = { ...sale(1, 720, 632), delta: 632 }
    render(<PartyHistory entries={[b]} t={(k) => ({ ...words, 'bahi.paid_v': '{v} paid' } as Record<string, string>)[k] ?? k} balWords={() => ''} onOpenBill={() => {}} />)
    expect(document.querySelector('[data-direction]')?.textContent).toContain('₹88 paid')
    expect(document.querySelector('[data-history-day]')?.textContent).toContain('₹88')
  })
  it('in the bahi, money paid on a bill sits in the other column of the same line', () => {
    window.localStorage.setItem('bahikhata:party-history-view', 'ledger')
    const b = { ...sale(1, 720, 632), delta: 632 }
    render(<PartyHistory entries={[b]} t={t} balWords={() => ''} onOpenBill={() => {}} />)
    const cells = Array.from(document.querySelectorAll('[data-history-view="ledger"] li button > span')).map((n) => n.textContent)
    expect(cells.slice(1)).toEqual(['₹720', '₹88'])
  })
  it('tapping a bill opens it', () => {
    const open = jest.fn()
    render(<PartyHistory entries={[sale(7, 250)]} t={t} balWords={() => ''} onOpenBill={open} />)
    fireEvent.click(screen.getByText(/INV-0007/))
    expect(open).toHaveBeenCalledWith('s7')
  })
})
