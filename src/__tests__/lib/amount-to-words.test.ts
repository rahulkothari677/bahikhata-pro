/**
 * Unit tests for amount-to-words conversion.
 * Critical for invoices — if wrong, legal/compliance issues.
 */

import { amountToWords } from '@/lib/amount-to-words'

describe('amountToWords', () => {
  test('converts 0', () => {
    expect(amountToWords(0)).toContain('Zero')
    expect(amountToWords(0)).toContain('Rupees')
    expect(amountToWords(0)).toContain('Only')
  })

  test('converts simple numbers', () => {
    expect(amountToWords(100)).toContain('Hundred')
    expect(amountToWords(100)).toContain('Rupees')
  })

  test('converts thousands', () => {
    expect(amountToWords(1000)).toContain('Thousand')
  })

  test('converts lakhs (Indian system)', () => {
    expect(amountToWords(100000)).toContain('Lakh')
  })

  test('converts crores', () => {
    expect(amountToWords(10000000)).toContain('Crore')
  })

  test('converts with paise', () => {
    const result = amountToWords(125475.5)
    expect(result).toContain('Paise')
    expect(result).toContain('Fifty')
  })

  test('converts exact round numbers without paise', () => {
    const result = amountToWords(1000)
    expect(result).not.toContain('Paise')
  })

  test('handles very large numbers', () => {
    const result = amountToWords(99999999)
    expect(result).toContain('Crore')
    expect(result).toContain('Only')
  })

  test('handles negative numbers', () => {
    const result = amountToWords(-500)
    // Should still produce some output (not crash)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('always ends with "Only"', () => {
    expect(amountToWords(123)).toMatch(/Only$/)
    expect(amountToWords(0)).toMatch(/Only$/)
  })

  test('always contains "Rupees"', () => {
    expect(amountToWords(123)).toContain('Rupees')
  })

  test('handles NaN gracefully', () => {
    const result = amountToWords(NaN)
    expect(result).toContain('Zero')
  })

  test('handles Infinity gracefully', () => {
    const result = amountToWords(Infinity)
    expect(typeof result).toBe('string')
  })
})
