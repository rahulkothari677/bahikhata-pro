/**
 * 🔒 The two things this app will not answer, however it is asked.
 *
 * ── FOUND IN ADVERSARIAL TESTING, P4.4 ────────────────────────────────
 *
 *     "next month kitni sale hogi"  →  "₹3,262.00 of sales this month"
 *
 * A question about the FUTURE, answered with the PAST. The figure was real,
 * the caption honestly said "this month", and a shopkeeper who asked about
 * next month reads it as the forecast they asked for. That is a prediction
 * wearing the clothes of a fact, and the plan's own list of things I will not
 * build names it: "Predictions dressed as facts. If we ever forecast, it will
 * be labelled a forecast."
 *
 * ── WHY THE CHECK MOVED OUT OF parseAsk ───────────────────────────────
 *
 * Both refusals began as early `return null`s inside the parser. That was
 * sufficient while patterns were the only route: no match, no answer.
 *
 * Adding a model broke that silently. `null` from the parser means "no rule
 * matched" — the SAME signal as an unusual phrasing — so the route handed the
 * question to the model, which happily routed it. The refusal had quietly
 * become a suggestion.
 *
 * `mustRefuse` is now exported and called by the route BEFORE the model is
 * consulted. A rule the model is merely asked to follow in a prompt is a
 * preference; a rule checked in our own code is a rule.
 */

import { describe, test, expect } from '@jest/globals'
import { mustRefuse, parseAsk } from '@/lib/ask-patterns'

describe('predictions', () => {
  test.each([
    'next month kitni sale hogi',
    'agle mahine kitna profit hoga',
    'agle hafte kitni bikri hogi',
    'next week how much will I sell',
    'what will my sales be next month',
    'forecast my revenue',
    'predict next quarter',
    'expected sales for next year',
  ])('%s → refused as a prediction', q => {
    expect(mustRefuse(q)).toBe('prediction')
    // And the parser agrees, so neither route can answer it.
    expect(parseAsk(q)).toBeNull()
  })

  /*
   * THE HALF OF THIS THAT COULD BREAK EVERYTHING.
   *
   * Hinglish marks the future with hoga/hogi/honge and the PAST with hua/hui.
   * They differ by two letters. A guard that caught the past tense too would
   * silently stop answering the commonest question in the app.
   */
  describe('past tense must keep working — it is two letters away', () => {
    test.each([
      ['aaj kitni sale hui', 'sales_period'],
      ['is mahine kitna kharcha hua', 'expenses_period'],
      ['kal kitni bikri hui', 'sales_period'],
      ['is mahine kitna profit hua', 'profit_period'],
    ])('%s still answers (%s)', (q, intent) => {
      expect(mustRefuse(q)).toBeNull()
      expect(parseAsk(q)?.intent).toBe(intent)
    })

    test('"pichhle mahine" is the PAST and must not be caught by the "agle" rule', () => {
      expect(mustRefuse('pichhle mahine kitna kharcha hua')).toBeNull()
      expect(parseAsk('pichhle mahine kitna kharcha hua')?.period).toBe('last_month')
    })
  })
})

describe('advice', () => {
  test.each([
    'should I buy more stock',
    'kya mujhe dukan bech deni chahiye',
    'which supplier is cheapest',
    'is it worth it',
    'what do you recommend',
    'kya karu',
  ])('%s → refused as advice', q => {
    expect(mustRefuse(q)).toBe('advice')
    expect(parseAsk(q)).toBeNull()
  })

  test('a factual question containing a judgement word is still refused, deliberately', () => {
    /*
     * "should I" plus a stock word once returned a QUANTITY, which reads as a
     * yes. Refusing the whole sentence is correct: we cannot answer the
     * question they actually asked, and answering a different one is worse
     * than saying so.
     */
    expect(mustRefuse('should I buy more Cotton Fabric')).toBe('advice')
  })
})

describe('ordinary questions are untouched', () => {
  test.each([
    'aaj ki sale',
    'Anil Kumar ka kitna baaki hai',
    'kitna GST bharna hai',
    'stock levels',
    'is mahine kitna maal kharida',
    'kisse kitna lena hai',
  ])('%s is not refused', q => {
    expect(mustRefuse(q)).toBeNull()
  })

  test('empty input is not a refusal — it is handled earlier as a bad request', () => {
    expect(mustRefuse('')).toBeNull()
    expect(mustRefuse('   ')).toBeNull()
  })
})
