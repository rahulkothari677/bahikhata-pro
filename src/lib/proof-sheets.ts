/**
 * "How is this worked out?" — the lines behind a number on Home (Phase 5b-1).
 *
 * Hard rule: every figure shows receipts. A shopkeeper taps "Today's sales
 * ₹8,460" and sees what it is made of: what came in at the counter by mode,
 * what went on udhaar, what was returned. The lines ADD UP to the number;
 * that is the one property every builder here guarantees, and the guard
 * (proof-sheets.test.ts) checks it on good and bad input.
 *
 * These are pure functions over sums the database already made (groupBy /
 * aggregate in /api/dashboard/explain, or the day-summary route's own drawer
 * terms). Nothing here reads rows, so a shop with ten years of bills gets the
 * same answer, only slower to fetch.
 *
 * Money is added in paise (whole numbers), never in floating rupees, so
 * ₹0.10 + ₹0.20 cannot drift to ₹0.30000000000000004 and break "adds up".
 */
import { roundMoney } from './money'

/** One line. `key` is an i18n key (the client translates); `label` is a plain name such as a party. */
export interface ProofRow {
  key?: string
  label?: string
  /** Numbers for the key's placeholders, e.g. { n: 12 } in "and {n} more". */
  params?: Record<string, number | string>
  /** A payment mode code ('cash', 'upi', …) shown after a plain label: "Deepak Kumar · UPI". */
  mode?: string
  /** A date shown after the label: "Transport · 13 Oct" (ISO string). */
  date?: string
  /** Quantity × cost shown under the label: "33 pcs × ₹241.50" (stock value). */
  qty?: number
  unit?: string
  each?: number
  amount: number
}

export interface Proof {
  total: number
  rows: ProofRow[]
}

const paise = (rupees: number) => Math.round((Number(rupees) || 0) * 100)
const rupees = (p: number) => roundMoney(p / 100)

/** The rows' sum in paise minus the total in paise: 0 when the sheet adds up. */
export function proofGap(p: Proof): number {
  return p.rows.reduce((s, r) => s + paise(r.amount), 0) - paise(p.total)
}

/** Fixed order and names for payment modes; anything else is grouped as "Other". */
export const PROOF_MODES = ['cash', 'upi', 'card', 'bank'] as const

// ─── Sales ──────────────────────────────────────────────────────────────

export interface SalesGroup {
  type: string            // 'sale' | 'credit-note' (others ignored)
  paymentMode: string | null
  total: number           // Σ totalAmount (the bill value)
  paid: number            // Σ paidAmount (what changed hands at billing)
  count: number
}

/**
 * Sales = bills − returns, the same definition as Home's figure (dashboard
 * route: sale totalAmount minus credit-note totalAmount).
 *
 * Lines: what was paid at the counter, by mode (paidAmount, never the bill
 * value — a ₹600 cash bill with ₹200 paid is ₹200 cash and ₹400 udhaar);
 * then what is still on udhaar; then returns as a minus.
 */
export function salesProof(groups: SalesGroup[]): Proof & { bills: number } {
  const sales = groups.filter((g) => g.type === 'sale')
  const returns = groups.filter((g) => g.type === 'credit-note')
  const byMode = new Map<string, number>()
  let billPaise = 0
  let paidPaise = 0
  let bills = 0
  for (const g of sales) {
    const mode = (PROOF_MODES as readonly string[]).includes(g.paymentMode ?? '') ? g.paymentMode! : 'other'
    byMode.set(mode, (byMode.get(mode) ?? 0) + paise(g.paid))
    billPaise += paise(g.total)
    paidPaise += paise(g.paid)
    bills += g.count
  }
  const returnPaise = returns.reduce((s, g) => s + paise(g.total), 0)
  const rows: ProofRow[] = []
  for (const mode of [...PROOF_MODES, 'other']) {
    const p = byMode.get(mode) ?? 0
    if (p !== 0) rows.push({ key: `proof.paid_${mode}`, amount: rupees(p) })
  }
  const udhaar = billPaise - paidPaise
  if (udhaar !== 0) rows.push({ key: udhaar > 0 ? 'proof.on_udhaar' : 'proof.paid_extra', amount: rupees(udhaar) })
  if (returnPaise !== 0) rows.push({ key: 'proof.returns', amount: rupees(-returnPaise) })
  return { total: rupees(billPaise - returnPaise), rows, bills }
}

// ─── Profit ─────────────────────────────────────────────────────────────

/**
 * The goods lines of a profit sheet.
 *
 * A line with no product behind it (typed in at the counter) has no cost
 * price, so the sale books ₹0 profit on it (lib/line-items.ts). Shown as
 * "what those goods cost you" it would claim a cost nobody entered, so those
 * lines get their own row: their sales value, then taken off as "profit not
 * counted". Found on the local copy, 14 Oct: two typed-in items showed
 * "What those goods cost you ₹1,100".
 */
function goodsRows(f: { netSales: number; profit: number; noCost?: number }): ProofRow[] {
  const noCost = paise(f.noCost ?? 0)
  const costed = paise(f.netSales) - noCost
  const cost = paise(f.profit) - costed
  const rows: ProofRow[] = [{ key: 'proof.net_sales', amount: rupees(paise(f.netSales)) }]
  if (cost !== 0 || costed !== 0) rows.push({ key: 'proof.cost', amount: rupees(cost) })
  if (noCost !== 0) rows.push({ key: 'proof.no_cost', amount: rupees(-noCost) })
  return rows
}

/**
 * Profit = sales before GST − what those goods cost you (#134: profit is on
 * the price before GST; the GST is not the shop's). Expenses are not taken
 * off here — that is Net profit. `noCost` = sales of lines with no cost price.
 */
export function profitProof(f: { netSales: number; profit: number; noCost?: number }): Proof {
  return { total: rupees(paise(f.profit)), rows: goodsRows(f) }
}

/** Net profit = profit on goods + other income − expenses (the dashboard route's netProfit). */
export function netProfitProof(f: { netSales: number; profit: number; noCost?: number; income: number; expenses: number }): Proof {
  const rows = goodsRows(f)
  if (paise(f.income) !== 0) rows.push({ key: 'proof.other_income', amount: rupees(paise(f.income)) })
  if (paise(f.expenses) !== 0) rows.push({ key: 'proof.expenses', amount: rupees(-paise(f.expenses)) })
  return { total: rupees(paise(f.profit) + paise(f.income) - paise(f.expenses)), rows }
}

// ─── Purchases ──────────────────────────────────────────────────────────

/**
 * Purchases = the bill value of purchases in the period (Home's figure:
 * purchase totalAmount), split into what was paid at billing and what is
 * still to pay on those bills.
 */
export function purchasesProof(f: { total: number; paid: number }): Proof {
  const total = paise(f.total)
  const paid = paise(f.paid)
  const rows: ProofRow[] = []
  if (paid !== 0) rows.push({ key: 'proof.purchase_paid', amount: rupees(paid) })
  if (total - paid !== 0) rows.push({ key: 'proof.purchase_due', amount: rupees(total - paid) })
  return { total: rupees(total), rows }
}

// ─── Lists (payments, expenses, stock) ──────────────────────────────────

/**
 * A list of entries that may be cut short. When the database had more
 * entries than were fetched, the last line is "and N more" carrying the
 * remainder, so the lines still add up AND the screen says the list is
 * partial (a silent cap is a lie with a number on it).
 */
export function listProof(items: ProofRow[], total: number, count: number): Proof {
  const rows = [...items]
  const shownPaise = items.reduce((s, r) => s + paise(r.amount), 0)
  const rest = paise(total) - shownPaise
  if (count > items.length || rest !== 0) {
    rows.push({ key: 'proof.more', params: { n: Math.max(count - items.length, 0) }, amount: rupees(rest) })
  }
  return { total: rupees(paise(total)), rows }
}

// ─── Cash in drawer ─────────────────────────────────────────────────────

/** The day-summary route's drawer terms (all cash mode, all money that changed hands). */
export interface DrawerTerms {
  cashInFromSales: number
  cashIncome: number
  udhaarCollectedCash: number
  cashRefundsIn: number
  cashOutForPurchases: number
  cashExpenses: number
  udhaarPaidCash: number
  cashRefundsOut: number
}

/** The eight terms, in the order and with the signs of day-summary's expectedCash. */
export const DRAWER_TERMS: { field: keyof DrawerTerms; sign: 1 | -1; key: string }[] = [
  { field: 'cashInFromSales', sign: 1, key: 'proof.drawer_sales' },
  { field: 'udhaarCollectedCash', sign: 1, key: 'proof.drawer_collected' },
  { field: 'cashIncome', sign: 1, key: 'proof.drawer_income' },
  { field: 'cashRefundsIn', sign: 1, key: 'proof.drawer_refunds_in' },
  { field: 'cashOutForPurchases', sign: -1, key: 'proof.drawer_purchases' },
  { field: 'cashExpenses', sign: -1, key: 'proof.drawer_expenses' },
  { field: 'udhaarPaidCash', sign: -1, key: 'proof.drawer_paid' },
  { field: 'cashRefundsOut', sign: -1, key: 'proof.drawer_refunds_out' },
]

/**
 * Cash in drawer today, from today's entries. There is no opening cash yet
 * (saving the counted cash is Phase 9), so this is the change since
 * midnight, and the sheet says so.
 */
export function drawerProof(d: DrawerTerms): Proof {
  let totalPaise = 0
  const rows: ProofRow[] = []
  for (const t of DRAWER_TERMS) {
    const p = t.sign * paise(d[t.field])
    totalPaise += p
    if (p !== 0) rows.push({ key: t.key, amount: rupees(p) })
  }
  return { total: rupees(totalPaise), rows }
}
