/**
 * V17 Audit Phase 5 — Technical error tests for new code.
 *
 * Tests:
 * 1. gstTreatment Zod validation (createProductSchema + updateProductSchema)
 * 2. Edge cases for net-sales helpers (null safety, zero values, mixed signs)
 * 3. Data integrity: gstTreatment enum rejects invalid values
 *
 * These tests cover the TECHNICAL error class (not just calculation):
 * - Input validation (zod rejects bad data)
 * - Null/undefined safety
 * - Edge cases (zero, negative, empty)
 * - Data integrity (enum enforcement)
 */

import {
  createProductSchema,
  updateProductSchema,
} from '@/lib/validation'
import {
  netSalesProfit,
  netSalesTaxable,
  netOutputTax,
  netSalesTotal,
  type TypeAggregates,
} from '@/lib/net-sales'

describe('🔒 V17 Audit Phase 5 — gstTreatment Zod validation', () => {
  const validBase = {
    name: 'Test Product',
    purchasePrice: 100,
    salePrice: 150,
    gstRate: 18,
  }

  describe('createProductSchema', () => {
    test('accepts gstTreatment = "taxable"', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'taxable' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.gstTreatment).toBe('taxable')
    })

    test('accepts gstTreatment = "nil"', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'nil' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.gstTreatment).toBe('nil')
    })

    test('accepts gstTreatment = "exempt"', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'exempt' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.gstTreatment).toBe('exempt')
    })

    test('accepts gstTreatment = "nonGst"', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'nonGst' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.gstTreatment).toBe('nonGst')
    })

    test('defaults to "taxable" when gstTreatment is omitted', () => {
      const result = createProductSchema.safeParse(validBase)
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.gstTreatment).toBe('taxable')
    })

    test('REJECTS invalid gstTreatment value', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'invalid' })
      expect(result.success).toBe(false)
    })

    test('REJECTS gstTreatment = "TAXABLE" (case-sensitive)', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'TAXABLE' })
      expect(result.success).toBe(false)
    })

    test('REJECTS gstTreatment = "exempt " (trailing space)', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'exempt ' })
      expect(result.success).toBe(false)
    })

    test('REJECTS gstTreatment = "owner" (privilege escalation attempt)', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 'owner' })
      expect(result.success).toBe(false)
    })

    test('REJECTS empty string gstTreatment', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: '' })
      expect(result.success).toBe(false)
    })

    test('REJECTS number gstTreatment (type safety)', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: 123 })
      expect(result.success).toBe(false)
    })

    test('REJECTS null gstTreatment', () => {
      const result = createProductSchema.safeParse({ ...validBase, gstTreatment: null })
      expect(result.success).toBe(false)
    })
  })

  describe('updateProductSchema', () => {
    test('accepts gstTreatment = "exempt"', () => {
      const result = updateProductSchema.safeParse({ gstTreatment: 'exempt' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.gstTreatment).toBe('exempt')
    })

    test('accepts omitted gstTreatment (optional on update)', () => {
      const result = updateProductSchema.safeParse({ name: 'Updated' })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.gstTreatment).toBeUndefined()
    })

    test('REJECTS invalid gstTreatment on update', () => {
      const result = updateProductSchema.safeParse({ gstTreatment: 'invalid' })
      expect(result.success).toBe(false)
    })

    test('REJECTS gstTreatment = "admin" on update (privilege escalation)', () => {
      const result = updateProductSchema.safeParse({ gstTreatment: 'admin' })
      expect(result.success).toBe(false)
    })
  })
})

describe('🔒 V17 Audit Phase 5 — net-sales edge cases (technical error class)', () => {
  describe('null/undefined safety', () => {
    test('netSalesProfit handles null sale', () => {
      expect(netSalesProfit(null, { grossProfit: -900 })).toBe(-900)
    })

    test('netSalesProfit handles null creditNote', () => {
      expect(netSalesProfit({ grossProfit: 3000 }, null)).toBe(3000)
    })

    test('netSalesProfit handles both null', () => {
      expect(netSalesProfit(null, null)).toBe(0)
    })

    test('netSalesProfit handles undefined', () => {
      expect(netSalesProfit(undefined, undefined)).toBe(0)
    })

    test('netSalesTaxable handles null', () => {
      expect(netSalesTaxable(null, null)).toBe(0)
    })

    test('netOutputTax handles null', () => {
      expect(netOutputTax(null, null)).toBe(0)
    })

    test('netSalesTotal handles null', () => {
      expect(netSalesTotal(null, null)).toBe(0)
    })
  })

  describe('zero values', () => {
    test('netSalesProfit with zero grossProfit on both', () => {
      expect(netSalesProfit({ grossProfit: 0 }, { grossProfit: 0 })).toBe(0)
    })

    test('netSalesTaxable with zero subtotal', () => {
      expect(netSalesTaxable({ subtotal: 0, discountAmount: 0 }, { subtotal: 0, discountAmount: 0 })).toBe(0)
    })

    test('netOutputTax with zero GST', () => {
      expect(netOutputTax({ cgst: 0, sgst: 0, igst: 0 }, { cgst: 0, sgst: 0, igst: 0 })).toBe(0)
    })
  })

  describe('mixed signs (real-world scenarios)', () => {
    test('sale with positive profit + credit note with zero profit (unlinked items)', () => {
      // Credit note for a product with no purchasePrice (unlinked) → grossProfit = 0
      const sale: TypeAggregates = { grossProfit: 3000 }
      const cn: TypeAggregates = { grossProfit: 0 }  // no profit reversal (unlinked item)
      expect(netSalesProfit(sale, cn)).toBe(3000)  // full profit retained
    })

    test('sale with positive profit + credit note with negative profit (linked items)', () => {
      const sale: TypeAggregates = { grossProfit: 3000 }
      const cn: TypeAggregates = { grossProfit: -900 }  // negative (linked item with cost)
      expect(netSalesProfit(sale, cn)).toBe(2100)
    })

    test('full return: sale profit + credit note negative = zero', () => {
      const sale: TypeAggregates = { grossProfit: 3000 }
      const cn: TypeAggregates = { grossProfit: -3000 }
      expect(netSalesProfit(sale, cn)).toBe(0)
    })

    test('credit note larger than sale (over-return)', () => {
      const sale: TypeAggregates = { grossProfit: 3000 }
      const cn: TypeAggregates = { grossProfit: -5000 }
      expect(netSalesProfit(sale, cn)).toBe(-2000)  // net loss
    })
  })

  describe('float precision (₹0.01 edges)', () => {
    test('netSalesProfit handles float artifacts', () => {
      const sale: TypeAggregates = { grossProfit: 100.01 }
      const cn: TypeAggregates = { grossProfit: -33.33 }
      // 100.01 + (-33.33) = 66.68 (no float artifacts after roundMoney)
      expect(netSalesProfit(sale, cn)).toBe(66.68)
    })

    test('netOutputTax handles odd-paise GST', () => {
      const sale: TypeAggregates = { cgst: 4.51, sgst: 4.51, igst: 0 }
      const cn: TypeAggregates = { cgst: -1.50, sgst: -1.50, igst: 0 }
      // Note: credit-note GST is stored POSITIVE, so this test uses negative
      // values to simulate a hypothetical. In reality, cn.cgst = 1.50 (positive).
      // This test verifies the helper handles negative inputs gracefully.
      expect(netOutputTax(sale, cn)).toBe(12.02)  // (4.51+4.51) - (-1.50-1.50) = 9.02 + 3.00
    })
  })

  describe('data integrity — no silent data loss', () => {
    test('netSalesTaxable with discount on both', () => {
      const sale: TypeAggregates = { subtotal: 10000, discountAmount: 1000 }
      const cn: TypeAggregates = { subtotal: 3000, discountAmount: 300 }
      // sale taxable = 9000, cn taxable = 2700, net = 6300
      expect(netSalesTaxable(sale, cn)).toBe(6300)
    })

    test('netSalesTotal with large values (no overflow)', () => {
      const sale: TypeAggregates = { totalAmount: 9999999.99 }
      const cn: TypeAggregates = { totalAmount: 3333333.33 }
      expect(netSalesTotal(sale, cn)).toBe(6666666.66)
    })
  })
})
