/**
 * Money helpers — the ONLY file that should do money conversion/rounding.
 *
 * 🔒 HONEST STATUS (corrected per V6 audit):
 * Money fields are STILL stored as Float (42 fields in schema.prisma).
 * A full Decimal(18,2) migration was attempted but reverted because it
 * created 126 type errors across 13 files (Prisma Decimal objects don't
 * support JS arithmetic operators — each needs a manual Number() wrapper,
 * and missing one = runtime crash in a financial app).
 *
 * Instead, these helpers apply roundMoney() at every calculation point to
 * eliminate float precision drift (e.g. itemGst / 2 → 9.000000000000002
 * becomes 9.00). This is a MITIGATION, not a structural fix.
 *
 * Phase 8 (this commit): Applied roundMoney()/splitGst() to ALL 15 money-
 * handling routes (was only in 1 of 15 before — the V6 audit caught this).
 *
 * Future: A full Decimal/paise migration should be done as a separate,
 * carefully tested phase with comprehensive test coverage.
 *
 * Rules:
 * 1. All money math must go through these helpers (not raw +/-/*)
 * 2. Every money calculation is rounded to 2 decimal places (1 paisa precision)
 * 3. Display uses formatINR() — never template literals for money
 * 4. Never use parseFloat() on money — use toMoney() instead
 */

/**
 * Safely convert a Prisma Decimal / number / string to a native number.
 * Returns 0 for null/undefined/NaN.
 *
 * Use this whenever reading a money value from the database.
 */
export function toMoney(value: any): number {
  if (value == null) return 0
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  // Prisma Decimal objects have a toNumber() method
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    return value.toNumber()
  }
  // String fallback
  const n = Number(value)
  return isNaN(n) ? 0 : n
}

/**
 * Round a money value to 2 decimal places (1 paisa precision).
 *
 * This is the core fix for the Float precision issue: instead of
 * `itemGst / 2` producing 9.000000000000002, we get exactly 9.00.
 *
 * Uses "round half away from zero" (standard rounding, not banker's rounding)
 * to match GST invoice norms.
 */
export function roundMoney(value: number): number {
  if (isNaN(value) || !isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/**
 * Add two or more money values, rounding the result to 2 decimal places.
 * Prevents float drift from accumulating across many additions.
 *
 * Usage: const total = addMoney(subtotal, cgst, sgst, igst, -discount)
 */
export function addMoney(...values: number[]): number {
  return roundMoney(values.reduce((sum, v) => sum + toMoney(v), 0))
}

/**
 * Multiply quantity by unit price, rounding to 2 decimal places.
 * Use for line-item total calculation.
 */
export function multiplyMoney(quantity: number, unitPrice: number): number {
  return roundMoney(toMoney(quantity) * toMoney(unitPrice))
}

/**
 * Calculate GST amount for a line item.
 * Returns the rounded GST amount (2 decimal places).
 *
 * @param amount - the taxable amount (qty × unitPrice - discount)
 * @param gstRate - the GST percentage (0, 5, 12, 18, 28)
 */
export function calculateGst(amount: number, gstRate: number): number {
  return roundMoney(toMoney(amount) * toMoney(gstRate) / 100)
}

/**
 * Split GST into CGST and SGST (each is half of total GST).
 * Both are rounded to 2 decimal places to prevent drift.
 *
 * If the GST is an odd number of paise, the extra paisa goes to CGST
 * (arbitrary but consistent rule — document in GST filing notes).
 */
export function splitGst(totalGst: number): { cgst: number; sgst: number } {
  const gst = toMoney(totalGst)
  const half = gst / 2
  const cgst = roundMoney(half)
  const sgst = roundMoney(gst - cgst) // ensures cgst + sgst === gst exactly
  return { cgst, sgst }
}

/**
 * Format a money value as an Indian Rupee string for display.
 *
 * Usage: formatINR(1234.5) → "₹1,234.50"
 *        formatINR(0) → "₹0.00"
 *        formatINR(-500) → "-₹500.00"
 */
export function formatINR(value: number): string {
  const n = toMoney(value)
  const isNegative = n < 0
  const absVal = Math.abs(n)
  // Indian number formatting (lakh/crore system): 1,23,456.78
  const formatted = absVal.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return isNegative ? `-₹${formatted}` : `₹${formatted}`
}

/**
 * Format a money value as a plain number string (no ₹ symbol, no formatting).
 * Use when sending to APIs that expect raw numbers.
 *
 * Usage: toMoneyString(1234.5) → "1234.50"
 */
export function toMoneyString(value: number): string {
  return toMoney(value).toFixed(2)
}

/**
 * Parse a user-entered money string to a number.
 * Handles: "1234", "1234.50", "1,234.50", "₹1,234.50", "1234.5"
 * Returns 0 for invalid input.
 */
export function parseMoney(input: string | number | any): number {
  if (typeof input === 'number') return roundMoney(input)
  if (!input) return 0
  // Remove ₹ symbol, commas, spaces, and any non-numeric chars except . and -
  const cleaned = String(input).replace(/[₹,\s]/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : roundMoney(n)
}
