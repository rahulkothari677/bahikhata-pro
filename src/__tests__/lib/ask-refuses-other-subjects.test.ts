/**
 * 🔒 Spending questions must reach the spending answer — and never sales.
 *
 * ── THE HISTORY THIS FILE CARRIES ─────────────────────────────────────
 *
 * FOUND IN THE LIVE APP by asking it ordinary shopkeeper questions:
 *
 *   "is mahine kitna kharcha hua"      → "₹2,212.00 of sales this month"
 *   "kal kitna bijli ka bill tha"      → "₹2,212.00 of sales yesterday"
 *   "is hafte kitna transport kharcha" → "₹0.00 of sales this week"
 *   "kal kitna maal kharida"           → "3 products, lowest stock first"
 *
 * All four returned answered: true. Asking what you SPENT and being shown in
 * bold what you EARNED is not a near miss — the two move a business in
 * opposite directions.
 *
 * FIRST FIX: make them refuse. This file then asserted `toBeNull()` for each,
 * and said in its own comment:
 *
 *     "When expenses and purchases become real intents, the assertions here
 *      should change from 'returns null' to 'returns the expense intent' — and
 *      that will be a deliberate edit, made by someone reading this comment,
 *      rather than a greedy branch quietly reclaiming them."
 *
 * SECOND FIX, and this is that deliberate edit. `expenses_period` and
 * `purchases_period` now exist, so these questions are ANSWERED. The
 * assertions below changed from "returns null" to "returns the right intent",
 * on purpose, with the reason recorded here rather than in a diff nobody
 * reads.
 *
 * What has NOT changed is the property being defended: a spending question
 * must never come back as a sales or stock answer. That is asserted more
 * strongly now, because the expected value is a specific intent rather than
 * merely "not an answer".
 */

import { describe, test, expect } from '@jest/globals'
import { parseAsk } from '@/lib/ask-patterns'

describe('Spending questions reach the spending answer', () => {
  describe('the four that were answered wrongly in production', () => {
    test.each([
      ['is mahine kitna kharcha hua', 'expenses_period'],
      ['kal kitna bijli ka bill tha', 'expenses_period'],
      ['is hafte kitna transport kharcha', 'expenses_period'],
      ['kal kitna maal kharida', 'purchases_period'],
    ])('%s → %s', (q, expected) => {
      expect({ q, intent: parseAsk(q)?.intent ?? null }).toEqual({ q, intent: expected })
    })

    test('NONE of them can come back as sales or stock, whatever else changes', () => {
      /*
       * The invariant that survives every refactor of the branches above. If a
       * future edit reorders them, this is what fails.
       */
      for (const q of [
        'is mahine kitna kharcha hua', 'kal kitna bijli ka bill tha',
        'is hafte kitna transport kharcha', 'kal kitna maal kharida',
      ]) {
        const intent = parseAsk(q)?.intent
        expect({ q, wrongSubject: intent === 'sales_period' || intent === 'stock_item' })
          .toEqual({ q, wrongSubject: false })
      }
    })
  })

  describe('running costs, in the several ways people say them', () => {
    test.each([
      'kal ka kharcha kitna tha',
      'kitna kharch hua',
      'is mahine ke kharche kitne',
      'how much expense this month',
      'how much did i spend yesterday',
      'kitna rent diya',
      'is mahine kitni salary di',
    ])('%s → expenses_period', q => {
      expect({ q, intent: parseAsk(q)?.intent ?? null }).toEqual({ q, intent: 'expenses_period' })
    })
  })

  describe('buying stock is a different question, and says so with a different word', () => {
    test.each([
      'kal kitna kharida',
      'is mahine kitna purchase kiya',
      'kitna maal khareeda',
    ])('%s → purchases_period', q => {
      expect({ q, intent: parseAsk(q)?.intent ?? null }).toEqual({ q, intent: 'purchases_period' })
    })
  })

  describe('a named category is carried through, not dropped', () => {
    test.each([
      ['kitna rent diya', 'rent'],
      ['is mahine kitni salary di', 'salary'],
      ['kal kitna bijli ka bill tha', 'electricity'],
      ['is hafte kitna transport kharcha', 'transport'],
    ])('%s → category %s', (q, category) => {
      // Without this the answer would silently widen to ALL spending and
      // report a bigger number under the label the user asked for.
      expect({ q, category: parseAsk(q)?.categoryName }).toEqual({ q, category })
    })

    test('a general spending question carries no category', () => {
      expect(parseAsk('is mahine kitna kharcha hua')?.categoryName).toBeUndefined()
    })
  })

  describe('it did not become deaf to the questions it already answered', () => {
    test('an explicit sales word still wins over a mention of goods', () => {
      expect(parseAsk('kal kitna maal becha')?.intent).toBe('sales_period')
      expect(parseAsk('is mahine ki bikri kitni hui')?.intent).toBe('sales_period')
    })

    test('a party whose NAME contains a spending stem still resolves', () => {
      /*
       * "Kharid Traders" contains the purchase stem. The balance question must
       * still win — which it does because party balance is matched on SHAPE
       * ("X ka kitna baaki hai"), and that shape is checked before the greedy
       * branches. This is the case that stopped me putting the spending check
       * at the top of the parser.
       */
      expect(parseAsk('Kharid Traders ka kitna baaki hai')?.intent).toBe('party_balance')
    })

    test('a named stock item still resolves', () => {
      expect(parseAsk('chawal ka stock kitna hai')?.intent).toBe('stock_item')
    })

    test('the ordinary supported questions are untouched', () => {
      expect(parseAsk('aaj ki sale')?.intent).toBe('sales_period')
      expect(parseAsk('Anil Kumar ka kitna baaki hai')?.intent).toBe('party_balance')
      expect(parseAsk('kitna GST bharna hai')?.intent).toBe('tax_due')
      expect(parseAsk('kisse kitna lena hai')?.intent).toBe('receivables')
      expect(parseAsk('is mahine ka profit')?.intent).toBe('profit_period')
    })
  })
})
