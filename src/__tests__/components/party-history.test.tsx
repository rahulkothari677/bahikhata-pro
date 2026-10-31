/**
 * @jest-environment jsdom
 *
 * #327 / #328 (31 Oct): a customer's history — his June chat view back, 30 at a time,
 * with a search and filters so one entry among hundreds is easy to find.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { filterHistory, historyKind, matchesSearch, onRight, HISTORY_PAGE, type HistoryEntry } from '@/lib/party-history'
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
  it('what an entry is, and which side of the chat (his June design)', () => {
    expect(historyKind({ type: 'sale' })).toBe('sale')
    expect(historyKind({ type: 'payment-received', isPayment: true })).toBe('got')
    expect(historyKind({ type: 'payment-paid', isPayment: true })).toBe('gave')
    expect(['sale', 'got', 'return_out'].every((k) => onRight(k as any))).toBe(true)
    expect(['purchase', 'gave', 'return_in'].some((k) => onRight(k as any))).toBe(false)
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
    expect(found).toEqual(['· INV-0063'])
    fireEvent.change(screen.getByLabelText('Search amount, bill no., note, date'), { target: { value: 'zzz' } })
    expect(screen.getByText('No entry matches “zzz”')).toBeTruthy()
  })
  it('tapping a bill opens it', () => {
    const open = jest.fn()
    render(<PartyHistory entries={[sale(7, 250)]} t={t} balWords={() => ''} onOpenBill={open} />)
    fireEvent.click(screen.getByText(/INV-0007/))
    expect(open).toHaveBeenCalledWith('s7')
  })
})
