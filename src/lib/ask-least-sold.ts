/**
 * #70 — how the least-sold answer is WORDED.
 *
 * A pure function, deliberately, and the reason is #76 from this morning: a
 * rule buried inside an API route can only be exercised by deploying and
 * asking. That is how five guards in three days ended up measuring the wrong
 * thing — nobody could call them with a known-good and a known-bad input.
 * Everything here can be called with a list and checked.
 *
 * The database decides WHAT the answer is. This decides only how it reads.
 */

export interface LeastSoldItem {
  id: string
  name: string
  /** Net units sold in the period — returns already subtracted, so it can be ≤ 0. */
  qty: number
  /** Net revenue in RUPEES (the caller converts from paise). */
  value: number
  /** Stock on hand × cost price, in RUPEES. What is tied up in this item. */
  tiedUp: number
  unit: string
}

export interface LeastSoldAnswer {
  headline: string
  detail: string
  /** True when the top of the list sold nothing at all — changes what we show. */
  soldNothing: boolean
}

/**
 * `<= 0`, never `=== 0`.
 *
 * Returns are netted off, so a product sold twice and returned three times
 * lands on a NEGATIVE quantity. Testing for exactly zero would send it down
 * the "sold least" branch and print "Rice sold least — -1 kg sold". Negative
 * is the strongest possible case of not selling; it belongs with the zeroes.
 * The SQL counts `qty <= 0` for the same reason, so the count and the wording
 * agree by construction rather than by coincidence.
 */
export function soldNothing(qty: number): boolean {
  return qty <= 0
}

export function leastSoldAnswer(
  items: LeastSoldItem[],
  zeroCount: number,
  label: string,
  money: (n: number) => string,
): LeastSoldAnswer {
  const worst = items[0]
  const nothing = soldNothing(worst.qty)

  /*
   * "Nothing sold" and "barely sold" are different facts, and blurring them
   * is how a shopkeeper stops trusting the number. The headline says which.
   */
  const headline = nothing
    ? zeroCount === 1
      ? `1 item sold nothing ${label}`
      : `${zeroCount} items sold nothing ${label}`
    : `${worst.name} sold least ${label}`

  /*
   * #73: a list showing five of fourteen must say fourteen. The count is a
   * real COUNT from the same query that ranked the rows — not `items.length`,
   * which is only ever the five we display.
   */
  const showing = zeroCount > items.length ? `Showing ${items.length} of ${zeroCount}` : ''

  /*
   * 🐛 FOUND LIVE, 14 Aug, in the first real answer this ever gave.
   *
   * Sharma Tailors has 6 products; 3 sold nothing this month. The answer read:
   *
   *   "3 items sold nothing this month"
   *   "None of these sold a single unit this month."
   *
   * — above a list whose last two rows were Cotton Fabric (2 sold) and Shirt
   * Stitching (3 sold). The headline was right and the sentence under it
   * contradicted the list beside it.
   *
   * The cause: "none of these" describes the DISPLAYED rows, but the only
   * number in scope was the count of zero-sellers. When more items are shown
   * than sold nothing, the bottom of the list is made up of items that DID
   * sell — which is correct behaviour for a "least sold" list, and exactly
   * what the sentence then misdescribed.
   *
   * My tests missed it because every "no stock" case I wrote happened to have
   * zeroCount >= items.length. The shape below is now asserted both ways.
   */
  const allShownSoldNothing = zeroCount >= items.length

  const detail = nothing
    ? worst.tiedUp > 0
      ? `${worst.name} has the most money sitting in it — ${money(worst.tiedUp)} of stock.` +
        `${showing ? ` ${showing},` : ''} most stock value first.`
      : allShownSoldNothing
        ? `${showing ? `${showing}. ` : ''}None of these sold a single unit ${label}.`
        : `The top ${zeroCount} sold nothing ${label}. The rest below sold very little.`
    : `${worst.qty} ${worst.unit} sold, ${money(worst.value)}. ` +
      `Bottom ${items.length} below, least sold first.`

  return { headline, detail, soldNothing: nothing }
}

/**
 * What a receipt row shows as its amount.
 *
 * For an item that sold nothing, revenue is ₹0 — printing that would give
 * five identical, useless lines and would look like the fabricated-₹0 bug
 * this codebase has fixed four times. The money that matters for a
 * non-seller is what is STUCK in it, not what came in.
 */
export function receiptAmount(item: LeastSoldItem): number {
  return soldNothing(item.qty) ? item.tiedUp : item.value
}
