/**
 * 🔒 Ask must refuse a subject it cannot answer, not answer a different one.
 *
 * FOUND IN THE LIVE APP, by asking it ordinary shopkeeper questions:
 *
 *   "is mahine kitna kharcha hua"      → "₹2,212.00 of sales this month"
 *   "kal kitna bijli ka bill tha"      → "₹2,212.00 of sales yesterday"
 *   "is hafte kitna transport kharcha" → "₹0.00 of sales this week"
 *   "kal kitna maal kharida"           → "3 products, lowest stock first"
 *
 * Every one returned answered: true. Asking what you SPENT and being shown in
 * bold what you EARNED is not a near miss — the two numbers move a business in
 * opposite directions, and this feature's entire claim is that its figures can
 * be trusted without checking.
 *
 * Two greedy branches caused it: stock fires on the bare word "maal", and
 * sales takes anything with "kitna" and a period that nothing more specific
 * claimed. Neither checked whether the sentence was plainly about something
 * else.
 *
 * These tests pin the refusals. When expenses and purchases become real
 * intents, the assertions here should change from "returns null" to "returns
 * the expense intent" — and that will be a deliberate edit, made by someone
 * reading this comment, rather than a greedy branch quietly reclaiming them.
 */

import { describe, test, expect } from '@jest/globals'
import { parseAsk } from '@/lib/ask-patterns'

describe('Ask refuses subjects it cannot answer', () => {
  describe('the four that were answered wrongly in production', () => {
    test.each([
      'is mahine kitna kharcha hua',
      'kal kitna bijli ka bill tha',
      'is hafte kitna transport kharcha',
      'kal kitna maal kharida',
    ])('%s → refuses rather than answering about sales or stock', q => {
      expect(parseAsk(q)).toBeNull()
    })
  })

  describe('every unsupported subject, not just the four that were caught', () => {
    test.each([
      ['expenses, spelt several ways', ['kal ka kharcha kitna tha', 'kitna kharch hua', 'is mahine ke kharche kitne']],
      ['expenses in English', ['how much expense this month', 'how much did i spend yesterday']],
      ['purchases', ['kal kitna kharida', 'is mahine kitna purchase kiya', 'kitna maal khareeda']],
      ['named running costs', ['kitna rent diya', 'is mahine kitni salary di', 'kitna bijli ka kharcha']],
    ])('%s', (_label, questions) => {
      for (const q of questions as string[]) {
        expect({ q, intent: parseAsk(q)?.intent ?? null }).toEqual({ q, intent: null })
      }
    })
  })

  /*
   * THE OTHER HALF OF THE FIX, and the reason it is applied at the two greedy
   * branches rather than at the top of the parser.
   *
   * A blanket guard would also swallow legitimate questions — a customer named
   * "Kharid Traders", or an explicit sales question that happens to mention
   * buying. These pin that the refusal is narrow.
   */
  describe('it did not become deaf to the questions it does answer', () => {
    test('an explicit sales word still wins over a mention of buying', () => {
      expect(parseAsk('kal kitna maal becha')?.intent).toBe('sales_period')
      expect(parseAsk('is mahine ki bikri kitni hui')?.intent).toBe('sales_period')
    })

    test('a party whose NAME contains one of these stems still resolves', () => {
      // Matched as a balance question before either greedy branch is reached.
      expect(parseAsk('Kharid Traders ka kitna baaki hai')?.intent).toBe('party_balance')
      expect(parseAsk('Kharid Traders ka kitna baaki hai')?.partyName?.toLowerCase())
        .toContain('kharid')
    })

    test('a named stock item still resolves even beside one of these words', () => {
      // With an item named, stock is not guessing — the question says what it
      // is about, so the competing subject does not override it.
      expect(parseAsk('chawal ka stock kitna hai')?.intent).toBe('stock_item')
    })

    test('the ordinary supported questions are untouched', () => {
      expect(parseAsk('aaj ki sale')?.intent).toBe('sales_period')
      expect(parseAsk('Anil Kumar ka kitna baaki hai')?.intent).toBe('party_balance')
      expect(parseAsk('kitna GST bharna hai')?.intent).toBe('tax_due')
      expect(parseAsk('kisse kitna lena hai')?.intent).toBe('receivables')
    })
  })
})
