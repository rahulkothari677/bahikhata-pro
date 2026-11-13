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

/** The column an expense's cost lives in — for raw SQL readers. */
export const EXPENSE_COST_COLUMN = 'subtotal' as const

/** An expense's cost from a row or a summed row (`_sum`). */
export function expenseCost(row: { subtotal?: number | null } | null | undefined): number {
  return row?.subtotal ?? 0
}
