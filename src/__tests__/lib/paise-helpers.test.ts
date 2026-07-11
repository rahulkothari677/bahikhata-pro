/**
 * 🔒 V17 Paise Migration Phase 1 — Additive helpers tests.
 *
 * Tests the new toPaise/fromPaise/formatPaise/addPaise/multiplyPaise/
 * calculateGstPaise/splitGstPaise helpers.
 *
 * Key invariants:
 *   1. toPaise/fromPaise are inverse operations (round-trip preserves value)
 *   2. Float representation errors are handled (1.005 → 101 paise, not 100)
 *   3. Null/undefined/NaN/Infinity → 0 (fail-safe)
 *   4. splitGstPaise: cgst + sgst === totalGstPaise (exactly, no drift)
 *   5. calculateGstPaise: integer result (no float artifacts)
 *   6. formatPaise matches formatINR(fromPaise(x)) for all values
 */

import {
  toPaise,
  fromPaise,
  formatPaise,
  addPaise,
  multiplyPaise,
  calculateGstPaise,
  splitGstPaise,
  formatINR,
} from '@/lib/money'

describe('🔒 V17 Paise Migration Phase 1 — Additive helpers', () => {

  // ─── toPaise ─────────────────────────────────────────────────────────────

  describe('toPaise (rupees → paise)', () => {
    test('1234.56 rupees → 123456 paise', () => {
      expect(toPaise(1234.56)).toBe(123456)
    })
    test('0 rupees → 0 paise', () => {
      expect(toPaise(0)).toBe(0)
    })
    test('1 rupee → 100 paise', () => {
      expect(toPaise(1)).toBe(100)
    })
    test('1.01 rupees → 101 paise', () => {
      expect(toPaise(1.01)).toBe(101)
    })
    test('🔥 float-safe: 1.005 rupees → 101 paise (not 100)', () => {
      // This is the KEY test — 1.005 * 100 = 100.49999999999999 in float
      // Math.round(100.4999...) = 100 (WRONG, should be 101)
      // Our toPaise uses toMoney first which applies roundMoney (1e-9 nudge)
      // → 1.005 → 1.01 → 101 paise. This is why we need the nudge.
      expect(toPaise(1.005)).toBe(101)
    })
    test('negative: -500.25 rupees → -50025 paise', () => {
      expect(toPaise(-500.25)).toBe(-50025)
    })
    test('large value: 9999999.99 → 999999999 paise', () => {
      expect(toPaise(9999999.99)).toBe(999999999)
    })
    test('null → 0', () => {
      expect(toPaise(null)).toBe(0)
    })
    test('undefined → 0', () => {
      expect(toPaise(undefined)).toBe(0)
    })
    test('NaN → 0', () => {
      expect(toPaise(NaN)).toBe(0)
    })
    test('Infinity → 0', () => {
      expect(toPaise(Infinity)).toBe(0)
    })
    test('string "1234.56" → 123456', () => {
      expect(toPaise('1234.56')).toBe(123456)
    })
  })

  // ─── fromPaise ───────────────────────────────────────────────────────────

  describe('fromPaise (paise → rupees)', () => {
    test('123456 paise → 1234.56 rupees', () => {
      expect(fromPaise(123456)).toBe(1234.56)
    })
    test('0 paise → 0 rupees', () => {
      expect(fromPaise(0)).toBe(0)
    })
    test('100 paise → 1 rupee', () => {
      expect(fromPaise(100)).toBe(1)
    })
    test('101 paise → 1.01 rupees', () => {
      expect(fromPaise(101)).toBe(1.01)
    })
    test('negative: -50025 paise → -500.25 rupees', () => {
      expect(fromPaise(-50025)).toBe(-500.25)
    })
    test('null → 0', () => {
      expect(fromPaise(null)).toBe(0)
    })
    test('undefined → 0', () => {
      expect(fromPaise(undefined)).toBe(0)
    })
  })

  // ─── Round-trip (toPaise/fromPaise are inverse) ──────────────────────────

  describe('round-trip: fromPaise(toPaise(x)) === roundMoney(x)', () => {
    test('1234.56 → 123456 → 1234.56', () => {
      expect(fromPaise(toPaise(1234.56))).toBe(1234.56)
    })
    test('0.01 → 1 → 0.01', () => {
      expect(fromPaise(toPaise(0.01))).toBe(0.01)
    })
    test('1.005 → 101 → 1.01 (float-corrected)', () => {
      // 1.005 is rounded to 1.01 during toPaise (the nudge fixes it)
      // So the round-trip gives 1.01, not 1.005 — this is correct behavior
      expect(fromPaise(toPaise(1.005))).toBe(1.01)
    })
    test('9999999.99 → 999999999 → 9999999.99', () => {
      expect(fromPaise(toPaise(9999999.99))).toBe(9999999.99)
    })
  })

  // ─── formatPaise ─────────────────────────────────────────────────────────

  describe('formatPaise (paise → display string)', () => {
    test('123456 → ₹1,234.56', () => {
      expect(formatPaise(123456)).toBe('₹1,234.56')
    })
    test('0 → ₹0.00', () => {
      expect(formatPaise(0)).toBe('₹0.00')
    })
    test('100 → ₹1.00', () => {
      expect(formatPaise(100)).toBe('₹1.00')
    })
    test('101 → ₹1.01', () => {
      expect(formatPaise(101)).toBe('₹1.01')
    })
    test('-50025 → -₹500.25', () => {
      expect(formatPaise(-50025)).toBe('-₹500.25')
    })
    test('null → ₹0.00', () => {
      expect(formatPaise(null)).toBe('₹0.00')
    })
    test('🔥 matches formatINR(fromPaise(x)) for all values', () => {
      const values = [0, 1, 100, 101, 123456, -50025, 999999999, 50, 5]
      for (const v of values) {
        expect(formatPaise(v)).toBe(formatINR(fromPaise(v)))
      }
    })
  })

  // ─── addPaise ────────────────────────────────────────────────────────────

  describe('addPaise (integer addition — no float drift)', () => {
    test('100 + 200 + 50 = 350', () => {
      expect(addPaise(100, 200, 50)).toBe(350)
    })
    test('123456 + (-50000) = 73456', () => {
      expect(addPaise(123456, -50000)).toBe(73456)
    })
    test('no args → 0', () => {
      expect(addPaise()).toBe(0)
    })
    test('null treated as 0', () => {
      expect(addPaise(null as any, 100, null as any)).toBe(100)
    })
    test('🔥 no float drift: 0.1 + 0.2 in paise = 30 (not 30.000000000000004)', () => {
      // In rupees: 0.1 + 0.2 = 0.30000000000000004 (float artifact)
      // In paise: 10 + 20 = 30 (exact integer)
      expect(addPaise(10, 20)).toBe(30)
      expect(addPaise(10, 20)).not.toBe(30.000000000000004)
    })
  })

  // ─── multiplyPaise ───────────────────────────────────────────────────────

  describe('multiplyPaise (quantity × unitPrice in paise)', () => {
    test('2 units × ₹50.00 (5000 paise) = ₹100.00 (10000 paise)', () => {
      expect(multiplyPaise(2, 5000)).toBe(10000)
    })
    test('0.5 kg × ₹20.00 (2000 paise) = ₹10.00 (1000 paise)', () => {
      expect(multiplyPaise(0.5, 2000)).toBe(1000)
    })
    test('3 pcs × ₹28.00 (2800 paise) = ₹84.00 (8400 paise)', () => {
      expect(multiplyPaise(3, 2800)).toBe(8400)
    })
    test('0 × anything = 0', () => {
      expect(multiplyPaise(0, 5000)).toBe(0)
    })
    test('anything × 0 = 0', () => {
      expect(multiplyPaise(10, 0)).toBe(0)
    })
    test('🔥 fractional qty: 0.333 × ₹30.00 (3000 paise) = ₹9.99 (999 paise)', () => {
      // 0.333 × 3000 = 999.0 → Math.round(999.0) = 999
      expect(multiplyPaise(0.333, 3000)).toBe(999)
    })
    test('🔥 fractional qty rounding: 0.335 × ₹30.00 (3000 paise) = ₹10.05 (1005 paise)', () => {
      // 0.335 × 3000 = 1005.0 → Math.round(1005.0) = 1005
      expect(multiplyPaise(0.335, 3000)).toBe(1005)
    })
  })

  // ─── calculateGstPaise ───────────────────────────────────────────────────

  describe('calculateGstPaise (GST in paise — no float drift)', () => {
    test('₹1000 (100000 paise) × 18% = ₹180.00 (18000 paise)', () => {
      expect(calculateGstPaise(100000, 18)).toBe(18000)
    })
    test('₹500 (50000 paise) × 5% = ₹25.00 (2500 paise)', () => {
      expect(calculateGstPaise(50000, 5)).toBe(2500)
    })
    test('₹100 (10000 paise) × 0% = 0', () => {
      expect(calculateGstPaise(10000, 0)).toBe(0)
    })
    test('₹28 (2800 paise) × 28% = ₹7.84 (784 paise)', () => {
      expect(calculateGstPaise(2800, 28)).toBe(784)
    })
    test('🔥 no float drift: ₹1.01 (101 paise) × 18% = ₹0.18 (18.18 → 18 paise)', () => {
      // In rupees: 1.01 * 18 / 100 = 0.18180000000000002 (float artifact)
      // In paise: 101 * 18 / 100 = 18.18 → Math.round(18.18) = 18
      expect(calculateGstPaise(101, 18)).toBe(18)
      expect(calculateGstPaise(101, 18)).not.toBe(18.000000000000004)
    })
  })

  // ─── splitGstPaise ───────────────────────────────────────────────────────

  describe('splitGstPaise (CGST + SGST in paise — exact sum)', () => {
    test('18000 paise → { cgst: 9000, sgst: 9000 }', () => {
      const result = splitGstPaise(18000)
      expect(result.cgst).toBe(9000)
      expect(result.sgst).toBe(9000)
      expect(result.cgst + result.sgst).toBe(18000)
    })
    test('🔥 odd paise: 18001 → { cgst: 9001, sgst: 9000 } (extra paisa → CGST)', () => {
      const result = splitGstPaise(18001)
      expect(result.cgst).toBe(9001)
      expect(result.sgst).toBe(9000)
      expect(result.cgst + result.sgst).toBe(18001)  // exact sum
    })
    test('0 → { cgst: 0, sgst: 0 }', () => {
      const result = splitGstPaise(0)
      expect(result.cgst).toBe(0)
      expect(result.sgst).toBe(0)
    })
    test('🔥 cgst + sgst === totalGst for ALL values (no drift)', () => {
      const values = [0, 1, 99, 100, 101, 18000, 18001, 2500, 2501, 999999]
      for (const v of values) {
        const result = splitGstPaise(v)
        expect(result.cgst + result.sgst).toBe(v)
      }
    })
    test('negative GST: -18000 → { cgst: -9000, sgst: -9000 }', () => {
      const result = splitGstPaise(-18000)
      expect(result.cgst).toBe(-9000)
      expect(result.sgst).toBe(-9000)
      expect(result.cgst + result.sgst).toBe(-18000)
    })
  })

  // ─── Cross-check: paise helpers vs rupee helpers ─────────────────────────

  describe('🔥 cross-check: paise helpers produce same results as rupee helpers', () => {
    test('calculateGstPaise(toPaise(x), rate) === toPaise(calculateGst(x, rate))', () => {
      const testCases = [
        { amount: 1000, rate: 18 },
        { amount: 500, rate: 5 },
        { amount: 28, rate: 28 },
        { amount: 1.01, rate: 18 },
        { amount: 1234.56, rate: 12 },
      ]
      for (const { amount, rate } of testCases) {
        const paiseResult = calculateGstPaise(toPaise(amount), rate)
        const rupeeResult = toPaise(require('@/lib/money').calculateGst(amount, rate))
        expect(paiseResult).toBe(rupeeResult)
      }
    })

    test('splitGstPaise(toPaise(x)) === { cgst: toPaise(cgst), sgst: toPaise(sgst) }', () => {
      const testCases = [1800, 1801, 3600, 99, 100, 101, 2500]
      for (const gstRupees of testCases) {
        const paiseResult = splitGstPaise(toPaise(gstRupees))
        const rupeeResult = require('@/lib/money').splitGst(gstRupees)
        expect(paiseResult.cgst).toBe(toPaise(rupeeResult.cgst))
        expect(paiseResult.sgst).toBe(toPaise(rupeeResult.sgst))
      }
    })
  })
})
