/**
 * Phase 7e — loose goods by rupees: "₹50 of sugar" at ₹44 a kg is 1.136 kg.
 *
 * A kirana weighs to the customer's rupees as often as to the kilo. The bill
 * still records a QUANTITY (stock goes down by weight, GST is on the value);
 * this works out that quantity from the rupees, by the same price rule the bill
 * uses (customerPaysPerUnit: GST on top for a before-GST price, none for an
 * MRP price or a shop that charges no GST).
 *
 * The quantity is in the line's own unit — a 500 g line stays in grams — to the
 * gram or millilitre (3 decimals of a kg or a litre), rounded to the nearest.
 * What it comes to is then the bill engine's own line total (1.136 kg × ₹44 =
 * ₹49.98), and the screen shows that, never the amount typed: the bill must
 * add up on its face.
 *
 * Count units (pcs, dozen, box, packet, bag) are never loose — null.
 */
import { customerPaysPerUnit, type ProfitOptions } from './unit-profit'
import { normalizeUnitName, normalizeToUnit, isSubUnit, baseUnitOf, isCountUnit } from './units'

export function quantityForAmount(
  amount: number,
  line: { unitPrice: number; gstRate?: number | null; priceIncludesGst?: boolean | null; unit?: string | null },
  productUnit: string | null | undefined,
  opts: ProfitOptions = {},
): number | null {
  const lineUnit = normalizeUnitName(line.unit || productUnit)
  if (isCountUnit(lineUnit)) return null
  const pays = customerPaysPerUnit({ salePrice: line.unitPrice, gstRate: line.gstRate ?? 0, priceIncludesGst: !!line.priceIncludesGst }, opts)
  if (!(amount > 0) || !(pays > 0)) return null
  // The price is per the item's unit (line-items.ts converts quantities, never
  // prices); a typed-in line in grams is priced per kg (resolveEnteredQuantity).
  const priceUnit = productUnit ? normalizeUnitName(productUnit) : (isSubUnit(lineUnit) ? baseUnitOf(lineUnit) : lineUnit)
  const conv = normalizeToUnit(amount / pays, priceUnit, lineUnit)
  if (conv.incompatible) return null
  const places = isSubUnit(lineUnit) ? 0 : 3
  const q = Math.round(conv.quantity * 10 ** places) / 10 ** places
  return q > 0 ? q : null
}
