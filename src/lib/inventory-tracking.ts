/**
 * Does this product have a stock level at all?
 *
 * A shop sells two kinds of thing:
 *
 *   GOODS    — a countable quantity exists. Selling one leaves one fewer.
 *              Rice, soap, a shirt. Stock is real and worth guarding.
 *   SERVICES — nothing is counted. Blouse stitching, a haircut, a wedding
 *              shoot, an hour of tuition. You can sell the same service twice
 *              in a minute and there is no "how many are left".
 *
 * The app assumed everything was goods. Because the default stock policy is
 * 'block', that assumption did not merely produce a wrong number — it refused
 * the sale. A tailor's very first invoice failed with "Not enough stock —
 * record a purchase or enable overselling in Settings", and neither escape
 * fits: there is no purchase to record, and switching overselling off for the
 * whole shop throws away the guard on any real goods they also sell.
 *
 * ONE predicate, used by every stock read and write.
 * -------------------------------------------------
 * Stock is touched in a lot of places — POST and PUT on transactions, the
 * estimate→invoice convert, the restore-from-deleted path, the low-stock
 * notifier, valuation, ageing, dashboards. A rule spread across that many
 * call sites drifts; that is exactly how GSTR-1 and GSTR-3B came to classify
 * the same supply two different ways (the ₹25 gap). So there is one function,
 * and `inventory-tracking-guard.test.ts` fails the build if a stock write
 * appears anywhere that does not consult it.
 *
 * @see prisma/schema.prisma Product.tracksInventory
 */

/** The minimum shape any caller needs. Deliberately loose so route handlers,
 *  Zustand store objects and Prisma rows all satisfy it without casting. */
export interface StockTrackable {
  tracksInventory?: boolean | null
}

/**
 * True when this product's stock should be counted, guarded and reported.
 *
 * Null/undefined means TRUE. That is not sloppiness — it is the safe
 * direction and it is deliberate:
 *
 *   - Rows written before the column existed have no value. They are goods
 *     (a service could not be sold at all before this), so tracking them
 *     preserves today's behaviour byte for byte.
 *   - A partial `select` that forgets the column must not silently turn a
 *     tracked product into an untracked one. Failing towards "track it" costs
 *     a shopkeeper a warning they can dismiss; failing the other way lets
 *     stock drift with nothing to notice.
 */
export function tracksStock(product: StockTrackable | null | undefined): boolean {
  if (!product) return false          // no product = a free-text line = nothing to track
  return product.tracksInventory !== false
}

/** The inverse, for readability at call sites that filter services out. */
export function isService(product: StockTrackable | null | undefined): boolean {
  return !!product && product.tracksInventory === false
}

/**
 * Does this HSN/SAC code look like a service?
 *
 * Under GST, services carry a SAC (Services Accounting Code) and every SAC
 * begins **99** — 9954 construction, 9963 accommodation & food, 9971
 * financial, 9983 professional, 9987 maintenance & repair, 9997 other.
 * Goods carry an HSN chapter 01–98, so the 99 prefix is unambiguous.
 *
 * Used ONLY to pre-tick the toggle when a shopkeeper types a code. It is a
 * hint, never a decision:
 *
 *   - Plenty of real services are entered with no code at all.
 *   - A shop may legitimately want to track a "service" that consumes a
 *     countable kit.
 *
 * So the shopkeeper's explicit choice always wins, and an absent code never
 * flips anything by itself.
 */
export function looksLikeService(hsn: string | null | undefined): boolean {
  if (!hsn) return false
  const digits = hsn.trim()
  // A SAC is 6 digits, but 4 is accepted below the ₹5cr HSN-length threshold
  // (Notification 78/2020), so accept either length. Reject anything shorter:
  // a bare "99" is far more likely to be a half-typed code than a claim.
  if (!/^\d{4,8}$/.test(digits)) return false
  return digits.startsWith('99')
}

/**
 * What `tracksInventory` should DEFAULT to for a product carrying this code.
 * Callers apply this only when the user has expressed no preference.
 */
export function defaultTracksInventory(hsn: string | null | undefined): boolean {
  return !looksLikeService(hsn)
}

/**
 * Drop the lines whose product does not carry stock.
 *
 * The shape every stock path needs: given the bill's lines and the products
 * they point at, return only the lines that should move a stock number.
 * Free-text lines (no productId) are already excluded — they have no product
 * to decrement.
 */
export function stockAffectingLines<T extends { productId?: string | null }>(
  lines: readonly T[],
  productMap: ReadonlyMap<string, StockTrackable>,
): T[] {
  return lines.filter(line => {
    if (!line.productId) return false
    return tracksStock(productMap.get(line.productId))
  })
}

/**
 * The REVERSAL side of an edit, where "not in the map" means the opposite.
 *
 * When a bill is edited, the old lines are un-applied before the new ones are
 * applied. Both halves consult a product map — but a miss means different
 * things on each side, and getting it backwards silently corrupts stock:
 *
 *   APPLYING (stockAffectingLines) — the map was built from exactly these
 *     lines' product IDs, scoped to this user. A miss means the product does
 *     not exist or is not ours. Skip it: applying stock to a product we could
 *     not load is worse than not applying it.
 *
 *   REVERSING (here) — these units were ALREADY added to or taken from a
 *     product at some point in the past. Failing to give them back leaves the
 *     stock permanently wrong, with nothing to indicate it. So an unloadable
 *     product reverses anyway; only a product we can positively see is a
 *     service is skipped.
 *
 * Put plainly: never skip undoing something just because we could not look it
 * up. A service was never incremented in the first place, so it has nothing
 * to give back — that is the one case worth skipping, and it is the only one.
 */
export function tracksStockForReversal(
  productId: string,
  productMap: ReadonlyMap<string, StockTrackable>,
): boolean {
  const product = productMap.get(productId)
  return product ? tracksStock(product) : true
}
