/**
 * Tests for validation.ts — zod request body validation
 *
 * 🔒 AUDIT FIX H7: Tests verify that the zod schemas catch invalid input
 * that previously caused 500s or stored garbage data.
 */
import { validateBody, createTransactionSchema, updateTransactionSchema, createProductSchema, createPartySchema } from '@/lib/validation'

describe('validation.ts — Zod request body validation', () => {
  describe('createTransactionSchema', () => {
    it('accepts a valid sale transaction', () => {
      const valid = {
        type: 'sale',
        partyId: 'party-123',
        items: [
          { productName: 'Sugar', quantity: 2, unitPrice: 50 },
          { productName: 'Tea', quantity: 1, unitPrice: 200, gstRate: 5 },
        ],
        paymentMode: 'cash',
        notes: 'Test transaction',
      }
      const result = validateBody(createTransactionSchema, valid)
      expect(result.success).toBe(true)
    })

    it('rejects invalid transaction type', () => {
      const invalid = { type: 'invalid_type', items: [] }
      const result = validateBody(createTransactionSchema, invalid)
      expect(result.success).toBe(false)
      expect(result.error).toContain('type')
    })

    it('rejects negative unit price', () => {
      const invalid = {
        type: 'sale',
        items: [{ productName: 'Test', quantity: 1, unitPrice: -50 }],
      }
      const result = validateBody(createTransactionSchema, invalid)
      expect(result.success).toBe(false)
      expect(result.error).toContain('unitPrice')
    })

    it('rejects negative quantity', () => {
      const invalid = {
        type: 'sale',
        items: [{ productName: 'Test', quantity: -5, unitPrice: 50 }],
      }
      const result = validateBody(createTransactionSchema, invalid)
      expect(result.success).toBe(false)
      expect(result.error).toContain('quantity')
    })

    it('rejects empty product name', () => {
      const invalid = {
        type: 'sale',
        items: [{ productName: '', quantity: 1, unitPrice: 50 }],
      }
      const result = validateBody(createTransactionSchema, invalid)
      expect(result.success).toBe(false)
      expect(result.error).toContain('productName')
    })

    it('rejects notes over 5000 characters', () => {
      const invalid = {
        type: 'sale',
        items: [{ productName: 'Test', quantity: 1, unitPrice: 50 }],
        notes: 'x'.repeat(5001),
      }
      const result = validateBody(createTransactionSchema, invalid)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Notes')
    })

    it('accepts income/expense without items', () => {
      const valid = {
        type: 'income',
        totalAmount: 5000,
        category: 'Commission',
        paymentMode: 'upi',
      }
      const result = validateBody(createTransactionSchema, valid)
      expect(result.success).toBe(true)
    })

    it('rejects invalid payment mode', () => {
      const invalid = {
        type: 'sale',
        items: [{ productName: 'Test', quantity: 1, unitPrice: 50 }],
        paymentMode: 'bitcoin',
      }
      const result = validateBody(createTransactionSchema, invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('updateTransactionSchema', () => {
    it('accepts valid update with items', () => {
      const valid = {
        type: 'sale',
        items: [{ productName: 'Updated Product', quantity: 3, unitPrice: 75 }],
      }
      const result = validateBody(updateTransactionSchema, valid)
      expect(result.success).toBe(true)
    })
  })

  describe('createProductSchema', () => {
    it('accepts a valid product', () => {
      const valid = {
        name: 'Sugar',
        purchasePrice: 40,
        salePrice: 50,
        gstRate: 5,
        unit: 'kg',
      }
      const result = validateBody(createProductSchema, valid)
      expect(result.success).toBe(true)
    })

    it('rejects empty name', () => {
      const invalid = { name: '' }
      const result = validateBody(createProductSchema, invalid)
      expect(result.success).toBe(false)
    })

    it('rejects negative price', () => {
      const invalid = { name: 'Test', salePrice: -10 }
      const result = validateBody(createProductSchema, invalid)
      expect(result.success).toBe(false)
    })

    it('rejects GST rate over 100', () => {
      const invalid = { name: 'Test', gstRate: 150 }
      const result = validateBody(createProductSchema, invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('createPartySchema', () => {
    it('accepts a valid party', () => {
      const valid = {
        name: 'Ramesh General Store',
        type: 'customer',
        phone: '9876543210',
        state: 'Maharashtra',
      }
      const result = validateBody(createPartySchema, valid)
      expect(result.success).toBe(true)
    })

    it('rejects empty name', () => {
      const invalid = { name: '' }
      const result = validateBody(createPartySchema, invalid)
      expect(result.success).toBe(false)
    })

    it('rejects invalid email', () => {
      const invalid = { name: 'Test', email: 'not-an-email' }
      const result = validateBody(createPartySchema, invalid)
      expect(result.success).toBe(false)
    })

    it('accepts empty email string', () => {
      const valid = { name: 'Test', email: '' }
      const result = validateBody(createPartySchema, valid)
      expect(result.success).toBe(true)
    })
  })

  describe('validateBody', () => {
    it('returns success with data on valid input', () => {
      const result = validateBody(createProductSchema, { name: 'Test' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeDefined()
      }
    })

    it('returns error string on invalid input', () => {
      const result = validateBody(createProductSchema, { name: '' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(typeof result.error).toBe('string')
        expect(result.error.length).toBeGreaterThan(0)
      }
    })
  })
})
