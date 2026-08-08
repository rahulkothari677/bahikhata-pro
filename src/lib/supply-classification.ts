/**
 * Which box does a sale line belong in — taxable, nil-rated, exempt or non-GST?
 *
 * WHY THIS EXISTS (2026-08-08). GSTR-1 and GSTR-3B were each answering this
 * question for themselves, from different fields, with different fallbacks:
 *
 *   GSTR-1  read the snapshot on the line (`TransactionItem.gstTreatment`) and,
 *           where it was absent, fell back to "0% means nil-rated".
 *   GSTR-3B joined LIVE to `Product.gstTreatment`, and deliberately left a
 *           0%-rated line with no declared treatment inside 3.1(a) taxable.
 *
 * For August 2026 that produced two different answers about the same shop:
 * GSTR-1 said ₹2,959 nil + ₹100 exempt; GSTR-3B said ₹0 nil + ₹3,034 exempt,
 * with ₹25 left sitting in outward taxable supplies. Two returns filed for the
 * same month that do not agree with each other is the single most common reason
 * a shop receives a notice.
 *
 * So both now call this, and can no longer drift apart.
 *
 * THE RULE, AND WHY:
 *
 *   1. AN EXPLICIT DECLARATION WINS. If the shopkeeper said what a product is,
 *      that is the answer.
 *
 *   2. THE SNAPSHOT IS THE SOURCE, NOT THE PRODUCT. `TransactionItem` carries
 *      what the product was AT THE TIME OF SALE. Reading the live Product row
 *      means re-categorising an item today silently rewrites what last year's
 *      filed return says — and a filed return is a record of what happened, not
 *      of what your product list currently looks like. This is the same reason
 *      `purchasePriceAtSale` and `hsn` are snapshotted on the line.
 *
 *   3. WITH NO DECLARATION, 0% MEANS NIL-RATED. GSTR-3B 3.1(a) is headed
 *      "Outward taxable supplies (other than zero rated, nil rated and
 *      exempted)" — it excludes nil-rated by its own definition. A line that
 *      charged no tax is not a taxable supply that happens to be free of tax;
 *      in Indian GST a 0%-rated supply IS nil-rated. ("Zero-rated" is a
 *      different thing entirely — exports and SEZ — and is not this.)
 *
 *      This reverses an earlier decision (the V26 M13 note in the GSTR-3B
 *      route) which sent 0%-with-no-treatment to 3.1(a) on the reasoning that
 *      "0% GST is still a taxable supply". That reasoning does not hold: no tax
 *      was charged, so it cannot be declared as a supply on which tax is due.
 *
 * NOTE ON HISTORY: rows written before the snapshot column existed have no
 * treatment and fall to rule 3, which is exactly what GSTR-1 already did for
 * them. Their reported figures do not move.
 */

export type SupplyClass = 'taxable' | 'nil' | 'exempt' | 'nonGst'

/** The four values `TransactionItem.gstTreatment` / `Product.gstTreatment` hold. */
const DECLARED: readonly string[] = ['taxable', 'nil', 'exempt', 'nonGst']

export interface ClassifiableLine {
  /** The treatment snapshotted on the line at sale time. Null on older rows. */
  gstTreatment?: string | null
  /** The GST rate actually charged on the line, as a percentage. */
  gstRate: number
}

/**
 * The one place that decides. Both GSTR-1 and GSTR-3B call this.
 */
export function classifySupplyLine(line: ClassifiableLine): SupplyClass {
  const declared = line.gstTreatment
  if (declared && DECLARED.includes(declared)) return declared as SupplyClass

  // No declaration — fall back to what was actually charged.
  return (line.gstRate || 0) === 0 ? 'nil' : 'taxable'
}

/**
 * Does this line belong in the taxable tables (GSTR-1 Table 4/5/7, 3B 3.1(a))?
 *
 * The complement — everything else — belongs in GSTR-1 Table 8 and 3B 3.1(c).
 * A supply goes in ONE of the two, never both; reporting it in both inflates
 * turnover in GSTR-1 against the books, which is what was happening.
 */
export function isTaxableSupply(line: ClassifiableLine): boolean {
  return classifySupplyLine(line) === 'taxable'
}
