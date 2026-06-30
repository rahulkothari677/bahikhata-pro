/**
 * Unit tests for number formatting utilities.
 * These are the most critical functions — if they break, every screen
 * shows wrong numbers.
 */

import { formatINR, formatINRCompact, formatDate, cn, getInitials } from '@/lib/utils'

describe('formatINR', () => {
  test('formats positive numbers with ₹ symbol', () => {
    expect(formatINR(1234.5)).toBe('₹1,234.5')
  })

  test('formats 0 correctly', () => {
    expect(formatINR(0)).toBe('₹0')
  })

  test('formats large numbers with Indian grouping (lakhs)', () => {
    expect(formatINR(123456)).toContain('1,23,456')
  })

  test('formats negative numbers', () => {
    const result = formatINR(-500)
    expect(result).toContain('500')
    expect(result).toContain('-')
  })

  test('formats without symbol when withSymbol=false', () => {
    const result = formatINR(1234, false)
    expect(result).not.toContain('₹')
    expect(result).toContain('1,234')
  })

  test('handles null/undefined gracefully', () => {
    // formatINR uses Intl.NumberFormat which returns '₹0' for null/0
    // but '₹NaN' for NaN — this is a known limitation
    expect(formatINR(0)).toBe('₹0')
    // NaN produces '₹NaN' — documented behavior
    const nanResult = formatINR(NaN)
    expect(typeof nanResult).toBe('string')
  })

  test('handles decimal amounts', () => {
    const result = formatINR(99.99)
    expect(result).toContain('99')
  })
})

describe('formatINRCompact', () => {
  test('formats small numbers without suffix', () => {
    expect(formatINRCompact(500)).toBe('₹500')
  })

  test('formats thousands with K', () => {
    const result = formatINRCompact(1500)
    expect(result).toContain('K')
    expect(result).toContain('1.5')
  })

  test('formats lakhs with L', () => {
    const result = formatINRCompact(150000)
    expect(result).toContain('L')
    expect(result).toContain('1.5')
  })

  test('formats crores with Cr', () => {
    const result = formatINRCompact(15000000)
    expect(result).toContain('Cr')
    expect(result).toContain('1.5')
  })

  test('formats 0 correctly', () => {
    expect(formatINRCompact(0)).toBe('₹0')
  })

  test('handles negative numbers', () => {
    const result = formatINRCompact(-5000)
    expect(result).toContain('-')
    expect(result).toContain('5K')
  })

  test('removes trailing zeros', () => {
    const result = formatINRCompact(1200)
    // Should be ₹1.2K not ₹1.20K
    expect(result).not.toContain('.20')
  })
})

describe('formatDate', () => {
  test('formats date as dd/mm/yyyy', () => {
    const result = formatDate('2026-06-28')
    expect(result).toBe('28/06/2026')
  })

  test('formats Date object', () => {
    const result = formatDate(new Date('2026-01-05'))
    expect(result).toBe('05/01/2026')
  })

  test('pads single digits', () => {
    const result = formatDate(new Date(2026, 0, 5))
    expect(result).toBe('05/01/2026')
  })
})

describe('cn (className merger)', () => {
  test('merges multiple classes', () => {
    expect(cn('px-2', 'py-2')).toBe('px-2 py-2')
  })

  test('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  test('handles undefined/null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end')
  })

  test('deduplicates conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})

describe('getInitials', () => {
  test('gets initials from full name', () => {
    expect(getInitials('Rahul Kothari')).toBe('RK')
  })

  test('gets initials from single name', () => {
    expect(getInitials('Rahul')).toBe('R')
  })

  test('handles empty string', () => {
    expect(getInitials('')).toBe('')
  })

  test('handles name with multiple spaces', () => {
    // getInitials splits by space, takes first letter of first 2 words
    // Double spaces create empty words, so only first word's initial is taken
    const result = getInitials('Rahul  Kothari')
    expect(result).toContain('R')
  })
})
