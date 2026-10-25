/**
 * Phase 7c step 2b (change C11) — typing a loose amount: 400 g, 1.25 kg, 750 ml,
 * 23 pieces. Rahul, 23 Oct: "sell something in loose in any weight the customer
 * wants like 400gm or 1.25kg or 23 pieces".
 *
 * The bill keeps every quantity in the ITEM's unit (a kg item's line says 0.4,
 * never 400 g on a kg price — line-items.ts and units.ts guard that), so a typed
 * amount becomes the item's unit here, once. The rupee amount ("₹50 of sugar")
 * is lib/loose-amount.ts, by the bill's own price rule.
 */
import { normalizeUnitName, convertQuantity, isCountUnit, baseUnitOf } from './units'

/** The unit the customer said, or 'auto' (the item's own unit, with the 400 = 400 g rule). */
export type TypedUnit = 'auto' | 'g' | 'kg' | 'ml' | 'ltr' | 'pcs'

/** A whole number at least this big, typed on a kg or litre item, means grams or ml. */
export const GRAMS_FROM = 50

/** Is this item sold by weight or volume (kg, gm, ltr, ml, m)? */
export function isLooseUnit(unit: string | null | undefined): boolean {
  return !isCountUnit(unit)
}

/** The small unit beside an item's unit: g for kg, ml for litre; null for anything else. */
export function smallUnitOf(unit: string | null | undefined): 'g' | 'ml' | null {
  const b = baseUnitOf(normalizeUnitName(unit))
  return b === 'kg' ? 'g' : b === 'ltr' ? 'ml' : null
}

/**
 * What the typed text puts on the bill, in the item's unit. "400" on a kg item
 * is 0.4 (400 g) when the 400-means-grams rule is on; "1.25" is 1.25 kg; "400"
 * with g chosen is 0.4. A count item takes whole numbers only — 2.5 packets is
 * refused (null), never rounded.
 */
export function typedQuantity(text: string, typedUnit: TypedUnit, itemUnit: string | null | undefined, gramsRule = true): number | null {
  const n = Number(text)
  if (!text || !Number.isFinite(n) || n <= 0) return null
  const unit = normalizeUnitName(itemUnit)
  if (isCountUnit(unit)) return Number.isInteger(n) ? n : null
  let from: string = typedUnit === 'auto' ? unit : typedUnit
  if (typedUnit === 'auto' && gramsRule && Number.isInteger(n) && n >= GRAMS_FROM && !text.includes('.')) {
    const small = smallUnitOf(unit)
    if (small && unit === baseUnitOf(unit)) from = small
  }
  const q = convertQuantity(n, from, unit)
  if (q === null) return null
  return Math.round(q * 1000) / 1000 || null
}

/** The unit the screen should show while typing ("400" → g on a kg item). */
export function shownUnit(text: string, typedUnit: TypedUnit, itemUnit: string | null | undefined, gramsRule = true): string {
  const unit = normalizeUnitName(itemUnit)
  if (typedUnit !== 'auto') return typedUnit === 'ltr' ? 'L' : typedUnit
  const n = Number(text)
  const small = smallUnitOf(unit)
  if (small && gramsRule && Number.isInteger(n) && n >= GRAMS_FROM && !text.includes('.')) return small
  return unit === 'ltr' ? 'L' : unit
}

/** A loose quantity as a shopkeeper says it: 0.4 kg → "400 g", 1.25 kg → "1.25 kg", 23 → "23". */
export function looseLabel(q: number, itemUnit: string | null | undefined): string {
  const unit = normalizeUnitName(itemUnit)
  if (isCountUnit(unit)) return String(q)
  const small = smallUnitOf(unit)
  if (small && unit === baseUnitOf(unit) && q < 1) return `${Math.round(q * 1000)} ${small}`
  return `${Math.round(q * 1000) / 1000} ${unit === 'ltr' ? 'L' : unit}`
}

/**
 * The weight buttons on a loose item's row: what most customers ask for. A dear
 * item (₹400 a kg and up: dry fruits, paneer) gets the smaller weights.
 */
export function weightButtons(itemUnit: string | null | undefined, pricePerUnit: number): number[] {
  const unit = normalizeUnitName(itemUnit)
  if (unit === 'kg') return pricePerUnit >= 400 ? [0.1, 0.25, 0.5, 1] : [0.25, 0.5, 1, 2]
  if (unit === 'ltr') return [0.5, 1, 2]
  return []
}

/** Quick picks in the keypad bar, beyond the row's buttons. */
export function barQuickPicks(itemUnit: string | null | undefined, pricePerUnit: number): number[] {
  const unit = normalizeUnitName(itemUnit)
  if (unit === 'kg') return pricePerUnit >= 400 ? [0.05, 0.1, 0.25, 0.5, 1] : [0.25, 0.5, 0.75, 1, 1.5, 2, 5]
  if (unit === 'ltr') return [0.25, 0.5, 0.75, 1, 2]
  return [5, 10, 20, 50]
}

/**
 * "500 kg?" — asked, never blocked (Rahul's settings: "check unusual amounts").
 * A slip of the unit (500 typed as kg for 500 g) shows as a line worth thousands.
 */
export function unusualAmount(q: number, itemUnit: string | null | undefined, lineTotal: number): string | null {
  const unit = normalizeUnitName(itemUnit)
  if (!isCountUnit(unit) && q > 25) return `Check: ${looseLabel(q, unit)}?`
  if (isCountUnit(unit) && q > 100) return `Check: ${q}?`
  if (lineTotal > 10000) return `Check: ₹${Math.round(lineTotal).toLocaleString('en-IN')}?`
  return null
}
