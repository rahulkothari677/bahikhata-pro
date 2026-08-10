/**
 * "Ask your books" — understanding the QUESTION, never producing the answer.
 *
 * The contract this file defends: parseAsk returns which question was asked
 * and about whom. It never returns a figure. A money answer must come from
 * code that has been tested and reconciled, because a wrong number in an
 * accounting app is invisible and permanent — the shopkeeper who catches one
 * stops trusting every other number we show, including the correct ones.
 *
 * So the failure mode we design for is "wrong question", which is visible and
 * one tap from being corrected, never "wrong answer".
 *
 * Hinglish is the primary dialect here, not a fallback. Spelling varies wildly
 * (baaki/baki/bakaya, kitna/kitne, pichhle/pichle) and every variant below is
 * one a real shopkeeper would type.
 */

import { parseAsk } from '@/lib/ask-patterns'

describe('it never answers, it only understands', () => {
  test('the result carries no number of any kind', () => {
    const r = parseAsk('Ramesh ka kitna baaki hai')!
    expect(r.intent).toBe('party_balance')
    // The whole object must be free of figures — that is the architectural
    // guarantee, and it is worth asserting rather than assuming.
    const values = Object.values(r)
    expect(values.every(v => typeof v !== 'number')).toBe(true)
  })

  test('it echoes back what it understood, so a misread is visible', () => {
    expect(parseAsk('Ramesh ka kitna baaki hai')!.understoodAs).toMatch(/Ramesh/)
    expect(parseAsk('aaj ki sale')!.understoodAs).toMatch(/today/i)
  })
})

describe('party balance', () => {
  test.each([
    'Ramesh ka kitna baaki hai',
    'ramesh ka baki hai',
    'Ramesh ka bakaya',
    'Ramesh ki balance',
    'how much does Ramesh owe',
  ])('%s', (q) => {
    const r = parseAsk(q)
    expect(r?.intent).toBe('party_balance')
    expect(r?.partyName?.toLowerCase()).toBe('ramesh')
  })

  test('a two-word name survives', () => {
    expect(parseAsk('Anil Kumar ka kitna baaki hai')?.partyName?.toLowerCase()).toBe('anil kumar')
  })

  test('filler words are stripped from the name, not kept', () => {
    // "kitna" sits between the name and "baaki" in natural speech; keeping it
    // would make every name fail to match a real customer.
    expect(parseAsk('Ramesh ka kitna baaki hai')?.partyName).not.toMatch(/kitna/)
  })
})

describe('periods', () => {
  test.each([
    ['aaj ki sale', 'today'],
    ['today sales', 'today'],
    ['kal ki sale', 'yesterday'],
    ['is mahine ki sale', 'this_month'],
    ['this month sales', 'this_month'],
    ['pichhle mahine ki sale', 'last_month'],
    ['pichle month ka sale', 'last_month'],
    ['is hafte ki bikri', 'this_week'],
    ['is saal ki sale', 'this_fy'],
  ])('%s → %s', (q, period) => {
    expect(parseAsk(q)?.period).toBe(period)
  })

  test('LAST month is not read as THIS month', () => {
    // "pichhle mahine" contains "mahine". Testing the general pattern first
    // would answer every last-month question about the current one — a wrong
    // answer that looks completely right.
    expect(parseAsk('pichhle mahine ka profit')?.period).toBe('last_month')
    expect(parseAsk('is mahine ka profit')?.period).toBe('this_month')
  })
})

describe('the other intents', () => {
  test.each([
    ['is mahine ka profit', 'profit_period'],
    ['profit this month', 'profit_period'],
    ['munafa kitna hua', 'profit_period'],
    ['sabse zyada kya bika', 'top_products'],
    ['best selling product', 'top_products'],
    ['kitna udhaar hai', 'receivables'],
    ['who owes me money', 'receivables'],
    ['kitna GST bharna hai', 'tax_due'],
    ['how much tax do I owe', 'tax_due'],
  ])('%s → %s', (q, intent) => {
    expect(parseAsk(q)?.intent).toBe(intent)
  })

  test('a tax question is not swallowed by the sales pattern', () => {
    // "is mahine kitna gst bharna hai" has a period AND "kitna", which the
    // broad sales rule would otherwise claim.
    expect(parseAsk('is mahine kitna gst bharna hai')?.intent).toBe('tax_due')
  })

  test('a profit question is not read as a sales question', () => {
    expect(parseAsk('is mahine kitna profit hua')?.intent).toBe('profit_period')
  })

  test('stock questions name the item when one is given', () => {
    expect(parseAsk('rice ka stock')?.intent).toBe('stock_item')
    expect(parseAsk('stock of rice')?.itemName).toBe('rice')
  })
})

describe('refusing is a feature', () => {
  test.each([
    'what is the weather',
    'hello',
    'tell me a joke',
    'kya haal hai',
    '',
    '   ',
  ])('returns null for %p rather than guessing', (q) => {
    expect(parseAsk(q)).toBeNull()
  })

  test('opinion questions are refused, even when they contain our keywords', () => {
    /*
     * "should I buy more stock" was being answered as a stock query, because
     * it contains the word "stock". That is worse than refusing: the
     * shopkeeper asked WHETHER TO BUY and received a quantity, which reads as
     * an answer to the question they actually asked.
     *
     * Advice depends on things the books do not contain. We hold no opinion.
     */
    expect(parseAsk('should I buy more stock')).toBeNull()
    expect(parseAsk('kya mujhe aur stock lena chahiye')).toBeNull()
    expect(parseAsk('is it worth selling rice')).toBeNull()
  })

  test('a question we cannot answer does not become the nearest one we can', () => {
    /*
     * The dangerous failure is not "I do not know" — it is quietly answering a
     * DIFFERENT question and presenting it as the answer. A shopkeeper who
     * asks about last year and is shown this month has been misinformed with
     * a number that is individually correct.
     */
    expect(parseAsk('which supplier is cheapest')).toBeNull()
    expect(parseAsk('should I buy more stock')).toBeNull()
  })
})

describe('input arrives messy, especially from speech', () => {
  test('trailing punctuation and casing do not matter', () => {
    expect(parseAsk('AAJ KI SALE?')?.intent).toBe('sales_period')
    expect(parseAsk('  aaj ki sale.  ')?.period).toBe('today')
  })

  test('extra spaces from dictation do not matter', () => {
    expect(parseAsk('ramesh   ka    kitna   baaki  hai')?.partyName?.toLowerCase()).toBe('ramesh')
  })
})
