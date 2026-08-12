/**
 * 🔒 #67 — "kitna maal bika" is HOW MUCH sold, not WHICH item sold most.
 *
 * Rahul asked this on his phone and got "Top selling products · this month",
 * with a real product and a real figure. Nothing about it looked wrong, which
 * is exactly what makes it the dangerous kind of bug: he would have read it
 * and moved on.
 *
 * WHY IT HAPPENED. No local pattern claimed it — the sales clause needed
 * `kitna` AND a period word, and this has no period — so it went to the model,
 * which chose top_products. The model was doing its job; we had simply never
 * told it which reading was right, and a model asked to guess will guess.
 *
 * The two readings now differ by a rule:
 *     kya bika        → which item   (top_products)
 *     kitna ... bika  → how much     (sales_period)
 */

import { describe, test, expect } from '@jest/globals'
import { parseAsk } from '@/lib/ask-patterns'

describe('how much sold', () => {
  test.each([
    'kitna maal bika',
    'kitna maal becha',
    'kitna bika',
    'how much sold',
    'total sold',
  ])('%s is the sales total', (q) => {
    // Answered locally, so no model is involved and no guess is possible.
    expect(parseAsk(q)?.intent).toBe('sales_period')
  })

  test('it is claimed by a PATTERN, not left to the router', () => {
    /*
     * The point of the fix. parseAsk returning null is what sends a question
     * to the model — the same shape that has caught me three times now.
     */
    expect(parseAsk('kitna maal bika')).not.toBeNull()
    expect(parseAsk('kitna maal bika')?.source).toBe('pattern')
  })
})

describe('which item sold most — still top products', () => {
  test.each([
    'sabse zyada kya bika',
    'best selling product',
    'top selling items',
  ])('%s', (q) => {
    /*
     * THE REGRESSION THIS PINS. The top-products rule sits far above the sales
     * clause and needs "sabse zyada" or "top/best selling", so it claims these
     * first. If a future edit moves either rule, this fails — and the failure
     * would otherwise be invisible, because both answers look plausible.
     */
    expect(parseAsk(q)?.intent).toBe('top_products')
  })

  test('"sabse zyada kya bika" is not stolen by the new how-much rule', () => {
    // It contains `bika`, so the new clause would claim it if the ordering
    // ever changed. This is the exact collision worth guarding.
    expect(parseAsk('sabse zyada kya bika')?.intent).toBe('top_products')
  })
})

describe('the neighbours it must not disturb', () => {
  test.each([
    ['kitna kharcha hua', 'expenses_period'],
    ['kitna udhaar hai', 'receivables'],
    ['kitna GST bharna hai', 'tax_due'],
  ])('%s stays %s', (q, intent) => {
    // All three contain `kitna`. Only `bika/becha/sold` makes it a sales
    // question, which is why the new rule needs BOTH words.
    expect(parseAsk(q)?.intent).toBe(intent)
  })
})
