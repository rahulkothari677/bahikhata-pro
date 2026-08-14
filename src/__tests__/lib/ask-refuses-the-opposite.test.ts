/**
 * 🔒 Asking for the LEAST must never be answered with the MOST.
 *
 * Rahul asked, on 12 August, whether the app can only answer what we have
 * explicitly built. Testing it produced two wrong answers, and both read
 * perfectly on screen:
 *
 *   "sabse kam kya bika"           → "₹0.00 of sales today"
 *   "which product is not selling" → "Shirt Stitching sold MOST all time"
 *
 * TWO DIFFERENT CAUSES, one refusal:
 *
 *   1. The local sales pattern claimed the first, because NAMES_SALES contains
 *      `bika` and nothing was watching for "sabse kam".
 *   2. The model answered the second. It must choose the nearest of the twelve
 *      capabilities, and the nearest thing to "least sold" is "most sold" — so
 *      it returned the exact inverse, labelled "read by AI".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 14 AUGUST — #70 BUILT THE ANSWER, SO THIS FILE CHANGED SHAPE.
 *
 * The refusal was always a holding position: "I can't do that yet" is better
 * than a backwards answer, but it is not an answer. `least_products` now
 * exists, so these questions are ANSWERED rather than refused.
 *
 * WHAT DOES NOT CHANGE IS THIS FILE'S JOB. The danger was never the refusal —
 * it was that the nearest capability to "least sold" is its exact opposite.
 * So every assertion below still checks the same thing, one step further on:
 * not "is it refused" but "does it reach the RIGHT capability, and never
 * top_products or sales_period".
 *
 * The refusal itself survives for the questions still not built — ranking
 * customers, and ranking by profit — and those are asserted too, because
 * removing a refusal too widely would hand the model back the exact question
 * it answered backwards.
 */

import { describe, test, expect } from '@jest/globals'
import { mustRefuse, parseAsk } from '@/lib/ask-patterns'

describe('the least / worst / not-selling family is ANSWERED, and answered correctly', () => {
  test.each([
    'sabse kam kya bika',
    'sab se kam kya bika',
    'which product is not selling',
    'least selling product',
    'lowest selling item',
    'worst selling product',
    'slowest moving stock',
    'dead stock kya hai',
    'kaunsa saman nahi bik raha',
    'which items are not moving this month',
    'non moving items',
  ])('%s → least_products', (q) => {
    expect(mustRefuse(q)).toBeNull()
    expect(parseAsk(q)?.intent).toBe('least_products')
  })

  test.each([
    'sabse kam kya bika',
    'which product is not selling',
    'dead stock kya hai',
    'slowest moving stock',
  ])('%s is NEVER the opposite question', (q) => {
    /*
     * THE ORIGINAL BUG, asserted directly. "Shirt Stitching sold MOST all
     * time" was a real product with a real figure, and backwards. If a future
     * change makes any of these fall through to the model again, the model
     * will pick the nearest capability — and the nearest one is still
     * top_products.
     */
    const intent = parseAsk(q)?.intent
    expect(intent).not.toBe('top_products')
    expect(intent).not.toBe('sales_period')
  })

  test('it is claimed by the PARSER, so the model is never consulted', () => {
    /*
     * The placement lesson, restated for the answer instead of the refusal.
     * `parseAsk` returning null means "no rule matched" — the signal that
     * hands the question to a model. Returning a real intent is what keeps
     * the model out of it, and keeps the answer deterministic.
     */
    expect(parseAsk('which product is not selling')).not.toBeNull()
    expect(parseAsk('sabse kam kya bika')?.source).toBe('pattern')
  })
})

describe('the questions that are still NOT built stay refused', () => {
  test.each([
    'sabse kam profit',
    'worst customer',
    'sabse kam kharidne wala customer',
    'least profitable customer',
    'lowest margin party',
  ])('%s is refused', (q) => {
    /*
     * Ranking PEOPLE and ranking by PROFIT are #70 part 2. Until they exist,
     * they must be refused for the original reason — the model's nearest
     * match for "worst customer" is a list of customers by something else,
     * or a product list, and both read as an answer.
     *
     * "sabse kam kharidne wala customer" is the one that matters most here:
     * it contains a selling word, so it would otherwise slip through the
     * least-SOLD door and be answered with PRODUCTS.
     */
    expect(mustRefuse(q)).toBe('not_built')
  })
})

describe('#77 — lowest STOCK was refused, though we already answered it', () => {
  /*
   * Found while building #70. `stock_item`'s own description says "omit
   * item_name to list the lowest-stock items", and "kis cheez ka stock kam
   * hai" worked — but the blanket refusal on "sabse kam" / "lowest" caught
   * "sabse kam stock" and "lowest stock" first.
   *
   * Two phrasings of one question, one of them refused, and the refusal
   * claimed a limit that did not exist.
   */
  test.each([
    'sabse kam stock',
    'lowest stock',
    'sabse kam stock kis cheez ka hai',
    'kis cheez ka stock kam hai',
  ])('%s → stock_item, not refused', (q) => {
    expect(mustRefuse(q)).toBeNull()
    expect(parseAsk(q)?.intent).toBe('stock_item')
  })

  test('lowest STOCK and least SOLD are different questions', () => {
    /*
     * The distinction the whole split rests on. One is about what is left on
     * the shelf; the other is about what moved. A shop can have plenty of
     * stock of something that sells constantly, and none of something that
     * never sells.
     */
    expect(parseAsk('lowest stock')?.intent).toBe('stock_item')
    expect(parseAsk('least selling item')?.intent).toBe('least_products')
  })
})

describe('what must still work', () => {
  test.each([
    'sabse zyada kya bika',
    'kitna maal bika',
    'is mahine ki sale kitni hui',
    'kitna kharcha hua',
    'kitna GST bharna hai',
    'Anil ka kitna baaki hai',
  ])('%s is not refused', (q) => {
    // The refusal must be narrow. Swallowing ordinary questions would be a
    // worse bug than the one it fixes.
    expect(mustRefuse(q)).toBeNull()
  })

  test('the opposite question still reaches the opposite answer', () => {
    // Adding least_products must not have stolen anything from top_products.
    expect(parseAsk('sabse zyada kya bika')?.intent).toBe('top_products')
    expect(parseAsk('best selling product')?.intent).toBe('top_products')
  })

  test('"kam" on its own does not trigger it', () => {
    // "sabse kam" is the trigger, not the word "kam" — which appears in
    // ordinary questions about amounts going down.
    expect(mustRefuse('kitna kam hua')).toBeNull()
  })
})
