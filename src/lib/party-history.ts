/**
 * A customer's or supplier's history: what each entry is, which side of the chat it
 * sits on, and finding one among hundreds (#327, #328 — 31 Oct 2026).
 *
 * Rahul: "if a customer have 100 or 1000s transactions then first there will be 1000s
 * lines … also it's hard to find any particular entry. also you removed whatsapp style
 * transactions history". The page now shows 30 entries at a time, in his June chat
 * view (or the ledger lines), with a search and four filters. The rules are here, pure,
 * so the screen and its tests read one definition.
 */

export type HistoryKind = 'sale' | 'purchase' | 'return_in' | 'return_out' | 'got' | 'gave'
export type HistoryFilter = 'all' | 'bills' | 'payments' | 'unpaid'
export const HISTORY_FILTERS: HistoryFilter[] = ['all', 'bills', 'payments', 'unpaid']
export const HISTORY_PAGE = 30

export interface HistoryEntry {
  id: string
  type: string
  isPayment?: boolean
  date: string | Date
  amount: number
  due?: number
  invoiceNo?: string | null
  itemCount?: number
  paymentMode?: string | null
  notes?: string | null
  runningBalance: number
}

export function historyKind(e: Pick<HistoryEntry, 'type' | 'isPayment'>): HistoryKind | null {
  if (e.isPayment) return e.type === 'payment-received' ? 'got' : 'gave'
  return ({ sale: 'sale', purchase: 'purchase', 'credit-note': 'return_in', 'debit-note': 'return_out' } as Record<string, HistoryKind>)[e.type] ?? null
}

/**
 * Right side of the chat — his June design: sales, payments received and supplier
 * returns (money or goods owed TO the shop) on the right; purchases, payments made
 * and customer returns on the left.
 */
export function onRight(kind: HistoryKind | null): boolean {
  return kind === 'sale' || kind === 'got' || kind === 'return_out'
}

export function matchesFilter(e: HistoryEntry, f: HistoryFilter): boolean {
  if (f === 'all') return true
  if (f === 'payments') return !!e.isPayment
  if (f === 'bills') return !e.isPayment
  return !e.isPayment && (e.due ?? 0) > 0.004
}

const digitsOnly = (s: string) => s.replace(/[^\d.]/g, '')

/**
 * Every word of the search must match something on the entry: its amount (₹1,200,
 * 1200 or 1200.00), bill number, note, payment mode, what it was ("sale", "got"),
 * or its date (12/10/2026, 12 Oct, Oct). `label` turns a kind into the shown word.
 */
export function matchesSearch(e: HistoryEntry, q: string, label: (k: HistoryKind) => string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const d = new Date(e.date)
  const kind = historyKind(e)
  const hay = [
    e.invoiceNo, e.notes, e.paymentMode, kind ? label(kind) : e.type, e.type,
    d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  ].filter(Boolean).join(' ').toLowerCase()
  const amount = Number(e.amount) || 0
  return words.every((w) => {
    const n = digitsOnly(w)
    if (n && /^[₹\d.,]+$/.test(w)) {
      const asNum = Number(n)
      // an amount: the whole rupee figure or the exact paise
      return Math.abs(asNum - amount) < 0.005 || String(Math.round(amount)) === n || hay.includes(w)
    }
    return hay.includes(w)
  })
}

export function filterHistory(entries: HistoryEntry[], opts: { filter: HistoryFilter; q: string; label: (k: HistoryKind) => string }): HistoryEntry[] {
  return entries.filter((e) => matchesFilter(e, opts.filter) && matchesSearch(e, opts.q, opts.label))
}
