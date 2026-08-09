/**
 * The composition scheme — a different tax world, not a discount.
 *
 * WHY THIS EXISTS (2026-08-09). The app assumes the regular scheme everywhere:
 * it charges GST on invoices, claims input credit, and files GSTR-1 and GSTR-3B
 * monthly. A composition dealer does none of those things, so today the app
 * cannot serve them at all — and they are a large segment, every shop under
 * ₹1.5 crore that opted in for the simpler life.
 *
 * THE ONE RULE THAT MATTERS MOST, and the reason this is not a rate change:
 *
 *   A COMPOSITION DEALER CANNOT COLLECT GST FROM CUSTOMERS.
 *
 * They pay a flat percentage of turnover OUT OF THEIR OWN MARGIN. So they must
 * not issue a tax invoice at all — they issue a BILL OF SUPPLY, which carries
 * no tax lines, and it must state on its face that they are not entitled to
 * collect tax. An app that let them print CGST and SGST on a bill would be
 * helping them break the law and overcharge their customer at the same time.
 *
 * Everything else follows from that: no input credit to claim, no GSTR-1 of
 * outward tax, and a quarterly CMP-08 instead of monthly returns.
 */

export type CompositionCategory =
  /** Traders and manufacturers of goods — Rule 7. */
  | 'trader'
  | 'manufacturer'
  /** Restaurants not serving alcohol. */
  | 'restaurant'
  /** Service providers under Notification 2/2019. */
  | 'service'

export interface CompositionRate {
  /** Total percentage of turnover payable. */
  total: number
  cgst: number
  sgst: number
  label: string
}

/**
 * Rates are on TURNOVER, not on value added, and are split evenly between CGST
 * and SGST. A composition dealer never charges IGST — they cannot make
 * inter-state outward supplies at all.
 */
export const COMPOSITION_RATES: Record<CompositionCategory, CompositionRate> = {
  trader: { total: 1, cgst: 0.5, sgst: 0.5, label: 'Trader' },
  manufacturer: { total: 1, cgst: 0.5, sgst: 0.5, label: 'Manufacturer' },
  restaurant: { total: 5, cgst: 2.5, sgst: 2.5, label: 'Restaurant (no alcohol)' },
  service: { total: 6, cgst: 3, sgst: 3, label: 'Service provider' },
}

/**
 * Turnover ceilings for staying in the scheme.
 *
 * Goods: ₹1.5 crore, but ₹75 lakh in the special category states. Services
 * under Notification 2/2019: ₹50 lakh everywhere, which is why it is a separate
 * figure rather than a variation of the goods limit.
 */
export const COMPOSITION_LIMITS = {
  goods: 1_50_00_000,
  goodsSpecialCategory: 75_00_000,
  service: 50_00_000,
} as const

/**
 * States with the lower ₹75 lakh ceiling for goods.
 *
 * Listed by two-digit GST state code so the check cannot be fooled by spelling
 * — "Uttarakhand" and "Uttaranchal" are the same place to a shopkeeper and not
 * to a string comparison.
 */
const SPECIAL_CATEGORY_STATE_CODES = new Set([
  '12', // Arunachal Pradesh
  '13', // Nagaland
  '14', // Manipur
  '15', // Mizoram
  '16', // Tripura
  '17', // Meghalaya
  '11', // Sikkim
  '18', // Assam
  '05', // Uttarakhand
])

/** The turnover ceiling that applies to this shop. */
export function compositionLimitFor(category: CompositionCategory, stateCode: string | null): number {
  if (category === 'service') return COMPOSITION_LIMITS.service
  return SPECIAL_CATEGORY_STATE_CODES.has(String(stateCode || ''))
    ? COMPOSITION_LIMITS.goodsSpecialCategory
    : COMPOSITION_LIMITS.goods
}

/**
 * Tax payable for a quarter, on total turnover.
 *
 * Worked from turnover alone: there is no per-invoice tax, no input credit and
 * nothing to net off, which is the whole point of the scheme.
 */
export function compositionTaxFor(turnover: number, category: CompositionCategory) {
  const rate = COMPOSITION_RATES[category]
  const t = Math.max(0, Number(turnover) || 0)
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    turnover: round2(t),
    rate: rate.total,
    cgst: round2((t * rate.cgst) / 100),
    sgst: round2((t * rate.sgst) / 100),
    total: round2((t * rate.total) / 100),
  }
}

/**
 * The declaration a Bill of Supply must carry, word for word.
 *
 * Prescribed wording, not a paraphrase — it is what tells the customer they
 * cannot claim credit from this bill, and a reworded version would not do that
 * job at an assessment.
 */
export const BILL_OF_SUPPLY_DECLARATION =
  'Composition taxable person, not eligible to collect tax on supplies'

/** A composition dealer never charges tax on a sale. Full stop. */
export function canCollectTax(isComposition: boolean): boolean {
  return !isComposition
}

/**
 * When the quarter's CMP-08 is due — the 18th of the month after it ends.
 *
 * @param quarterEndMonth 1-12, the last month of the quarter (3, 6, 9 or 12)
 */
export function cmp08DueDate(year: number, quarterEndMonth: number): Date {
  const m = quarterEndMonth % 12          // December rolls into January
  const y = quarterEndMonth === 12 ? year + 1 : year
  return new Date(y, m, 18)
}
