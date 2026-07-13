/**
 * 🔒 V17 Audit Phase 10 — Decimal quantity validation tests.
 *
 * Tests:
 * 1. Zod schema rejects decimal quantities for count units (pcs, dozen, box)
 * 2. Zod schema accepts decimal quantities for weight/volume units (kg, gm, ltr, ml)
 * 3. isCountUnit() correctly identifies count vs non-count units
 * 4. stepForUnit() returns correct step attributes
 * 5. Null/undefined safety
 */

import {
  isCountUnit,
  stepForUnit,
  normalizeUnitName,
} from '@/lib/units'
import { transactionItemSchema } from '@/lib/validation'

describe('🔒 V17 Audit Phase 10 — Decimal quantity validation', () => {

  describe('isCountUnit', () => {
    test('pcs is a count unit', () => {
      expect(isCountUnit('pcs')).toBe(true)
    })
    test('dozen is a count unit', () => {
      expect(isCountUnit('dozen')).toBe(true)
    })
    test('box is a count unit', () => {
      expect(isCountUnit('box')).toBe(true)
    })
    test('packet is a count unit', () => {
      expect(isCountUnit('packet')).toBe(true)
    })
    test('kg is NOT a count unit', () => {
      expect(isCountUnit('kg')).toBe(false)
    })
    test('gm is NOT a count unit', () => {
      expect(isCountUnit('gm')).toBe(false)
    })
    test('ltr is NOT a count unit', () => {
      expect(isCountUnit('ltr')).toBe(false)
    })
    test('ml is NOT a count unit', () => {
      expect(isCountUnit('ml')).toBe(false)
    })
    test('null defaults to count (pcs)', () => {
      expect(isCountUnit(null)).toBe(true)
    })
    test('undefined defaults to count (pcs)', () => {
      expect(isCountUnit(undefined)).toBe(true)
    })
    test('empty string defaults to count (pcs)', () => {
      expect(isCountUnit('')).toBe(true)
    })
    test('unknown unit defaults to non-count (allows decimals for safety)', () => {
      expect(isCountUnit('custom')).toBe(false)
    })
    test('case insensitive', () => {
      expect(isCountUnit('PCS')).toBe(true)
      expect(isCountUnit('Dozen')).toBe(true)
    })
  })

  describe('stepForUnit', () => {
    test('count units → step=1 (whole numbers only)', () => {
      expect(stepForUnit('pcs')).toBe('1')
      expect(stepForUnit('dozen')).toBe('1')
      expect(stepForUnit('box')).toBe('1')
    })
    test('weight/volume units → step=0.001 (decimals allowed)', () => {
      expect(stepForUnit('kg')).toBe('0.001')
      expect(stepForUnit('gm')).toBe('0.001')
      expect(stepForUnit('ltr')).toBe('0.001')
      expect(stepForUnit('ml')).toBe('0.001')
    })
    test('null → step=1 (default to count)', () => {
      expect(stepForUnit(null)).toBe('1')
    })
  })

  describe('Zod transactionItemSchema — count unit integer validation', () => {
    const validBase = {
      productName: 'Test Product',
      unitPrice: 50,
    }

    test('accepts whole number quantity for pcs', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 10,
        unit: 'pcs',
      })
      expect(result.success).toBe(true)
    })

    test('REJECTS decimal quantity for pcs (e.g., 22.02 pcs)', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 22.02,
        unit: 'pcs',
      })
      expect(result.success).toBe(false)
    })

    test('REJECTS decimal quantity for dozen (e.g., 1.5 dozen)', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 1.5,
        unit: 'dozen',
      })
      expect(result.success).toBe(false)
    })

    test('REJECTS decimal quantity for box', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 2.5,
        unit: 'box',
      })
      expect(result.success).toBe(false)
    })

    test('accepts decimal quantity for kg (e.g., 0.5 kg)', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 0.5,
        unit: 'kg',
      })
      expect(result.success).toBe(true)
    })

    test('accepts decimal quantity for gm (e.g., 500.5 gm)', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 500.5,
        unit: 'gm',
      })
      expect(result.success).toBe(true)
    })

    test('accepts decimal quantity for ltr (e.g., 1.5 ltr)', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 1.5,
        unit: 'ltr',
      })
      expect(result.success).toBe(true)
    })

    test('accepts decimal quantity for ml (e.g., 250.5 ml)', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 250.5,
        unit: 'ml',
      })
      expect(result.success).toBe(true)
    })

    test('rejects decimal for default unit (pcs) when unit is omitted', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 3.14,
        // unit omitted → defaults to 'pcs'
      })
      expect(result.success).toBe(false)
    })

    test('accepts whole number for default unit (pcs) when unit is omitted', () => {
      const result = transactionItemSchema.safeParse({
        ...validBase,
        quantity: 5,
        // unit omitted → defaults to 'pcs'
      })
      expect(result.success).toBe(true)
    })

    test('the exact bug scenario: 22.02 pcs Amul Taaza Milk → REJECTED', () => {
      const result = transactionItemSchema.safeParse({
        productName: 'Amul Taaza Milk 500ml',
        quantity: 22.02,
        unitPrice: 28,
        unit: 'pcs',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('whole number')
      }
    })
  })
})
