/**
 * 🔒 Never call someone a supplier because you owe them money.
 *
 * FOUND BY LOOKING AT THE SCREEN, which is the point worth recording. Every
 * network-level check of "total payables" passed — right figure, right receipt,
 * right total. The screen said:
 *
 *     You owe ₹1,025.00
 *     Across 1 supplier. Largest first.
 *       Anil Kumar        ₹1,025
 *
 * Anil Kumar is a CUSTOMER. The shop owes him because his credit notes exceed
 * his bills. The answer had inferred what he IS from which way his money
 * points, and told the shopkeeper something untrue about their own books.
 *
 * The same mistake as PartySettle's payment direction, fixed the same morning:
 * reading a stored fact is not the same as guessing it from a balance sign.
 */

import { describe, test, expect } from '@jest/globals'
import { describeParties } from '@/lib/describe-parties'

describe('describeParties', () => {
  test('THE BUG: a customer you owe is still a customer', () => {
    expect(describeParties([{ type: 'customer' }])).toBe('customer')
  })

  test('a supplier who owes you is still a supplier', () => {
    expect(describeParties([{ type: 'supplier' }])).toBe('supplier')
  })

  describe('number agreement, because the sentence already carries a count', () => {
    test('singular for one', () => {
      expect(describeParties([{ type: 'customer' }])).toBe('customer')
      expect(describeParties([{ type: 'supplier' }])).toBe('supplier')
    })
    test('plural for more', () => {
      expect(describeParties([{ type: 'customer' }, { type: 'customer' }])).toBe('customers')
      expect(describeParties([{ type: 'supplier' }, { type: 'supplier' }])).toBe('suppliers')
    })
  })

  test('a mixed list says so rather than picking the majority', () => {
    /*
     * Three customers and one supplier is not "4 customers". A shopkeeper
     * scanning a list headed "customers" should not find a supplier in it.
     */
    expect(describeParties([
      { type: 'customer' }, { type: 'customer' }, { type: 'customer' }, { type: 'supplier' },
    ])).toBe('customers and suppliers')
    expect(describeParties([{ type: 'supplier' }, { type: 'customer' }]))
      .toBe('customers and suppliers')
  })

  describe('an unknown type is not an excuse to invent one', () => {
    test.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['unrecognised', 'vendor'],
    ])('%s type falls back to the dull, true word', (_label, type) => {
      expect(describeParties([{ type }])).toBe('party')
      expect(describeParties([{ type }, { type }])).toBe('parties')
    })
  })

  test('an empty list is plural, matching "Across 0 parties"', () => {
    // Not reachable from the route today (it shows "Nobody has an outstanding
    // balance" instead), but the function must not be the thing that breaks if
    // that ever changes.
    expect(describeParties([])).toBe('parties')
  })
})
