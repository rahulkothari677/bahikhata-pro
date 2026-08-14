/**
 * #70 part 2 — how the customer and product-profit answers READ.
 *
 * Pure functions, for the reason #76 taught this morning: a rule that lives
 * inside an API route cannot be called with a known-good and a known-bad
 * input, and four of the five broken guards this week were exactly that.
 *
 * The database decides what the answer IS. This decides only how it reads.
 */

/**
 * Does this question return a PROFIT figure, and therefore need the staff
 * profit permission checked before the database is even asked?
 *
 * A pure function on purpose. The alternative — an `if` buried in a switch
 * case — can only be checked by reading the code and believing it, and this
 * is a permission: the thing least safe to take on trust. Here it can be
 * called with every combination, which is what the test below does.
 *
 * `top_customers` is the interesting one, because ONE capability answers two
 * questions. "Who buys the most" is not a profit figure and staff may see it.
 * "Who is most profitable" is, and they may not.
 */
export function needsProfitPermission(
  intent: string,
  rankBy?: 'amount' | 'profit',
): boolean {
  if (intent === 'product_profit') return true
  if (intent === 'top_customers') return rankBy === 'profit'
  return false
}

export interface RankedCustomer {
  id: string
  name: string
  /** What they bought in the period, in RUPEES, net of returns. */
  amount: number
  /** What they left behind after cost, in RUPEES. Absent when profit is hidden. */
  profit?: number
  /** How many bills. */
  bills: number
}

export interface RankAnswer {
  headline: string
  detail: string
}

/**
 * NOBODY BOUGHT ANYTHING is a fact, not a zero.
 *
 * Rahul's instruction for this task, in his words: "say when a customer bought
 * nothing rather than showing ₹0". Crowning a "best customer" who spent ₹0 is
 * the same shape as the bug where a spoken item was added at ₹0 and the toast
 * still said "Added 2 items" — a success message over a line worth nothing.
 */
export function nobodyBought(customers: RankedCustomer[]): boolean {
  return customers.length === 0 || customers.every(c => c.amount <= 0)
}

export function customerRankAnswer(
  customers: RankedCustomer[],
  byProfit: boolean,
  label: string,
  money: (n: number) => string,
  totalBuyers: number,
): RankAnswer {
  if (nobodyBought(customers)) {
    return {
      headline: `No customer bought anything ${label}`,
      detail: 'There are no sales to a named customer in this period, so there is nobody to rank.',
    }
  }

  const top = customers[0]

  /*
   * The two questions share a sentence shape and mean different things.
   * "Best customer" is who spends most with you. "Most profitable" is who
   * leaves the most behind — and a shop's biggest spender is very often not
   * its most profitable one, which is the entire reason to ask separately.
   */
  const headline = byProfit
    ? `${top.name} left the most profit ${label}`
    : `${top.name} bought the most ${label}`

  const shown = customers.length
  const showing = totalBuyers > shown ? `Top ${shown} of ${totalBuyers} customers who bought. ` : ''

  const detail = byProfit
    ? `${money(top.profit ?? 0)} profit on ${money(top.amount)} of purchases, across ` +
      `${top.bills} bill${top.bills === 1 ? '' : 's'}. ${showing}Highest profit first.`
    : `${money(top.amount)} across ${top.bills} bill${top.bills === 1 ? '' : 's'}. ` +
      `${showing}Most bought first.`

  return { headline, detail }
}

export interface RankedProduct {
  id: string | null
  name: string
  revenue: number
  profit: number
  /** Percent, one decimal. */
  margin: number
  qty: number
}

/**
 * A product that sold nothing has no margin — it has no denominator. Printing
 * "0% margin" for it states a fact about profitability that was never
 * measured. Same family as the fabricated ₹0.
 */
export function productProfitAnswer(
  products: RankedProduct[],
  label: string,
  money: (n: number) => string,
  totalProducts: number,
): RankAnswer {
  if (products.length === 0) {
    return {
      headline: `No sales ${label}`,
      detail: 'Nothing was sold in this period, so there is no profit to break down.',
    }
  }

  const top = products[0]
  const shown = products.length
  const showing = totalProducts > shown ? `Top ${shown} of ${totalProducts} items sold. ` : ''

  /*
   * A LOSS IS NOT A SMALL PROFIT. If the best item in the shop lost money,
   * saying it "made the most profit" is technically a ranking and practically
   * a lie. It gets its own sentence.
   */
  if (top.profit < 0) {
    return {
      headline: `Every item lost money ${label}`,
      detail: `${top.name} lost the least — ${money(Math.abs(top.profit))} on ` +
        `${money(top.revenue)} of sales. ${showing}Check your cost prices.`,
    }
  }

  return {
    headline: `${top.name} made the most profit ${label}`,
    detail: `${money(top.profit)} on ${money(top.revenue)} of sales — ` +
      `${top.margin.toFixed(1)}% margin. ${showing}Highest profit first.`,
  }
}
