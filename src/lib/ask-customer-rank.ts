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
 *
 * 🐛 CORRECTED AGAINST LIVE DATA, 14 Aug. This first tested `amount <= 0`,
 * and Sharma Tailors' books show why that is wrong: Anil Kumar has one sale
 * of ₹787.50 and two credit notes totalling ₹1,312.50, so his NET is −₹525.
 * "No customer bought anything this month" would have been false — he bought,
 * and then returned more than he bought. Two different facts.
 *
 * So the test is whether any SALE BILL exists at all. A party with only
 * credit notes in the period genuinely bought nothing in it; the returns
 * belong to bills from an earlier month.
 */
export function nobodyBought(customers: RankedCustomer[]): boolean {
  return customers.length === 0 || customers.every(c => c.bills === 0)
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
  const shown = customers.length
  const showing = totalBuyers > shown ? `Top ${shown} of ${totalBuyers} customers who bought. ` : ''

  /*
   * RETURNS CAN OUTWEIGH PURCHASES, and then the superlative is a lie.
   *
   * Found on live books: the shop's only named customer had one bill and two
   * credit notes against it, netting −₹525 and −₹860 of profit. "Anil bought
   * the most this month" above a negative number, or "left the most profit"
   * above a loss, is the same failure as calling a loss-making product the
   * most profitable — technically a ranking, practically false.
   */
  if (byProfit && (top.profit ?? 0) < 0) {
    return {
      headline: `No customer made you a profit ${label}`,
      detail: `${top.name} came closest, at a loss of ${money(Math.abs(top.profit ?? 0))} ` +
        `on ${money(Math.abs(top.amount))} — returns outweighed sales. ${showing}Smallest loss first.`,
    }
  }
  /*
   * EXACTLY ZERO IS ITS OWN CASE, and my own test caught it: a customer with
   * three bills netting ₹0 printed "returned more than they bought — ₹0.00
   * net", which is both wrong (returns EQUALLED sales) and a fabricated zero.
   * Bought-and-returned-everything is a real thing a shop sees, and it reads
   * as its own sentence.
   */
  if (!byProfit && top.amount === 0 && top.bills > 0) {
    return {
      headline: `Everything bought was returned ${label}`,
      detail: `${top.name} has ${top.bills} bill${top.bills === 1 ? '' : 's'} ` +
        `fully cancelled by returns. ${showing}`.trimEnd(),
    }
  }
  if (!byProfit && top.amount < 0) {
    return {
      headline: `Returns outweighed sales ${label}`,
      detail: `${top.name} returned more than they bought — ${money(Math.abs(top.amount))} net, ` +
        `across ${top.bills} bill${top.bills === 1 ? '' : 's'}. ${showing}`.trimEnd(),
    }
  }

  /*
   * The two questions share a sentence shape and mean different things.
   * "Best customer" is who spends most with you. "Most profitable" is who
   * leaves the most behind — and a shop's biggest spender is very often not
   * its most profitable one, which is the entire reason to ask separately.
   */
  const headline = byProfit
    ? `${top.name} left the most profit ${label}`
    : `${top.name} bought the most ${label}`

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
