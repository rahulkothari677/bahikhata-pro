/**
 * 🔒 V18 Paise Migration — CI "100× Guard" Test
 *
 * This test is the safety net the auditor mandated before Phase 4.
 * It verifies that money values flow through the system at the correct
 * magnitude (rupees, not paise, and not 100× off).
 *
 * If Phase 4 (or any future change) introduces a rupee/paise mixup,
 * this test will FAIL with a 100× or 0.01× discrepancy — catching the
 * bug before it reaches production.
 *
 * The test uses computeLineItems (the write path) with known rupee
 * inputs and asserts the outputs are in the expected rupee range.
 * If computeLineItems starts returning paise (100× too large) or
 * paise/100 (100× too small), the assertions fail.
 *
 * Test cases:
 *   1. Simple sale: 2 units × ₹50 = ₹100 (subtotal), GST 18% = ₹18, total ₹118
 *   2. Sale with discount: ₹100 subtotal - ₹10 discount = ₹90 taxable, GST 5% = ₹4.50
 *   3. Inter-state sale: IGST instead of CGST+SGST
 *   4. Credit note: negative profit (return reversal)
 *   5. fromPaise/toPaise round-trip: known rupee values survive conversion
 */

import {
  computeLineItems,
} from '@/lib/line-items'
import {
  toPaise,
  fromPaise,
  roundMoney,
  formatINR,
} from '@/lib/money'

describe('🔒 V18 Paise Migration — CI 100× Guard', () => {
  // ─── Helper: assert a value is in rupee range (not paise, not paise/100) ──
  //
  // If a value is accidentally in PAISE (100× too large), the check fails.
  // If a value is accidentally in PAISE/100 (0.01× too small), the check fails.
  //
  // We use a generous tolerance (±50%) to avoid false positives from
  // legitimate rounding, but narrow enough to catch 100× errors.
  function expectRupees(actual: number, expected: number, label: string) {
    // 100× guard: if actual is ~100× the expected, it's paise (not rupees)
    if (Math.abs(actual - expected * 100) < Math.abs(expected * 100) * 0.1) {
      throw new Error(
        `${label}: value ${actual} looks like PAISE (100× too large). ` +
        `Expected ~${expected} rupees, got ${actual} (≈ ${expected * 100} paise). ` +
        `This indicates a missing fromPaise() conversion.`
      )
    }
    // 0.01× guard: if actual is ~1/100 of expected, it's rupees/100 (too small)
    if (expected > 1 && Math.abs(actual - expected / 100) < Math.abs(expected / 100) * 0.1) {
      throw new Error(
        `${label}: value ${actual} looks like RUPEES/100 (0.01× too small). ` +
        `Expected ~${expected} rupees, got ${actual}. ` +
        `This indicates a double fromPaise() conversion.`
      )
    }
    // Normal assertion with 2-decimal tolerance (for rounding)
    expect(actual).toBeCloseTo(expected, 2)
  }

  // ─── Test 1: Simple sale (2 × ₹50, 18% GST) ──────────────────────────────
  test('simple sale: 2 × ₹50 + 18% GST = ₹118 total', () => {
    const result = computeLineItems({
      items: [{
        productId: null,
        productName: 'Test Product',
        quantity: 2,
        unitPrice: 50,
        gstRate: 18,
        unit: 'pcs',
      }],
      productMap: new Map(),
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    // Subtotal = 2 × 50 = 100 rupees
    expectRupees(result.subtotal, 100, 'subtotal')
    // CGST = 9% of 100 = 9, SGST = 9% of 100 = 9
    expectRupees(result.cgst, 9, 'cgst')
    expectRupees(result.sgst, 9, 'sgst')
    expectRupees(result.igst, 0, 'igst')
    // Total = 100 + 9 + 9 = 118
    expectRupees(result.totalBeforeRoundOff, 118, 'totalBeforeRoundOff')

    // Per-item checks
    expectRupees(result.txItems[0].unitPrice, 50, 'item.unitPrice')
    expectRupees(result.txItems[0].total, 118, 'item.total') // taxable + GST
    expectRupees(result.txItems[0].cgst, 9, 'item.cgst')
    expectRupees(result.txItems[0].sgst, 9, 'item.sgst')
  })

  // ─── Test 2: Sale with order-level discount ───────────────────────────────
  test('sale with ₹10 discount: ₹100 - ₹10 = ₹90 taxable, 5% GST = ₹4.50', () => {
    const result = computeLineItems({
      items: [{
        productId: null,
        productName: 'Discounted Item',
        quantity: 2,
        unitPrice: 50,
        gstRate: 5,
        unit: 'pcs',
      }],
      productMap: new Map(),
      isInterState: false,
      orderDiscount: 10, // ₹10 order-level discount
      type: 'sale',
    })

    // Subtotal = 2 × 50 = 100 (pre-discount)
    expectRupees(result.subtotal, 100, 'subtotal')
    // Taxable = 100 - 10 = 90
    // CGST = 2.5% of 90 = 2.25, SGST = 2.5% of 90 = 2.25
    expectRupees(result.cgst, 2.25, 'cgst')
    expectRupees(result.sgst, 2.25, 'sgst')
    // Total = 90 + 2.25 + 2.25 = 94.50
    expectRupees(result.totalBeforeRoundOff, 94.5, 'totalBeforeRoundOff')
    // Item discount = ₹10 (full discount on the single item)
    expectRupees(result.txItems[0].discountAmount, 10, 'item.discountAmount')
  })

  // ─── Test 3: Inter-state sale (IGST instead of CGST+SGST) ─────────────────
  test('inter-state sale: IGST 18% (not CGST+SGST)', () => {
    const result = computeLineItems({
      items: [{
        productId: null,
        productName: 'Inter-state Item',
        quantity: 1,
        unitPrice: 1000,
        gstRate: 18,
        unit: 'pcs',
      }],
      productMap: new Map(),
      isInterState: true,
      orderDiscount: 0,
      type: 'sale',
    })

    expectRupees(result.subtotal, 1000, 'subtotal')
    expectRupees(result.cgst, 0, 'cgst (should be 0 for inter-state)')
    expectRupees(result.sgst, 0, 'sgst (should be 0 for inter-state)')
    expectRupees(result.igst, 180, 'igst (18% of 1000)')
    expectRupees(result.totalBeforeRoundOff, 1180, 'total')
  })

  // ─── Test 4: Credit note (negative profit) ────────────────────────────────
  test('credit note: profit is negative (return reversal)', () => {
    const productMap = new Map([
      ['p1', { id: 'p1', unit: 'pcs', purchasePrice: 80, salePrice: 100, priceIncludesGst: false }]
    ])
    const result = computeLineItems({
      items: [{
        productId: 'p1',
        productName: 'Returned Item',
        quantity: 1,
        unitPrice: 100,
        gstRate: 0,
        unit: 'pcs',
      }],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'credit-note',
    })

    // Profit should be NEGATIVE (reversal of original sale's profit)
    // Original sale profit = (100 - 80) × 1 = +20
    // Credit note profit = -20
    expectRupees(result.grossProfit, -20, 'grossProfit (credit note reversal)')
    // Total should still be positive (the return amount)
    expectRupees(result.totalBeforeRoundOff, 100, 'total')
  })

  // ─── Test 5: fromPaise/toPaise round-trip with known values ───────────────
  test('paise round-trip: known rupee values survive conversion', () => {
    const testValues = [
      { rupees: 0, paise: 0 },
      { rupees: 1, paise: 100 },
      { rupees: 1.01, paise: 101 },
      { rupees: 100, paise: 10000 },
      { rupees: 100.50, paise: 10050 },
      { rupees: 1234.56, paise: 123456 },
      { rupees: -500.25, paise: -50025 },
    ]

    for (const { rupees, paise } of testValues) {
      // toPaise should convert rupees → paise correctly
      const convertedPaise = toPaise(rupees)
      expect(convertedPaise).toBe(paise)

      // fromPaise should convert paise → rupees correctly
      const convertedRupees = fromPaise(paise)
      expect(convertedRupees).toBe(rupees)

      // The round-trip should preserve the value
      expect(fromPaise(toPaise(rupees))).toBe(rupees)
    }
  })

  // ─── Test 6: formatINR produces correct display strings ───────────────────
  test('formatINR: known values produce expected display strings', () => {
    // These are the values a user would see on screen
    expect(formatINR(100)).toBe('₹100.00')
    expect(formatINR(100.5)).toBe('₹100.50')
    expect(formatINR(1234.56)).toBe('₹1,234.56')
    expect(formatINR(0)).toBe('₹0.00')
    expect(formatINR(-500.25)).toBe('-₹500.25')

    // CRITICAL: if a paise value (10050) is accidentally passed to formatINR
    // (which expects rupees), the display would be "₹10,050.00" instead of "₹100.50".
    // This test doesn't catch that directly (formatINR can't know), but the
    // 100× guard on computeLineItems output ensures formatINR always receives
    // rupees.
  })

  // ─── Test 7: Multi-item sale with proportional discount ───────────────────
  test('multi-item sale: proportional discount distribution', () => {
    const result = computeLineItems({
      items: [
        { productId: null, productName: 'Item A', quantity: 2, unitPrice: 100, gstRate: 0, unit: 'pcs' },
        { productId: null, productName: 'Item B', quantity: 1, unitPrice: 300, gstRate: 0, unit: 'pcs' },
      ],
      productMap: new Map(),
      isInterState: false,
      orderDiscount: 50, // ₹50 discount
      type: 'sale',
    })

    // Subtotal = 2×100 + 1×300 = 500
    expectRupees(result.subtotal, 500, 'subtotal')
    // Discount distributed proportionally:
    //   Item A gross = 200 (40% of 500) → discount = 20
    //   Item B gross = 300 (60% of 500) → discount = 30
    expectRupees(result.txItems[0].discountAmount, 20, 'item A discount')
    expectRupees(result.txItems[1].discountAmount, 30, 'item B discount')
    // Total = (500 - 50) + 0 GST = 450
    expectRupees(result.totalBeforeRoundOff, 450, 'total')
  })
})
