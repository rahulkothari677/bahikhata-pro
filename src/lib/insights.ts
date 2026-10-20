/**
 * Insights — the pure group builders (Phase 5c, ledger model v4 §2–3).
 *
 * "The whole first. Groups, not sentences." Every item, customer and rupee of
 * udhaar lands in exactly ONE group, so the groups add up to the whole and the
 * shares add up to 100%. The database does the counting (/api/insights); these
 * functions only arrange numbers it already summed, so they are tested on good
 * and bad input and swept at random (insights.test.ts).
 *
 * Money is handled in paise (whole numbers). Shares are whole percents chosen
 * by the largest-remainder method, so they add to exactly 100 — never 99 or
 * 101 from rounding each one on its own.
 */
import { getISTDateParts } from './timezone'

const paise = (r: number) => Math.round((Number(r) || 0) * 100)
const rupees = (p: number) => Math.round(p) / 100

/**
 * Whole-percent shares of `values` that add to exactly 100 (largest remainder).
 * Negative or zero values get 0%. All zero → all 0 (nothing to share).
 */
export function shares(values: number[]): number[] {
  const v = values.map((x) => Math.max(0, paise(x)))
  const total = v.reduce((s, x) => s + x, 0)
  if (total === 0) return v.map(() => 0)
  const raw = v.map((x) => (x * 100) / total)
  const floor = raw.map(Math.floor)
  let left = 100 - floor.reduce((s, x) => s + x, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    if (v[i] > 0) { floor[i] += 1; left -= 1 }
  }
  return floor
}

// ─── Items: ABC (Pareto) ────────────────────────────────────────────────

export interface ItemSales { id: string; name: string; sales: number }
export interface Group { id: string; count: number; amount: number; share: number }

/**
 * ABC analysis, as retailers use it: sort items by sales; A are the items that
 * bring the first 80% of sales (the item that crosses 80% is in A), B the next
 * 15% (to 95%), C the rest that sold. Items with no positive sale in the period
 * are "none". Every item of the shop lands in exactly one group.
 */
export const ABC_EDGES = { a: 80, b: 95 } as const

export function abcGroups(items: ItemSales[], totalItems: number): { groups: Group[]; classOf: Map<string, 'a' | 'b' | 'c' | 'none'> } {
  const selling = items.filter((x) => paise(x.sales) > 0).sort((x, y) => paise(y.sales) - paise(x.sales) || x.name.localeCompare(y.name))
  const total = selling.reduce((s, x) => s + paise(x.sales), 0)
  const classOf = new Map<string, 'a' | 'b' | 'c' | 'none'>()
  let run = 0
  for (const it of selling) {
    const before = total === 0 ? 100 : (run * 100) / total
    const cls = before < ABC_EDGES.a ? 'a' : before < ABC_EDGES.b ? 'b' : 'c'
    classOf.set(it.id, cls)
    run += paise(it.sales)
  }
  const sum = (c: 'a' | 'b' | 'c') => selling.filter((x) => classOf.get(x.id) === c)
  const amounts = (['a', 'b', 'c'] as const).map((c) => sum(c).reduce((s, x) => s + paise(x.sales), 0))
  const pct = shares(amounts.map(rupees))
  const groups: Group[] = (['a', 'b', 'c'] as const).map((c, i) => ({ id: c, count: sum(c).length, amount: rupees(amounts[i]), share: pct[i] }))
  groups.push({ id: 'none', count: Math.max(0, totalItems - selling.length), amount: 0, share: 0 })
  return { groups, classOf }
}

// ─── Customers: groups by how they buy ──────────────────────────────────

export interface CustomerActivity {
  id: string
  billsNow: number      // sale bills in the period
  salesNow: number
  billsPrev: number     // sale bills in the period before (same length)
  salesPrev: number
  firstBill: Date | null // first sale bill ever
}

/** Bills in the period that make a customer "Regular". */
export const REGULAR_MIN_BILLS = 3

/**
 * Each customer in exactly one group, checked in this order:
 *  new        — first bill ever is inside the period
 *  regular    — 3 or more bills in the period
 *  occasional — 1 or 2 bills in the period
 *  quiet      — no bill in the period, but bought in the period before
 *  inactive   — no bill in either (including never bought)
 * Amounts: sales in the period; for "quiet", what they bought in the period before.
 */
export const CUSTOMER_GROUPS = ['new', 'regular', 'occasional', 'quiet', 'inactive'] as const
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number]

/**
 * Which group one customer is in — the ONE rule Insights' Customers groups and
 * Khata's Regular / Gone quiet / New chips share (Phase 5e-4), so "Gone quiet 14"
 * in Insights opens a Khata chip of exactly those 14. A customer with no bill in
 * either period is not in the activity rows at all: "inactive".
 */
export function customerGroupOf(r: Pick<CustomerActivity, 'billsNow' | 'billsPrev' | 'firstBill'>, from: Date): CustomerGroup {
  return r.firstBill && r.firstBill >= from && r.billsNow > 0 ? 'new'
    : r.billsNow >= REGULAR_MIN_BILLS ? 'regular'
    : r.billsNow > 0 ? 'occasional'
    : r.billsPrev > 0 ? 'quiet'
    : 'inactive'
}

export function customerGroups(rows: CustomerActivity[], from: Date): Group[] {
  const ids = CUSTOMER_GROUPS
  const acc = Object.fromEntries(ids.map((k) => [k, { count: 0, amount: 0 }])) as Record<(typeof ids)[number], { count: number; amount: number }>
  for (const r of rows) {
    const k = customerGroupOf(r, from)
    acc[k].count += 1
    acc[k].amount += paise(k === 'quiet' ? r.salesPrev : r.salesNow)
  }
  // Shares are of this period's sales, so only the three groups that bought now share them.
  const now: string[] = ['new', 'regular', 'occasional']
  const pct = shares(now.map((k) => rupees(acc[k as 'new'].amount)))
  return ids.map((k) => ({ id: k, count: acc[k].count, amount: rupees(acc[k].amount), share: now.includes(k) ? pct[now.indexOf(k)] : 0 }))
}

// ─── Udhaar: how old it is ──────────────────────────────────────────────

/** Days between two instants in IST calendar days (a bill from yesterday 23:00 is 1 day old at 00:30). */
export function istDaysBetween(earlier: Date, later: Date): number {
  const a = getISTDateParts(earlier)
  const b = getISTDateParts(later)
  return Math.round((Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / 86_400_000)
}

export const UDHAAR_EDGES = [15, 30, 60] as const

export interface Balance { id: string; balance: number; oldestUnpaid: Date | null }

/**
 * The whole receivable split by age: each customer who owes you (balance > 0)
 * is placed, whole balance, by their oldest unpaid bill (the Debt Aging rule —
 * per-bill ageing needs per-bill allocation, which old payments lack). A balance
 * with no unpaid bill on record (an opening balance) gets its own group rather
 * than being called "new". Buckets: 0–15, 16–30, 31–60, over 60 days.
 */
export const AGE_BANDS = ['d15', 'd30', 'd60', 'over', 'opening'] as const
export type AgeBand = (typeof AGE_BANDS)[number]

/**
 * How old one customer's udhaar is, by their oldest unpaid bill (days, IST) —
 * the ONE rule Insights' age bars and Khata's age chips share. No unpaid bill
 * (the balance is an opening balance) → "opening".
 */
export function ageBandOf(oldestDays: number | null): AgeBand {
  if (oldestDays === null) return 'opening'
  return oldestDays <= UDHAAR_EDGES[0] ? 'd15' : oldestDays <= UDHAAR_EDGES[1] ? 'd30' : oldestDays <= UDHAAR_EDGES[2] ? 'd60' : 'over'
}

export function udhaarAge(rows: Balance[], now: Date): Group[] {
  const ids = AGE_BANDS
  const acc = Object.fromEntries(ids.map((k) => [k, { count: 0, amount: 0 }])) as Record<(typeof ids)[number], { count: number; amount: number }>
  for (const r of rows) {
    if (paise(r.balance) <= 0) continue
    const k = ageBandOf(r.oldestUnpaid ? istDaysBetween(r.oldestUnpaid, now) : null)
    acc[k].count += 1
    acc[k].amount += paise(r.balance)
  }
  const pct = shares(ids.map((k) => rupees(acc[k].amount)))
  return ids.map((k, i) => ({ id: k, count: acc[k].count, amount: rupees(acc[k].amount), share: pct[i] }))
}

// ─── Any split by name (payment modes, categories) ──────────────────────

/** Rows sorted largest first with shares adding to 100; rows of zero or less left out (a bar cannot show a minus). */
export function split(rows: { id: string; amount: number; count?: number }[]): Group[] {
  const kept = rows.filter((r) => paise(r.amount) > 0).sort((a, b) => paise(b.amount) - paise(a.amount) || a.id.localeCompare(b.id))
  const pct = shares(kept.map((r) => r.amount))
  return kept.map((r, i) => ({ id: r.id, count: r.count ?? 0, amount: rupees(paise(r.amount)), share: pct[i] }))
}

// ─── Rows that must add up to a figure shown elsewhere ──────────────────

/** Row id for the part of a total that no row accounts for. */
export const UNMATCHED = '__unmatched'
/** Row id for lines typed in at the counter: no item behind them, so no cost price and no profit booked. */
export const TYPED_IN = '__typed'

/**
 * What is left of `total` after `parts`, to the paisa — 0 when they agree.
 *
 * Group rows are summed from bill LINES; the total beside them comes from the
 * bills themselves, the figure Home shows. Bills the app writes agree to the
 * paisa, because lib/line-items.ts builds the lines and the bill together.
 * Bills that did not come through it may not: the old demo-data maker wrote
 * its own (no cost on the lines, the bill discount not split — found 19 Oct).
 * A gap shows as its own row; it is never spread over the others or dropped.
 */
export function remainder(total: number, parts: number[]): number {
  return rupees(paise(total) - parts.reduce((s, x) => s + paise(x), 0))
}
