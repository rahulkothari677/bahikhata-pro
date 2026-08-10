/**
 * 🔒 Settle's payment direction — the one that costs twice the amount.
 *
 * A payment recorded in the wrong direction does not merely fail to clear the
 * debt. It moves the balance the wrong way, so the error is 2x the payment:
 * collect ₹1,075 from a customer, record it as money paid out, and the books
 * now say they owe ₹2,150 instead of nothing.
 *
 * The invariant every test here defends is that the direction can never
 * contradict the label the shopkeeper is reading on the same screen.
 */

import { describe, test, expect } from '@jest/globals'
import { defaultSettleDirection, directionContradictsBalance } from '@/lib/settle-direction'

describe('defaultSettleDirection', () => {
  describe('the sign of the balance decides, not who the party is', () => {
    test('anyone who owes us is collected from', () => {
      expect(defaultSettleDirection('customer', 1075)).toBe('received')
      // A SUPPLIER who owes us — after a return, an overpayment, or a debit
      // note. The old rule asked the party type first and answered "paid" here,
      // while the screen said "They owe you".
      expect(defaultSettleDirection('supplier', 1075)).toBe('received')
    })

    test('anyone we owe is paid', () => {
      expect(defaultSettleDirection('supplier', -1025)).toBe('paid')
      // A CUSTOMER we owe — credit notes exceeding their bills, or an advance
      // being returned.
      expect(defaultSettleDirection('customer', -1025)).toBe('paid')
    })
  })

  describe('at exactly zero there is no sign to read', () => {
    test('party type breaks the tie, because nothing else can', () => {
      expect(defaultSettleDirection('supplier', 0)).toBe('paid')
      expect(defaultSettleDirection('customer', 0)).toBe('received')
    })

    test('an unknown or missing party type still answers', () => {
      expect(defaultSettleDirection(null, 0)).toBe('received')
      expect(defaultSettleDirection(undefined, 0)).toBe('received')
      expect(defaultSettleDirection('', 0)).toBe('received')
    })
  })

  /*
   * THE INVARIANT ITSELF, asserted rather than restated.
   *
   * Swept across both party types and a range of balances that includes the
   * boundary, so a future edit to the rule cannot introduce a combination
   * where the dropdown argues with the label.
   */
  test('the default NEVER contradicts the balance label', () => {
    for (const type of ['customer', 'supplier', null, undefined, 'other']) {
      for (const balance of [-100000, -2150, -1025, -0.01, 0, 0.01, 1075, 2150, 100000]) {
        const direction = defaultSettleDirection(type, balance)
        expect({ type, balance, direction, contradicts: directionContradictsBalance(direction, balance) })
          .toEqual({ type, balance, direction, contradicts: false })
      }
    }
  })
})

describe('directionContradictsBalance', () => {
  test('catches both backwards cases', () => {
    expect(directionContradictsBalance('paid', 1075)).toBe(true)      // they owe us, paying out
    expect(directionContradictsBalance('received', -1025)).toBe(true) // we owe them, collecting
  })

  test('accepts both correct cases', () => {
    expect(directionContradictsBalance('received', 1075)).toBe(false)
    expect(directionContradictsBalance('paid', -1025)).toBe(false)
  })

  test('a square account can honestly be settled either way', () => {
    // An advance in either direction is a real thing to record against a party
    // who currently owes nothing, so neither reading is a contradiction.
    expect(directionContradictsBalance('received', 0)).toBe(false)
    expect(directionContradictsBalance('paid', 0)).toBe(false)
  })
})
