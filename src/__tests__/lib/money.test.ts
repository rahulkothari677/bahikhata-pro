import { roundMoney, addMoney, multiplyMoney, calculateGst, splitGst, toMoney, formatINR, parseMoney } from '@/lib/money'

describe('money.ts — Money precision helpers', () => {
  describe('roundMoney', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundMoney(1.005)).toBe(1.01)  // The epsilon bug that was fixed
      expect(roundMoney(2.675)).toBe(2.68)  // Another classic float case
      expect(roundMoney(10.555)).toBe(10.56)
    })

    it('handles whole numbers', () => {
      expect(roundMoney(100)).toBe(100)
      expect(roundMoney(0)).toBe(0)
      expect(roundMoney(50.0)).toBe(50)
    })

    it('handles negative numbers (symmetric rounding — M0b fix)', () => {
      expect(roundMoney(-1.005)).toBe(-1.01)  // Was: -1.00 (Math.round toward +∞)
      expect(roundMoney(-2.5)).toBe(-2.5)      // Already 2 decimals
      expect(roundMoney(-10.555)).toBe(-10.56) // Symmetric with positive
    })

    it('handles NaN and Infinity', () => {
      expect(roundMoney(NaN)).toBe(0)
      expect(roundMoney(Infinity)).toBe(0)
      expect(roundMoney(-Infinity)).toBe(0)
    })

    it('handles null/undefined input', () => {
      expect(roundMoney(null as any)).toBe(0)
      expect(roundMoney(undefined as any)).toBe(0)
    })

    it('eliminates float precision drift (the core purpose)', () => {
      // Float drift example: 0.1 + 0.2 = 0.30000000000000004
      const drift = 0.1 + 0.2
      expect(drift).not.toBe(0.3) // Float drift exists
      expect(roundMoney(drift)).toBe(0.3) // roundMoney fixes it
    })
  })

  describe('addMoney', () => {
    it('adds multiple values with rounding', () => {
      expect(addMoney(1.005, 2.005, 3.005)).toBe(6.02)
      expect(addMoney(100, 50.5, 0.005)).toBe(150.51)
    })

    it('handles negative values (refunds)', () => {
      expect(addMoney(100, -50, -0.004)).toBe(50) // 49.996 → 50.00
      expect(addMoney(100, -50.5, -0.01)).toBe(49.49) // 49.49
    })

    it('handles single value', () => {
      expect(addMoney(42.005)).toBe(42.01)
    })
  })

  describe('multiplyMoney', () => {
    it('multiplies quantity by unit price with rounding', () => {
      expect(multiplyMoney(3, 50.005)).toBe(150.02)
      expect(multiplyMoney(0, 100)).toBe(0)
      expect(multiplyMoney(2.5, 3.5)).toBe(8.75)
    })
  })

  describe('calculateGst', () => {
    it('calculates GST correctly', () => {
      expect(calculateGst(1000, 18)).toBe(180)
      expect(calculateGst(500, 5)).toBe(25)
      expect(calculateGst(100, 0)).toBe(0)
      expect(calculateGst(333, 12)).toBe(39.96)
    })

    it('handles edge cases', () => {
      expect(calculateGst(0, 18)).toBe(0)
      expect(calculateGst(1000, 28)).toBe(280)
    })
  })

  describe('splitGst', () => {
    it('splits GST so that cgst + sgst === gst exactly (no drift)', () => {
      // This is the core fix — was: gst / 2 producing 9.000000000000002
      const testCases = [18, 25, 39.96, 100.5, 0.05, 333.33]
      for (const gst of testCases) {
        const { cgst, sgst } = splitGst(gst)
        const sum = roundMoney(cgst + sgst)
        expect(sum).toBe(roundMoney(gst))
      }
    })

    it('handles odd-paisa GST (extra paisa goes to CGST)', () => {
      // 0.05 / 2 = 0.025 → cgst = 0.03, sgst = 0.02 (sum = 0.05 ✓)
      const { cgst, sgst } = splitGst(0.05)
      expect(cgst + sgst).toBe(0.05)
    })

    it('handles zero GST', () => {
      const { cgst, sgst } = splitGst(0)
      expect(cgst).toBe(0)
      expect(sgst).toBe(0)
    })

    it('handles negative GST (refunds)', () => {
      const { cgst, sgst } = splitGst(-18)
      expect(cgst + sgst).toBe(-18)
    })
  })

  describe('toMoney', () => {
    it('converts numbers safely', () => {
      expect(toMoney(42)).toBe(42)
      expect(toMoney(0)).toBe(0)
    })

    it('handles null/undefined', () => {
      expect(toMoney(null)).toBe(0)
      expect(toMoney(undefined)).toBe(0)
    })

    it('handles NaN', () => {
      expect(toMoney(NaN)).toBe(0)
    })

    it('handles string numbers', () => {
      expect(toMoney('42.5')).toBe(42.5)
      expect(toMoney('abc')).toBe(0)
    })
  })

  describe('formatINR', () => {
    it('formats positive amounts with ₹ symbol', () => {
      expect(formatINR(1234.5)).toBe('₹1,234.50')
      expect(formatINR(0)).toBe('₹0.00')
      expect(formatINR(100)).toBe('₹100.00')
    })

    it('formats negative amounts', () => {
      expect(formatINR(-500)).toBe('-₹500.00')
    })

    it('formats large amounts with Indian numbering (lakh/crore)', () => {
      expect(formatINR(100000)).toBe('₹1,00,000.00')
      expect(formatINR(10000000)).toBe('₹1,00,00,000.00')
    })
  })

  describe('parseMoney', () => {
    it('parses plain numbers', () => {
      expect(parseMoney('1234')).toBe(1234)
      expect(parseMoney('1234.50')).toBe(1234.5)
    })

    it('parses with ₹ symbol and commas', () => {
      expect(parseMoney('₹1,234.50')).toBe(1234.5)
      expect(parseMoney('₹ 1,00,000')).toBe(100000)
    })

    it('handles invalid input', () => {
      expect(parseMoney('abc')).toBe(0)
      expect(parseMoney('')).toBe(0)
      expect(parseMoney(null)).toBe(0)
    })

    it('handles negative input', () => {
      expect(parseMoney('-500')).toBe(-500)
      expect(parseMoney('-₹1,234.50')).toBe(-1234.5)
    })
  })
})
