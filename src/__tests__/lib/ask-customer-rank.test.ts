/**
 * 🔒 #70 part 2 — "which customer buys the most", and profit by product.
 *
 * These were logged as "not built". They were worse than that: they were
 * being ANSWERED, with a real figure, for a different question.
 *
 *   "kaunsa customer sabse zyada kharidta hai" → purchases_period
 *       what the SHOP spent on stock. "kharid" means buy: from the shop's
 *       side a purchase, from the customer's side a sale. Same word,
 *       opposite subject.
 *
 *   "kaunse customer se sabse zyada profit"    → profit_period
 *   "which product gives most profit"          → profit_period
 *   "item wise profit"                         → profit_period
 *       the shop's TOTAL profit, with nothing on screen to say the "which"
 *       half of the question had been dropped.
 *
 * That is #69 again — a plausible number for a question nobody asked — and
 * it was live.
 */

import { describe, test, expect } from '@jest/globals'
import { parseAsk, mustRefuse } from '@/lib/ask-patterns'
import {
  customerRankAnswer, productProfitAnswer, nobodyBought, needsProfitPermission,
  type RankedCustomer, type RankedProduct,
} from '@/lib/ask-customer-rank'

const money = (n: number) => `₹${n.toFixed(2)}`
const cust = (o: Partial<RankedCustomer> = {}): RankedCustomer =>
  ({ id: 'c1', name: 'Anil', amount: 5000, profit: 900, bills: 3, ...o })
const prod = (o: Partial<RankedProduct> = {}): RankedProduct =>
  ({ id: 'p1', name: 'Shirt', revenue: 1000, profit: 400, margin: 40, qty: 5, ...o })

describe('the question reaches the right subject', () => {
  test.each([
    'kaunsa customer sabse zyada kharidta hai',
    'which customer buys most',
    'best customer',
    'sabse zyada kharidne wala customer',
    'top customers',
  ])('%s → top_customers by amount', (q) => {
    const p = parseAsk(q)
    expect(p?.intent).toBe('top_customers')
    expect(p?.rankBy).toBe('amount')
  })

  test.each([
    'most profitable customer',
    'kaunse customer se sabse zyada profit',
    'best customer by profit',
  ])('%s → top_customers by profit', (q) => {
    const p = parseAsk(q)
    expect(p?.intent).toBe('top_customers')
    expect(p?.rankBy).toBe('profit')
  })

  test('"profitable" is a profit word', () => {
    /*
     * `\bprofit\b` does not match "profitable" — there is no word boundary
     * before "able". So "most profitable customer" ranked by how much they
     * SPENT: the right five people, quite possibly in the wrong order, with
     * nothing on screen to show it.
     */
    expect(parseAsk('most profitable customer')?.rankBy).toBe('profit')
  })

  test.each([
    'which product gives most profit',
    'sabse zyada profit kis cheez me hai',
    'product wise profit',
    'item wise profit',
  ])('%s → product_profit', (q) => {
    expect(parseAsk(q)?.intent).toBe('product_profit')
  })

  test.each([
    ['kaunsa customer sabse zyada kharidta hai', 'purchases_period'],
    ['sabse zyada kharidne wala customer', 'purchases_period'],
    ['kaunse customer se sabse zyada profit', 'profit_period'],
    ['which product gives most profit', 'profit_period'],
    ['item wise profit', 'profit_period'],
  ])('%s is NEVER answered as %s again', (q, wrong) => {
    // The exact wrong subjects these returned in the live app.
    expect(parseAsk(q)?.intent).not.toBe(wrong)
  })
})

describe('what must not be swallowed', () => {
  test.each([
    ['is mahine ka profit', 'profit_period'],
    ['kitna munafa hua', 'profit_period'],
    ['ramesh ka kitna baaki hai', 'party_balance'],
    ['sabse zyada kya bika', 'top_products'],
    ['sabse kam kya bika', 'least_products'],
    ['kitna kharcha hua', 'expenses_period'],
    ['is mahine kitna maal kharida', 'purchases_period'],
    ['aaj ki sale', 'sales_period'],
  ])('%s still means %s', (q, intent) => {
    /*
     * Both new branches run BEFORE profit and spending, so a greedy pattern
     * here would quietly steal ordinary questions — the same mistake in the
     * opposite direction.
     */
    expect(parseAsk(q)?.intent).toBe(intent)
  })

  test('naming a customer without ranking is still a balance question', () => {
    expect(parseAsk('customer ka balance')?.intent).not.toBe('top_customers')
  })
})

describe('the profit permission, called with every combination', () => {
  /*
   * A permission is the last thing that should be taken on trust by reading
   * an `if` inside a switch. One capability answers two questions here, and
   * only one of them is a profit figure.
   */
  test('ranking customers by amount is NOT a profit figure', () => {
    expect(needsProfitPermission('top_customers', 'amount')).toBe(false)
    expect(needsProfitPermission('top_customers', undefined)).toBe(false)
  })

  test('ranking customers by profit IS', () => {
    expect(needsProfitPermission('top_customers', 'profit')).toBe(true)
  })

  test('profit by product always is', () => {
    expect(needsProfitPermission('product_profit')).toBe(true)
    expect(needsProfitPermission('product_profit', 'amount')).toBe(true)
  })

  test('other questions are untouched', () => {
    expect(needsProfitPermission('sales_period', 'profit')).toBe(false)
    expect(needsProfitPermission('top_products')).toBe(false)
  })
})

describe('nobody bought anything is a fact, not a zero', () => {
  /*
   * Rahul's instruction for this task: "say when a customer bought nothing
   * rather than showing ₹0". Crowning a best customer who spent ₹0 is the
   * same shape as the toast that said "Added 2 items" over two lines worth
   * nothing.
   */
  test('an empty list', () => {
    expect(nobodyBought([])).toBe(true)
    expect(customerRankAnswer([], false, 'this month', money, 0).headline)
      .toBe('No customer bought anything this month')
  })

  test('only returns in the period — the bills belong to an earlier month', () => {
    expect(nobodyBought([cust({ amount: -500, bills: 0 })])).toBe(true)
  })

  test('one real bill is enough to rank', () => {
    expect(nobodyBought([cust({ amount: 1, bills: 1 })])).toBe(false)
  })

  describe('🐛 bought-and-returned is NOT bought-nothing', () => {
    /*
     * FOUND ON LIVE BOOKS. Sharma Tailors' only named customer, Anil Kumar,
     * has this month: one sale of ₹787.50 and TWO credit notes totalling
     * ₹1,312.50. Net −₹525, net profit −₹860.
     *
     * `nobodyBought` first tested `amount <= 0`, so the answer would have
     * been "No customer bought anything this month" — which is false. He
     * bought, and then returned more than he bought. Two different facts,
     * and the second one is the interesting one.
     */
    const anil = cust({ name: 'Anil Kumar', amount: -525, profit: -860, bills: 1 })

    test('a net-negative customer with a real bill did buy', () => {
      expect(nobodyBought([anil])).toBe(false)
    })

    test('by amount: it says returns outweighed sales', () => {
      const a = customerRankAnswer([anil], false, 'this month', money, 1)
      expect(a.headline).toBe('Returns outweighed sales this month')
      expect(a.detail).toContain('Anil Kumar returned more than they bought')
      expect(a.detail).toContain('₹525.00')
      expect(a.headline).not.toContain('bought the most')
    })

    test('by profit: it never calls a loss the most profit', () => {
      const a = customerRankAnswer([anil], true, 'this month', money, 1)
      expect(a.headline).toBe('No customer made you a profit this month')
      expect(a.detail).toContain('loss of ₹860.00')
      expect(a.headline).not.toContain('left the most profit')
    })

    test('no negative rupee figure is ever printed', () => {
      // "-₹525.00" reads as a debt owed, not as a return.
      for (const byProfit of [true, false]) {
        const a = customerRankAnswer([anil], byProfit, 'this month', money, 1)
        expect(a.detail).not.toContain('-₹')
        expect(a.detail).not.toContain('₹-')
      }
    })
  })

  test('the empty answer never names anyone', () => {
    // bills: 0 — nobody placed an order at all. Naming a "best customer"
    // here would crown someone on the strength of nothing.
    const a = customerRankAnswer([cust({ amount: 0, bills: 0, name: 'Anil' })], false, 'this month', money, 0)
    expect(a.headline).not.toContain('Anil')
    expect(a.detail).not.toContain('₹0')
  })

  test('bought and returned EXACTLY as much is its own sentence', () => {
    /*
     * Caught by the test above, which is the case for keeping an assertion
     * that looks redundant: three bills netting exactly ₹0 printed "returned
     * more than they bought — ₹0.00 net". Returns EQUALLED sales, and the
     * ₹0.00 was the fabricated-zero shape this codebase keeps re-learning.
     */
    const a = customerRankAnswer([cust({ amount: 0, bills: 3, name: 'Anil' })], false, 'this month', money, 1)
    expect(a.headline).toBe('Everything bought was returned this month')
    expect(a.detail).toContain('3 bills fully cancelled by returns')
    expect(a.detail).not.toContain('₹0')
    expect(a.detail).not.toContain('more than they bought')
  })
})

describe('the two customer questions read differently', () => {
  test('bought the most', () => {
    const a = customerRankAnswer([cust({ name: 'Anil', amount: 5000, bills: 3 })], false, 'this month', money, 1)
    expect(a.headline).toBe('Anil bought the most this month')
    expect(a.detail).toContain('₹5000.00 across 3 bills')
  })

  test('left the most profit', () => {
    const a = customerRankAnswer([cust({ name: 'Anil', amount: 5000, profit: 900 })], true, 'this month', money, 1)
    expect(a.headline).toBe('Anil left the most profit this month')
    expect(a.detail).toContain('₹900.00 profit on ₹5000.00 of purchases')
  })

  test('one bill is not "1 bills"', () => {
    expect(customerRankAnswer([cust({ bills: 1 })], false, 'this month', money, 1).detail)
      .toContain('1 bill.')
  })

  test('#73: five of forty says forty', () => {
    const five = [1, 2, 3, 4, 5].map(n => cust({ id: `c${n}`, name: `C${n}` }))
    expect(customerRankAnswer(five, false, 'this month', money, 40).detail)
      .toContain('Top 5 of 40 customers who bought')
  })

  test('and says nothing when nothing is hidden', () => {
    expect(customerRankAnswer([cust()], false, 'this month', money, 1).detail)
      .not.toContain('Top 1 of')
  })
})

describe('profit by product', () => {
  test('names the item, the profit and the margin', () => {
    const a = productProfitAnswer([prod({ name: 'Shirt', profit: 400, revenue: 1000, margin: 40 })],
      'this month', money, 1)
    expect(a.headline).toBe('Shirt made the most profit this month')
    expect(a.detail).toContain('₹400.00 on ₹1000.00 of sales — 40.0% margin')
  })

  test('a LOSS is not a small profit', () => {
    /*
     * If the best item in the shop lost money, "made the most profit" is
     * technically a ranking and practically a lie. The shopkeeper needs to
     * know their cost prices are wrong, not to be congratulated.
     */
    const a = productProfitAnswer([prod({ name: 'Shirt', profit: -250, revenue: 1000 })],
      'this month', money, 3)
    expect(a.headline).toBe('Every item lost money this month')
    expect(a.detail).toContain('lost the least — ₹250.00')
    expect(a.detail).not.toContain('-₹')
    expect(a.detail).toContain('Check your cost prices')
  })

  test('nothing sold is said, not priced', () => {
    const a = productProfitAnswer([], 'this month', money, 0)
    expect(a.headline).toBe('No sales this month')
    expect(a.detail).not.toContain('₹0')
  })
})

describe('the least direction stays refused, honestly', () => {
  test.each([
    'worst customer',
    'sabse kam kharidne wala customer',
    'least profitable customer',
  ])('%s', (q) => {
    /*
     * Ranking the BOTTOM of a customer list is a different problem: a shop
     * with 10,000 parties has thousands who bought nothing this month, and
     * no meaningful order among them. The useful version — regulars who
     * STOPPED coming — is its own feature, logged rather than guessed at.
     */
    expect(mustRefuse(q)).toBe('not_built')
  })
})
