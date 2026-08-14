/**
 * 🔒 #70 — the least-sold answer, checked against known inputs.
 *
 * The question Rahul asked on 12 August — "sabse kam kya bika" — was refused
 * by the app. Before that it was answered with the product that sold MOST.
 *
 * These tests exist in this shape because of #76, the same morning: five
 * guards in three days were wrong precisely because the rule lived inside an
 * API route or a directory walk and could never be called with an input. So
 * the wording is a pure function, and every case below is one a shop will
 * actually hit.
 */

import { describe, test, expect } from '@jest/globals'
import { leastSoldAnswer, receiptAmount, soldNothing, type LeastSoldItem } from '@/lib/ask-least-sold'

/** Rupees, formatted the way the route formats them. */
const money = (n: number) => `₹${n.toFixed(2)}`

const item = (over: Partial<LeastSoldItem> = {}): LeastSoldItem => ({
  id: 'p1', name: 'Rice', qty: 0, value: 0, tiedUp: 0, unit: 'kg', ...over,
})

describe('an item that never sold', () => {
  test('the headline counts them, it does not name one', () => {
    /*
     * THE POINT OF THE WHOLE FEATURE. These items have no sale lines at all,
     * so a query grouped on sales can never surface them. Naming one would
     * also be arbitrary — there may be hundreds tied on zero.
     */
    const a = leastSoldAnswer(
      [item({ name: 'Rice', tiedUp: 4000 }), item({ id: 'p2', name: 'Dal', tiedUp: 900 })],
      14, 'this month', money,
    )
    expect(a.headline).toBe('14 items sold nothing this month')
    expect(a.soldNothing).toBe(true)
  })

  test('one item reads as "1 item", not "1 items"', () => {
    const a = leastSoldAnswer([item()], 1, 'this month', money)
    expect(a.headline).toBe('1 item sold nothing this month')
  })

  test('the detail names the money STUCK in it, not the ₹0 it earned', () => {
    /*
     * Every non-seller earned ₹0, so revenue cannot rank them and printing it
     * gives five identical lines — the fabricated-₹0 shape this codebase has
     * already fixed four times. What a shopkeeper needs is which one their
     * cash is sitting in.
     */
    const a = leastSoldAnswer([item({ name: 'Rice', tiedUp: 4000 })], 1, 'this month', money)
    expect(a.detail).toContain('Rice has the most money sitting in it')
    expect(a.detail).toContain('₹4000.00')
  })

  test('no sentence starts with a lower-case letter', () => {
    /*
     * The live answer printed "…₹2,500.00 of stock. most stock value first."
     * The clause was written to follow a "Showing X of Y," and read as a
     * fragment when nothing was hidden.
     */
    for (const zc of [1, 5, 14]) {
      const list = [1, 2, 3, 4, 5].map(n => item({ id: `p${n}`, name: `P${n}`, tiedUp: 100 - n }))
      const { detail } = leastSoldAnswer(list, zc, 'this month', money)
      for (const sentence of detail.split('. ')) {
        const first = sentence.trim()[0]
        if (first && /[a-z]/.test(first)) {
          throw new Error(`sentence starts lower-case: "${sentence.trim()}" (zeroCount ${zc})`)
        }
      }
    }
  })

  test('#73: showing five of fourteen SAYS fourteen', () => {
    const five = [1, 2, 3, 4, 5].map(n => item({ id: `p${n}`, name: `P${n}`, tiedUp: 100 }))
    expect(leastSoldAnswer(five, 14, 'this month', money).detail).toContain('Showing 5 of 14')
  })

  test('and says nothing about a total when nothing is hidden', () => {
    // Five of five is not a partial list. "Showing 5 of 5" is noise.
    const five = [1, 2, 3, 4, 5].map(n => item({ id: `p${n}`, name: `P${n}`, tiedUp: 100 }))
    expect(leastSoldAnswer(five, 5, 'this month', money).detail).not.toContain('Showing')
  })

  test('a non-seller with no stock still gets an honest sentence', () => {
    // Nothing sold and nothing on the shelf — there is no money to report.
    const a = leastSoldAnswer([item({ tiedUp: 0 })], 3, 'this month', money)
    expect(a.detail).toContain('None of these sold a single unit')
    expect(a.detail).not.toContain('sitting in it')
  })

  describe('🐛 the sentence must not describe rows that are not there', () => {
    /*
     * FOUND LIVE, in the very first real answer this feature gave. Sharma
     * Tailors has 6 products and 3 sold nothing, so the bottom five are three
     * zeroes followed by two items that DID sell. The answer said:
     *
     *   "None of these sold a single unit this month."
     *
     * directly above Cotton Fabric (2 sold) and Shirt Stitching (3 sold).
     *
     * Every "no stock" case in this file happened to have zeroCount >=
     * items.length, so the whole family passed while the live answer was
     * wrong. Both directions are now asserted.
     */
    const five = (over: Partial<LeastSoldItem> = {}) =>
      [1, 2, 3, 4, 5].map(n => item({ id: `p${n}`, name: `P${n}`, ...over,
        // rows 4 and 5 sold something — the real shape that broke it
        qty: n >= 4 ? n : 0 }))

    test('fewer zeroes than rows shown: it never says "none of these"', () => {
      const a = leastSoldAnswer(five(), 3, 'this month', money)
      expect(a.detail).not.toContain('None of these')
      expect(a.detail).toContain('The top 3 sold nothing')
    })

    test('every row a zero: "none of these" is true and stays', () => {
      const allZero = [1, 2, 3].map(n => item({ id: `p${n}`, name: `P${n}` }))
      expect(leastSoldAnswer(allZero, 3, 'this month', money).detail)
        .toContain('None of these sold a single unit')
    })

    test('more zeroes than rows shown is still "none of these"', () => {
      const allZero = [1, 2, 3, 4, 5].map(n => item({ id: `p${n}`, name: `P${n}` }))
      const a = leastSoldAnswer(allZero, 14, 'this month', money)
      expect(a.detail).toContain('Showing 5 of 14')
      expect(a.detail).toContain('None of these sold a single unit')
    })
  })
})

describe('an item that sold a little', () => {
  test('it is named, with what it actually sold', () => {
    const a = leastSoldAnswer(
      [item({ name: 'Sugar', qty: 2, value: 90, unit: 'kg' }), item({ id: 'p2', qty: 5 })],
      0, 'this month', money,
    )
    expect(a.headline).toBe('Sugar sold least this month')
    expect(a.detail).toContain('2 kg sold')
    expect(a.detail).toContain('₹90.00')
    expect(a.soldNothing).toBe(false)
  })

  test('it never claims items sold nothing when they did', () => {
    const a = leastSoldAnswer([item({ qty: 1 })], 0, 'this month', money)
    expect(a.headline).not.toContain('sold nothing')
  })
})

describe('returns are the case that breaks a naive check', () => {
  /*
   * Sale lines are netted against credit notes, so a product sold twice and
   * returned three times has a NEGATIVE quantity. An `=== 0` test would send
   * it down the "sold least" branch and print "Rice sold least — -1 kg sold",
   * which is both wrong and absurd. Negative is the strongest case of not
   * selling and belongs with the zeroes.
   */
  test('a fully-returned product counts as having sold nothing', () => {
    expect(soldNothing(0)).toBe(true)
    expect(soldNothing(-1)).toBe(true)
    expect(soldNothing(0.5)).toBe(false)
  })

  test('a negative quantity never reaches the wording as a sale', () => {
    const a = leastSoldAnswer([item({ name: 'Rice', qty: -1, tiedUp: 500 })], 2, 'this month', money)
    expect(a.headline).toBe('2 items sold nothing this month')
    expect(a.detail).not.toContain('-1')
  })

  test('the SQL count and this wording use the SAME rule', () => {
    /*
     * The count comes from `WHERE qty <= 0` in the query. If this function
     * used `=== 0`, the headline could read "3 items sold nothing" above a
     * list whose first row is a negative — the count and the list disagreeing
     * on screen, which is exactly the two-definitions defect.
     */
    expect(soldNothing(-0.001)).toBe(true)
  })
})

describe('what a receipt row shows', () => {
  test('a non-seller shows the money tied up in it', () => {
    expect(receiptAmount(item({ qty: 0, value: 0, tiedUp: 4000 }))).toBe(4000)
  })

  test('a slow seller shows what it actually earned', () => {
    expect(receiptAmount(item({ qty: 2, value: 90, tiedUp: 4000 }))).toBe(90)
  })

  test('a returned item shows tied-up too, never a negative amount', () => {
    // A negative rupee figure on a receipt row reads as a debt, not a return.
    expect(receiptAmount(item({ qty: -1, value: -50, tiedUp: 500 }))).toBe(500)
  })
})

describe('the period is always stated', () => {
  test.each(['today', 'this month', 'last month', 'this year'])('%s appears in the answer', (label) => {
    // An answer with no period is unfalsifiable — the shopkeeper cannot tell
    // whether it covers today or five years.
    const a = leastSoldAnswer([item()], 2, label, money)
    expect(a.headline).toContain(label)
  })
})
