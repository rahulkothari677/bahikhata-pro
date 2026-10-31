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
  /** What the entry did to the balance (lib/statement-balance.ts — the one rule). */
  delta?: number
}

const money = (n: number) => Math.round(n * 100) / 100

/**
 * Money paid ON a bill when it was made ("₹250 sale, ₹90 paid at the counter"): the
 * bill's amount less what it added to the balance. Settlements made later are not in
 * it — those are their own payment entries, and counting them here would count the
 * same rupees twice (statement-balance.ts, AUDIT C5).
 */
export function paidOnBill(e: HistoryEntry): number {
  if (e.isPayment || e.delta == null) return 0
  return Math.max(0, money((Number(e.amount) || 0) - Math.abs(e.delta)))
}

export function historyKind(e: Pick<HistoryEntry, 'type' | 'isPayment'>): HistoryKind | null {
  if (e.isPayment) return e.type === 'payment-received' ? 'got' : 'gave'
  return ({ sale: 'sale', purchase: 'purchase', 'credit-note': 'return_in', 'debit-note': 'return_out' } as Record<string, HistoryKind>)[e.type] ?? null
}

/**
 * Which way it went, from the shop's side — the "You gave / You got" every ledger app
 * uses (31 Oct, Rahul: sale and payment must look different, with symbols for in and
 * out). GAVE: goods or money left the shop (a sale, a payment made, goods returned to
 * a supplier) — red, ↑, the right side of the chat like your own messages. GOT: came in
 * (a payment received, a purchase, goods returned by a customer) — green, ↓, left.
 */
export type HistoryDirection = 'gave' | 'got'
export function direction(kind: HistoryKind | null): HistoryDirection {
  return kind === 'sale' || kind === 'gave' || kind === 'return_out' ? 'gave' : 'got'
}
/**
 * The bill types that move a khata's balance — the four computePartyBalance
 * sums (lib/party-balance.ts). An estimate or a cash expense is not on it.
 */
export const LEDGER_BILL_TYPES = ['sale', 'purchase', 'credit-note', 'debit-note'] as const

/**
 * The stored entry types that are YOU GAVE, for SQL that must split gave/got in the
 * database (lib/party-history-query.ts). A test holds it equal to `direction` above.
 */
export const GAVE_ENTRY_TYPES = ['sale', 'debit-note', 'payment-paid'] as const

export function onRight(kind: HistoryKind | null): boolean {
  return direction(kind) === 'gave'
}

/**
 * A period's totals for its header: what was given and got, in rupees. A bill counts
 * whole on its side, and the money paid on it counts on the other — so a ₹250 sale
 * with ₹90 paid is "gave ₹250, got ₹90", and gave − got is exactly what the period
 * moved the balance (31 Oct: October showed got ₹1,750 while ₹597 paid at the counter
 * was missing, so the month did not add up to its closing balance).
 */
export function dayTotals(entries: HistoryEntry[]): { gave: number; got: number } {
  let gave = 0, got = 0
  for (const e of entries) {
    const a = Number(e.amount) || 0
    const paid = paidOnBill(e)
    if (direction(historyKind(e)) === 'gave') { gave += a; got += paid }
    else { got += a; gave += paid }
  }
  return { gave: money(gave), got: money(got) }
}

/**
 * Totals per period (a day, a month) over EVERY matching entry, not just the ones on
 * screen — a day cut in two by "Show older" must still show the whole day's total.
 */
export function periodTotals(entries: HistoryEntry[], keyOf: (e: HistoryEntry) => string): Map<string, { gave: number; got: number }> {
  const groups = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const k = keyOf(e)
    const g = groups.get(k)
    if (g) g.push(e)
    else groups.set(k, [e])
  }
  return new Map([...groups].map(([k, g]) => [k, dayTotals(g)]))
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
