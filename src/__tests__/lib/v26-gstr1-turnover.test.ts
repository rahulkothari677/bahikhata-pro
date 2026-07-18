/**
 * V26 N9 — Behavioral tests for GSTR-1 gt/cur_gt turnover fields.
 *
 * Two helpers added:
 *   1. computeOutwardTurnover(txns) — pure function in gstr1-builder.ts.
 *      Returns net outward supply: Σ(sale taxable) − Σ(credit-note taxable)
 *      + Σ(debit-note taxable).
 *   2. getPriorFYBounds(year, month) — pure function in fiscal-year.ts.
 *      Returns { start, end } for the prior Indian financial year
 *      (April 1 → March 31).
 *
 * buildGstr1 now:
 *   - Computes cur_gt from the passed-in txns (current-period turnover).
 *   - Accepts optional options.priorFyTurnover for gt (defaults to 0 for
 *     backward compat with tests that don't care).
 */

import { describe, test, expect } from '@jest/globals'
import {
  buildGstr1,
  computeOutwardTurnover,
  type Gstr1Transaction,
  type Gstr1Item,
  type ShopInfo,
} from '@/lib/gstr1-builder'
import { getPriorFYBounds, getCurrentFYBounds } from '@/lib/fiscal-year'

// ─── Fixtures ───────────────────────────────────────────────────────────

const SHOP: ShopInfo = {
  gstin: '27ABCDE1234F1Z5',
  state: 'Maharashtra',
  stateCode: '27',
}

const SALE_ITEM: Gstr1Item = {
  productId: 'p1', productName: 'Rice 1kg', hsn: '1006',
  quantity: 10, unit: 'kg', unitPrice: 100, gstRate: 18,
  discountAmount: 0, cgst: 90, sgst: 90, igst: 0, csamt: 0,
}

const SALE: Gstr1Transaction = {
  id: 's1', type: 'sale', invoiceNo: 'INV-1', date: new Date('2026-07-10'),
  totalAmount: 1180, subtotal: 1000, discountAmount: 0,
  cgst: 90, sgst: 90, igst: 0, isInterState: false, isReverseCharge: false,
  partyId: 'p1', partyName: 'Customer', partyGstin: '27AAAPL1234C1Z5', partyState: 'Maharashtra',
  items: [SALE_ITEM],
}

const CREDIT_NOTE: Gstr1Transaction = {
  ...SALE,
  id: 'cn1', type: 'credit-note', invoiceNo: 'CN-1',
  totalAmount: 354, subtotal: 300, discountAmount: 0,
  cgst: 27, sgst: 27, igst: 0,
  items: [{ ...SALE_ITEM, quantity: 3, cgst: 27, sgst: 27 }],
}

const DEBIT_NOTE: Gstr1Transaction = {
  ...SALE,
  id: 'dn1', type: 'debit-note', invoiceNo: 'DN-1',
  totalAmount: 118, subtotal: 100, discountAmount: 0,
  cgst: 9, sgst: 9, igst: 0,
  items: [{ ...SALE_ITEM, quantity: 1, cgst: 9, sgst: 9 }],
}

const INCOME: Gstr1Transaction = {
  ...SALE,
  id: 'i1', type: 'income', invoiceNo: null,
  totalAmount: 500, subtotal: 500, discountAmount: 0,
  cgst: 0, sgst: 0, igst: 0,
  items: [],
}

// ─── computeOutwardTurnover ─────────────────────────────────────────────

describe('V26 N9 — computeOutwardTurnover (pure helper)', () => {
  test('empty array → 0', () => {
    expect(computeOutwardTurnover([])).toBe(0)
  })

  test('single sale → sale taxable (subtotal − discount)', () => {
    expect(computeOutwardTurnover([SALE])).toBe(1000)
  })

  test('sale with order discount → discounted taxable', () => {
    const saleWithDiscount = { ...SALE, subtotal: 1000, discountAmount: 100 }
    // taxable = 1000 - 100 = 900
    expect(computeOutwardTurnover([saleWithDiscount])).toBe(900)
  })

  test('credit note REDUCES turnover (sales return)', () => {
    // Sale 1000 - CN 300 = 700
    expect(computeOutwardTurnover([SALE, CREDIT_NOTE])).toBe(700)
  })

  test('debit note INCREASES turnover (additional consideration)', () => {
    // Sale 1000 + DN 100 = 1100
    expect(computeOutwardTurnover([SALE, DEBIT_NOTE])).toBe(1100)
  })

  test('sale + credit note + debit note → net turnover', () => {
    // 1000 - 300 + 100 = 800
    expect(computeOutwardTurnover([SALE, CREDIT_NOTE, DEBIT_NOTE])).toBe(800)
  })

  test('income is NOT part of outward turnover', () => {
    // Income 500 should be ignored — turnover = sale only = 1000
    expect(computeOutwardTurnover([SALE, INCOME])).toBe(1000)
  })

  test('credit note alone (no sale) → negative turnover', () => {
    // A return with no matching sale in the period → negative (portal accepts)
    expect(computeOutwardTurnover([CREDIT_NOTE])).toBe(-300)
  })

  test('multiple sales aggregate', () => {
    const sale2 = { ...SALE, id: 's2', subtotal: 500, discountAmount: 0 }
    // 1000 + 500 = 1500
    expect(computeOutwardTurnover([SALE, sale2])).toBe(1500)
  })

  test('estimate type is ignored (not outward supply)', () => {
    const estimate = { ...SALE, type: 'estimate' }
    expect(computeOutwardTurnover([estimate])).toBe(0)
  })
})

// ─── buildGstr1 with cur_gt + gt ────────────────────────────────────────

describe('V26 N9 — buildGstr1 populates cur_gt + gt', () => {
  test('cur_gt is computed from txns (current-period turnover)', () => {
    // Sale 1000 - CN 300 = 700
    const result = buildGstr1([SALE, CREDIT_NOTE], SHOP, '072026')
    expect(result.cur_gt).toBe(700)
  })

  test('cur_gt is 0 for empty txns (no outward supply in period)', () => {
    const result = buildGstr1([], SHOP, '072026')
    expect(result.cur_gt).toBe(0)
  })

  test('cur_gt includes debit notes (additional consideration)', () => {
    // Sale 1000 + DN 100 = 1100
    const result = buildGstr1([SALE, DEBIT_NOTE], SHOP, '072026')
    expect(result.cur_gt).toBe(1100)
  })

  test('cur_gt excludes income (non-supply income)', () => {
    // Sale 1000 only — income 500 ignored
    const result = buildGstr1([SALE, INCOME], SHOP, '072026')
    expect(result.cur_gt).toBe(1000)
  })

  test('gt defaults to 0 when priorFyTurnover not provided (backward compat)', () => {
    // Existing tests + callers that don't pass options get gt=0 (pre-N9 behavior)
    const result = buildGstr1([SALE], SHOP, '072026')
    expect(result.gt).toBe(0)
  })

  test('gt uses priorFyTurnover when provided', () => {
    const result = buildGstr1([SALE], SHOP, '072026', { priorFyTurnover: 500000 })
    expect(result.gt).toBe(500000)
  })

  test('gt and cur_gt are both populated correctly', () => {
    // Prior FY turnover = ₹5,00,000; current period = ₹1000 sale - ₹300 CN = ₹700
    const result = buildGstr1([SALE, CREDIT_NOTE], SHOP, '072026', { priorFyTurnover: 500000 })
    expect(result.gt).toBe(500000)
    expect(result.cur_gt).toBe(700)
  })

  test('gt is rounded via roundMoney (handles float drift)', () => {
    // 500000.999999 → rounded to 500001 (roundMoney uses round-half-away-from-zero)
    const result = buildGstr1([SALE], SHOP, '072026', { priorFyTurnover: 500000.999999 })
    expect(result.gt).toBe(500001)
  })

  test('cur_gt is rounded via roundMoney', () => {
    // Construct a sale with taxable value that produces float drift
    const driftSale = { ...SALE, subtotal: 1000.005, discountAmount: 0 }
    // taxable = 1000.005 → rounded to 1000.01 (roundMoney: toFixed(2) with 1e-9 nudge)
    const result = buildGstr1([driftSale], SHOP, '072026')
    expect(result.cur_gt).toBe(1000.01)
  })

  test('other sections unaffected by gt/cur_gt population', () => {
    // Regression: ensure adding gt/cur_gt didn't break other sections
    const result = buildGstr1([SALE, CREDIT_NOTE], SHOP, '072026', { priorFyTurnover: 500000 })
    expect(result.gstin).toBe('27ABCDE1234F1Z5')
    expect(result.fp).toBe('072026')
    expect(result.b2b).toHaveLength(1)  // SALE is B2B (party has GSTIN)
    expect(result.cdnr).toHaveLength(1)  // CREDIT_NOTE is CDNR (party has GSTIN)
    expect(result.nil.inv).toHaveLength(0)  // V26 BUG-059: no nil-rated items → 0 entries (was 3 dummy)
  })
})

// ─── getPriorFYBounds + getCurrentFYBounds ─────────────────────────────

describe('V26 N9 — Indian financial-year bounds', () => {
  test('prior FY for July 2026 (month >= 4) → April 2025 → April 2026', () => {
    const bounds = getPriorFYBounds(2026, 7)
    expect(bounds.start).toEqual(new Date(Date.UTC(2025, 3, 1)))  // April 1, 2025
    expect(bounds.end).toEqual(new Date(Date.UTC(2026, 3, 1)))    // April 1, 2026
  })

  test('prior FY for April 2026 (first month of FY) → April 2025 → April 2026', () => {
    const bounds = getPriorFYBounds(2026, 4)
    expect(bounds.start).toEqual(new Date(Date.UTC(2025, 3, 1)))
    expect(bounds.end).toEqual(new Date(Date.UTC(2026, 3, 1)))
  })

  test('prior FY for March 2026 (last month of FY) → April 2024 → April 2025', () => {
    // Filing March 2026 → current FY = 2025-26 (April 2025 → March 2026)
    // Prior FY = 2024-25 (April 2024 → March 2025)
    const bounds = getPriorFYBounds(2026, 3)
    expect(bounds.start).toEqual(new Date(Date.UTC(2024, 3, 1)))  // April 1, 2024
    expect(bounds.end).toEqual(new Date(Date.UTC(2025, 3, 1)))    // April 1, 2025
  })

  test('prior FY for January 2026 → April 2024 → April 2025', () => {
    // Filing Jan 2026 → current FY = 2025-26 (Apr 2025 → Mar 2026)
    // Prior FY = 2024-25 (Apr 2024 → Mar 2025)
    const bounds = getPriorFYBounds(2026, 1)
    expect(bounds.start).toEqual(new Date(Date.UTC(2024, 3, 1)))
    expect(bounds.end).toEqual(new Date(Date.UTC(2025, 3, 1)))
  })

  test('prior FY for December 2025 → April 2024 → April 2025', () => {
    // Filing Dec 2025 → current FY = 2025-26 (Apr 2025 → Mar 2026)
    // Prior FY = 2024-25 (Apr 2024 → Mar 2025)
    const bounds = getPriorFYBounds(2025, 12)
    expect(bounds.start).toEqual(new Date(Date.UTC(2024, 3, 1)))
    expect(bounds.end).toEqual(new Date(Date.UTC(2025, 3, 1)))
  })

  test('prior FY for January 2025 → April 2023 → April 2024', () => {
    // Filing Jan 2025 → current FY = 2024-25 (Apr 2024 → Mar 2025)
    // Prior FY = 2023-24 (Apr 2023 → Mar 2024)
    const bounds = getPriorFYBounds(2025, 1)
    expect(bounds.start).toEqual(new Date(Date.UTC(2023, 3, 1)))
    expect(bounds.end).toEqual(new Date(Date.UTC(2024, 3, 1)))
  })

  test('current FY for July 2026 → April 2026 → April 2027', () => {
    const bounds = getCurrentFYBounds(2026, 7)
    expect(bounds.start).toEqual(new Date(Date.UTC(2026, 3, 1)))
    expect(bounds.end).toEqual(new Date(Date.UTC(2027, 3, 1)))
  })

  test('current FY for January 2026 → April 2025 → April 2026', () => {
    // Jan 2026 is in FY 2025-26
    const bounds = getCurrentFYBounds(2026, 1)
    expect(bounds.start).toEqual(new Date(Date.UTC(2025, 3, 1)))
    expect(bounds.end).toEqual(new Date(Date.UTC(2026, 3, 1)))
  })

  test('end is exclusive (April 1 of next FY — transactions on March 31 are included, April 1 are not)', () => {
    // This is a documentation test — the bounds are [start, end) half-open.
    const bounds = getPriorFYBounds(2026, 7)  // April 2025 → April 2026
    // A transaction on March 31, 2026 23:59:59 is < end (April 1, 2026 00:00:00) → included
    const march31 = new Date(Date.UTC(2026, 2, 31, 23, 59, 59))
    expect(march31 < bounds.end).toBe(true)
    // A transaction on April 1, 2026 00:00:00 is >= end → excluded (it's in the current FY)
    const april1 = new Date(Date.UTC(2026, 3, 1, 0, 0, 0))
    expect(april1 < bounds.end).toBe(false)
  })

  test('year boundary: filing Jan 2025 (month < 4) does NOT use 2025 as current FY start', () => {
    // Critical: if we forgot the month<4 branch, we'd compute current FY = 2025-26
    // (wrong — Jan 2025 is in FY 2024-25). This test guards against that regression.
    const bounds = getCurrentFYBounds(2025, 1)
    expect(bounds.start).toEqual(new Date(Date.UTC(2024, 3, 1)))  // NOT 2025
    expect(bounds.end).toEqual(new Date(Date.UTC(2025, 3, 1)))
  })
})
