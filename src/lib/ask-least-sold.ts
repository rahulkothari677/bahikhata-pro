/**
 * #70 / #78 — how the sold-ranking answers are WORDED, BOTH ENDS OF IT.
 *
 * The most-sold and least-sold answers live in one file on purpose. They are
 * the same question asked from opposite ends, over the same rows, and #78 is
 * what happens when they drift: "sabse zyada kya bika" measured sale value
 * one way while every other screen measured it another, and nobody could see
 * it because the two answers were written in different places.
 *
 * Pure functions, for the reason #76 taught: a rule buried inside an API
 * route can only be exercised by deploying and asking. That is how five
 * guards in three days ended up measuring the wrong thing.
 *
 * The database decides WHAT the answer is. This decides only how it reads.
 *
 * ─────────────────── THE ONE MEASURE, WRITTEN DOWN ───────────────────
 *
 * Sale value = quantity × unitPrice − discount, with credit notes
 * subtracted. That is BEFORE GST, and it is the same expression the
 * Item-wise Profit report and the dashboard's best-sellers chart use.
 *
 * It matters that this sentence exists somewhere. Three definitions of
 * per-product revenue were live at once:
 *
 *   dashboard chart   qty × unitPrice                    Shirt Stitching ₹1,500
 *   item-profit       qty × unitPrice − discount         Shirt Stitching ₹1,500
 *   ask top_products  ti.total (GST in, after discount)  Shirt Stitching ₹2,625
 *
 * — and the Ask figure counted returns as sales on top, so it also said 5
 * sold where the others said 3. The "Open Item-wise Profit" button (#68) led
 * from ₹2,625 to ₹1,500 with nothing to explain the gap.
 */

/** Said in the answer itself, because a bare figure invites the wrong guess. */
export const SALE_VALUE_BASIS = 'Sale value before GST, after returns.'

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
      /*
       * The capital M is not a nicety. Without the "Showing X of Y" clause
       * this read "…of stock. most stock value first." — a lower-case letter
       * straight after a full stop, which is what the live answer printed the
       * first time it had a real figure to show.
       */
      ? `${worst.name} has the most money sitting in it — ${money(worst.tiedUp)} of stock.` +
        (showing ? ` ${showing}, most stock value first.` : ' Most stock value first.')
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

/* ─────────────────────────── THE OTHER END ─────────────────────────── */

export interface TopSoldItem {
  id: string
  name: string
  /** Net units sold — returns already subtracted, so it can be ≤ 0. */
  qty: number
  /** Net sale value in RUPEES, before GST. See SALE_VALUE_BASIS. */
  value: number
}

/**
 * "Sabse zyada kya bika".
 *
 * `soldNothing` is reused rather than re-tested: a product whose sales were
 * all returned is not the best seller, and the two ends of this ranking must
 * agree about what "sold nothing" means or they will contradict each other on
 * the same shop's books.
 */
export function topSoldAnswer(
  items: TopSoldItem[],
  label: string,
  money: (n: number) => string,
  soldCount: number,
): LeastSoldAnswer {
  if (items.length === 0) {
    return {
      headline: `No sales ${label}`,
      detail: 'Nothing was sold in this period.',
      soldNothing: true,
    }
  }

  const top = items[0]

  /*
   * EVERY SALE CAME BACK. Calling the top row "sold most" when its net is
   * zero or negative is the mirror of calling a loss-making product the most
   * profitable — technically a ranking, and false to read.
   */
  if (soldNothing(top.qty)) {
    return {
      headline: `Returns cancelled out every sale ${label}`,
      detail: `Nothing has a positive net sale ${label} once returns are ` +
        `subtracted. ${SALE_VALUE_BASIS}`,
      soldNothing: true,
    }
  }

  const showing = soldCount > items.length ? `Top ${items.length} of ${soldCount} items sold. ` : ''

  return {
    headline: `${top.name} sold most ${label}`,
    detail: `${money(top.value)} from ${top.qty} sold. ${showing}${SALE_VALUE_BASIS}`,
    soldNothing: false,
  }
}
