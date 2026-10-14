/**
 * One set of figures for Home's "Sales vs Purchases" card (#237, 14 Oct 2026).
 *
 * The card used to read three different things: the Purchases line showed
 * `totalPayable` (what the shop owes suppliers, a balance at today's date),
 * the difference subtracted `rangePurchases` (what was bought in the period),
 * and the colour was decided by sales − payable. On the local demo shop it read
 * Sales ₹6.16K · Purchases ₹1.5K · Net −₹11.7K, in green.
 *
 * The line, the difference and its colour now come from this one object, and
 * every figure belongs to the chosen period. Balances (to collect / to pay)
 * belong on their own cards, never in a period chart.
 */
export interface SalesVsPurchases {
  sales: number
  purchases: number
  /** Sales minus purchases for the period. Not profit: unsold stock is still the shop's. */
  difference: number
  differenceIsPositive: boolean
  empty: boolean
}

export function salesVsPurchases(kpis: { rangeRevenue?: number | null; rangePurchases?: number | null }): SalesVsPurchases {
  const sales = Number(kpis.rangeRevenue) || 0
  const purchases = Number(kpis.rangePurchases) || 0
  const difference = sales - purchases
  return { sales, purchases, difference, differenceIsPositive: difference >= 0, empty: sales === 0 && purchases === 0 }
}
