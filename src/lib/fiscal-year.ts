/**
 * V26 N9 — Indian financial-year helpers for GSTR-1 turnover fields.
 *
 * Indian FY runs April 1 → March 31. So FY 2025-26 = April 1, 2025 →
 * March 31, 2026. FY 2026-27 = April 1, 2026 → March 31, 2027.
 *
 * For a given filing period (year + month):
 *   - If month >= 4 (Apr–Dec): current FY starts in `year`. Prior FY = (year-1) → year.
 *   - If month < 4 (Jan–Mar): current FY starts in `year-1`. Prior FY = (year-2) → (year-1).
 *
 * Pure functions — no DB, no side effects. Fully testable.
 */

export interface FYBounds {
  start: Date  // inclusive — April 1, 00:00 UTC
  end: Date    // exclusive — April 1 of next FY, 00:00 UTC
}

/**
 * Returns the bounds of the prior financial year relative to the given
 * filing period.
 *
 * @param filingYear  4-digit year of the filing period (e.g. 2026)
 * @param filingMonth 1-12 month of the filing period (e.g. 7 for July)
 * @returns           { start, end } — prior-FY bounds (April 1 → April 1 of next FY)
 */
export function getPriorFYBounds(filingYear: number, filingMonth: number): FYBounds {
  // Indian FY: April 1 → March 31.
  // If filing month is Apr-Dec (>= 4): current FY = year → year+1, prior FY = (year-1) → year.
  // If filing month is Jan-Mar (< 4): current FY = (year-1) → year, prior FY = (year-2) → (year-1).
  const currentFYStartYear = filingMonth >= 4 ? filingYear : filingYear - 1
  const priorFYStartYear = currentFYStartYear - 1
  return {
    start: new Date(Date.UTC(priorFYStartYear, 3, 1)),       // April 1 of prior FY
    end: new Date(Date.UTC(priorFYStartYear + 1, 3, 1)),     // April 1 of current FY (exclusive)
  }
}

/**
 * Returns the bounds of the current financial year (containing the filing period).
 *
 * @param filingYear  4-digit year of the filing period
 * @param filingMonth 1-12 month of the filing period
 * @returns           { start, end } — current-FY bounds (April 1 → April 1 of next FY)
 */
export function getCurrentFYBounds(filingYear: number, filingMonth: number): FYBounds {
  const currentFYStartYear = filingMonth >= 4 ? filingYear : filingYear - 1
  return {
    start: new Date(Date.UTC(currentFYStartYear, 3, 1)),
    end: new Date(Date.UTC(currentFYStartYear + 1, 3, 1)),
  }
}
