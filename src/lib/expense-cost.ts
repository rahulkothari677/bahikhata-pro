/**
 * 9c-3 (#159; master plan C18, approved by Rahul 13 Nov 2026): what an expense
 * COSTS the shop — the one rule every "Expenses" figure reads.
 *
 * An expense row keeps two amounts:
 *   totalAmount — the cash that left: the bill, GST included. Cashbook, party
 *                 balances and the day's money read this.
 *   subtotal    — the cost: the bill before GST that a regular shop claims back
 *                 as input credit. Profit and every "Expenses" figure read this.
 *
 * For every expense saved before 9c-3, and for any expense of a not-registered
 * or composition shop, the two are equal (the GST is part of the cost), so
 * switching the readers moves no existing figure. Same principle as a purchase's
 * cost for a regular shop (#175, lib/unit-profit.ts): GST the shop gets back is
 * not a cost. ₹1,000 rent + ₹180 GST: ₹1,000 in profit, ₹1,180 in cash.
 */

import { roundMoney, splitGst } from '@/lib/money'
import type { GstStatus } from '@/lib/shop-tax'

/** An expense bill with GST, as typed. */
export interface ExpenseGstInput {
  /** The bill's amount before GST. */
  amountBeforeGst: number
  /** The bill's GST rate, %. */
  rate: number
  /** Supplier in another state (IGST) — from the place of supply. */
  interState: boolean
  /** The supplier charged no GST; the shop pays it (9c-2 cases, lib/rcm-cases.ts). */
  reverseCharge: boolean
}

/** May this shop give an expense GST details? Only a regular one claims GST back (s.16; s.10(4)). */
export const expenseTakesGst = (shop: GstStatus) => shop === 'regular'

/**
 * 9c-3: what a REGULAR shop's expense with a GST bill stores. The GST is split
 * out because the shop claims it back. Other shops never call this: their
 * expense is one amount, GST included (the API refuses GST details from them,
 * since a composition shop's reverse charge is a CMP-08 matter not modelled here).
 *
 *   ₹1,000 at 18%, same state:   subtotal 1000, cgst 90, sgst 90, total 1180
 *   ₹1,000 at 18%, other state:  subtotal 1000, igst 180, total 1180
 *   reverse charge:              subtotal 1000, tax 180 owed (3.1(d)), total 1000 paid
 */
export function expenseAmounts(input: ExpenseGstInput): {
  subtotal: number; cgst: number; sgst: number; igst: number; totalAmount: number; isReverseCharge: boolean
} {
  const base = roundMoney(Math.max(0, input.amountBeforeGst))
  const tax = roundMoney(base * Math.max(0, input.rate) / 100)
  const split = input.interState ? { cgst: 0, sgst: 0, igst: tax } : { ...splitGst(tax), igst: 0 }
  return {
    subtotal: base,
    ...split,
    totalAmount: input.reverseCharge ? base : roundMoney(base + tax),
    isReverseCharge: input.reverseCharge,
  }
}

/**
 * 9c-3: the bill types whose GST is the shop's input credit or reverse-charge
 * tax — one list, read by GSTR-3B and the GSTR-2B claim. An expense with no
 * GST adds nothing, so listing it is safe for every old expense.
 */
export const INWARD_TAX_TYPES: string[] = ['purchase', 'expense']

/** The column an expense's cost lives in — for raw SQL readers. */
export const EXPENSE_COST_COLUMN = 'subtotal' as const

/** An expense's cost from a row or a summed row (`_sum`). */
export function expenseCost(row: { subtotal?: number | null } | null | undefined): number {
  return row?.subtotal ?? 0
}
