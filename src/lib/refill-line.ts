/**
 * What goes back into a line that is refilled from a saved bill.
 *
 * WHY (#130, #173, 1 Oct 2026). Returns, "Repeat last sale", editing a bill and
 * converting an estimate all rebuild lines from a stored bill. They passed the
 * stored `unitPrice` — which is the EX-GST price — while the rebuilt line took
 * the product's "price includes GST" flag, so for MRP products GST came out a
 * second time: a full return of a ₹765.01 sale refunded ₹728.60, and a repeated
 * sale would have undercharged by the same amount.
 *
 * A line now records the price as typed and whether it included GST. Refilling
 * returns exactly those two, so recomputing the line reproduces what was billed.
 *
 * Lines saved before those columns existed (2 Oct 2026) have only the ex-GST
 * price; they come back with the flag off, which recomputes the same taxable
 * value (the total can differ by the old rounding paise, never by the GST).
 *
 * ONE function for every refill path — a second copy of this rule in one screen
 * is how the double extraction would come back.
 */
export function refillPrice(line: {
  unitPrice?: number | null
  enteredPrice?: number | null
  priceIncludesGst?: boolean | null
}): { unitPrice: number; priceIncludesGst: boolean } {
  if (line.enteredPrice != null) {
    return { unitPrice: Number(line.enteredPrice) || 0, priceIncludesGst: !!line.priceIncludesGst }
  }
  return { unitPrice: Number(line.unitPrice) || 0, priceIncludesGst: false }
}

/**
 * Does this line's price include GST? One rule for the bill screen's preview
 * AND its save (#130, #135, 2 Oct 2026):
 *
 *  1. A line refilled from a saved bill states its own value — use it.
 *  2. Otherwise, on a PURCHASE (or debit note) the bill's "Rates include GST"
 *     switch decides. The product's flag describes the shop's own selling
 *     price (its MRP); borrowing it for a supplier's rate turned a ₹230 cost
 *     into ₹219.05 + GST and re-costed the product without asking.
 *  3. Otherwise (a sale), the product's MRP flag.
 */
export function resolveLineIncludesGst(input: {
  lineFlag?: boolean | null
  isPurchaseSide: boolean
  purchaseRatesIncludeGst: boolean
  productFlag?: boolean | null
}): boolean {
  if (typeof input.lineFlag === 'boolean') return input.lineFlag
  if (input.isPurchaseSide) return input.purchaseRatesIncludeGst
  return !!input.productFlag
}
