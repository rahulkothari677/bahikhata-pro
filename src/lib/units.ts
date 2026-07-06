/**
 * 🔒 V12: Unit-family system — the single source of truth for how quantities
 * in different units relate to each other.
 *
 * THE PROBLEM THIS SOLVES (founder-reported):
 *   An Indian shopkeeper prices in ₹/kg ("tamatar 20 rupaye kilo") but sells in
 *   grams ("500 gram dena"). The old code did `quantity × unitPrice` blind to
 *   units, so "500 gm at ₹20/kg" became 500 × 20 = ₹10,000 instead of ₹10.
 *   It also decremented stock by the raw number (sell 500 gm → subtract 500 kg
 *   from a kg-tracked product → stock corruption).
 *
 * THE FIX:
 *   Units belong to families (weight, volume, length, count). Each family has a
 *   BASE unit (kg, ltr, m, pcs). A sub-unit (gm, ml, cm) converts to the base by
 *   a fixed factor. When a line item is linked to a catalog product, we normalize
 *   the entered quantity into the PRODUCT's unit before doing any money or stock
 *   math — so 500 gm on a ₹20/kg product becomes 0.5 kg × ₹20 = ₹10, and stock
 *   decrements by 0.5 kg (not 500).
 *
 * Units NOT in the same family (e.g. gm ↔ pcs, or box ↔ packet) are never
 * auto-converted — that would be nonsense. In that case we leave the quantity as
 * entered and let the anomaly guardrail flag anything implausible.
 */

export type UnitFamily = 'weight' | 'volume' | 'length' | 'count'

interface UnitDef {
  family: UnitFamily
  /** How many BASE units are in 1 of this unit. kg=1, gm=0.001, dozen=12, etc. */
  factor: number
  /** The base unit of this unit's family. */
  base: string
}

// Only units that have a well-defined, unambiguous conversion are listed here.
// box / packet / bag deliberately have NO conversion (a "box" isn't a fixed
// number of pieces) — they only ever equal themselves.
const UNIT_TABLE: Record<string, UnitDef> = {
  // Weight — base kg
  kg: { family: 'weight', factor: 1, base: 'kg' },
  gm: { family: 'weight', factor: 0.001, base: 'kg' },
  g: { family: 'weight', factor: 0.001, base: 'kg' },
  mg: { family: 'weight', factor: 0.000001, base: 'kg' },
  quintal: { family: 'weight', factor: 100, base: 'kg' },
  // Volume — base ltr
  ltr: { family: 'volume', factor: 1, base: 'ltr' },
  l: { family: 'volume', factor: 1, base: 'ltr' },
  ml: { family: 'volume', factor: 0.001, base: 'ltr' },
  // Length — base m
  m: { family: 'length', factor: 1, base: 'm' },
  cm: { family: 'length', factor: 0.01, base: 'm' },
  // Count — base pcs
  pcs: { family: 'count', factor: 1, base: 'pcs' },
  dozen: { family: 'count', factor: 12, base: 'pcs' },
}

/** Normalize a unit string (lowercase, trim, strip trailing 's', map aliases). */
export function normalizeUnitName(unit: string | null | undefined): string {
  if (!unit) return 'pcs'
  const u = String(unit).trim().toLowerCase()
  const aliases: Record<string, string> = {
    gram: 'gm', grams: 'gm', gms: 'gm', kgs: 'kg', kilo: 'kg', kilogram: 'kg',
    kilograms: 'kg', litre: 'ltr', litres: 'ltr', liter: 'ltr', liters: 'ltr',
    piece: 'pcs', pieces: 'pcs', pc: 'pcs', nos: 'pcs', no: 'pcs',
    meter: 'm', metre: 'm', meters: 'm', dz: 'dozen', doz: 'dozen',
  }
  return aliases[u] || u
}

/** The unit definition, or null if we don't know how to convert this unit. */
function getDef(unit: string): UnitDef | null {
  return UNIT_TABLE[normalizeUnitName(unit)] || null
}

/** Are two units in the same convertible family? */
export function canConvert(from: string, to: string): boolean {
  const a = getDef(from)
  const b = getDef(to)
  return !!(a && b && a.family === b.family)
}

/** The base unit of a unit's family (kg/ltr/m/pcs), or the unit itself if unknown. */
export function baseUnitOf(unit: string): string {
  return getDef(unit)?.base || normalizeUnitName(unit)
}

/** Is this unit a sub-unit (smaller than its family's base)? e.g. gm, ml, cm. */
export function isSubUnit(unit: string): boolean {
  const d = getDef(unit)
  return !!(d && d.factor < 1)
}

/**
 * Convert a quantity from one unit to another within the same family.
 * Returns null if the units are not convertible (different families / unknown).
 *
 * convertQuantity(500, 'gm', 'kg') === 0.5
 * convertQuantity(2, 'kg', 'gm')   === 2000
 * convertQuantity(500, 'gm', 'pcs') === null  (different families)
 */
export function convertQuantity(qty: number, from: string, to: string): number | null {
  const a = getDef(from)
  const b = getDef(to)
  if (!a || !b || a.family !== b.family) return null
  // qty in base units = qty * a.factor; then divide by b.factor to get target unit
  return (qty * a.factor) / b.factor
}

/**
 * Normalize a line item's (quantity, unit) into a target unit (the product's
 * unit). If convertible, returns the converted quantity + target unit. If not
 * convertible (or same unit), returns the original values unchanged.
 *
 * This is THE fix for the "500 gm × ₹20/kg = ₹10,000" bug: called server-side
 * for every product-linked item so money AND stock use the product's own unit.
 */
export function normalizeToUnit(
  quantity: number,
  fromUnit: string,
  toUnit: string,
): { quantity: number; unit: string; converted: boolean } {
  const from = normalizeUnitName(fromUnit)
  const to = normalizeUnitName(toUnit)
  if (from === to) return { quantity, unit: to, converted: false }
  const converted = convertQuantity(quantity, from, to)
  if (converted === null) {
    // Not convertible — leave as entered (guardrail will flag if implausible)
    return { quantity, unit: from, converted: false }
  }
  return { quantity: converted, unit: to, converted: true }
}

/** All units offered in pickers, grouped for the UI. */
export const UNIT_OPTIONS = ['pcs', 'kg', 'gm', 'ltr', 'ml', 'm', 'cm', 'box', 'dozen', 'packet']

/** Sub-units the quantity picker should offer for a given base unit. */
export function subUnitsFor(baseUnit: string): string[] {
  const b = normalizeUnitName(baseUnit)
  if (b === 'kg') return ['kg', 'gm']
  if (b === 'ltr') return ['ltr', 'ml']
  if (b === 'm') return ['m', 'cm']
  if (b === 'pcs') return ['pcs', 'dozen']
  return [b]
}
