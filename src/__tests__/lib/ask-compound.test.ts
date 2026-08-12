/**
 * 🔒 B2 — two questions in one line.
 *
 * MEASURED BEFORE WRITING ANY CODE, against the real parser:
 *
 *   "is mahine ki sale aur kitna kharcha hua"  → answered EXPENSES (the 2nd)
 *   "Anil ka balance aur is mahine ki sale"    → answered the BALANCE (the 1st)
 *   "aaj ki sale and kitna GST bharna hai"     → "GST payable · TODAY"
 *
 * So the logged issue (#51) understated it. Which half you get depends on
 * which pattern matches last — and the third case is not half an answer at
 * all: "today" came from the SALES half and was applied to the GST half. A
 * figure assembled out of two different questions, labelled confidently.
 *
 * THE DANGEROUS DIRECTION HERE IS THE FALSE POSITIVE. Splitting a question
 * that merely contains "aur" would turn one good answer into a pointless
 * question back at the shopkeeper — so most of this file is about what must
 * NOT be split.
 */

import { describe, test, expect } from '@jest/globals'
import { splitCompound } from '@/lib/ask-compound'
import { parseAsk } from '@/lib/ask-patterns'

describe('two questions, and both are kept whole', () => {
  test.each([
    ['Anil ka balance aur is mahine ki sale', 'Anil ka balance', 'is mahine ki sale'],
    ['is mahine ki sale aur kitna kharcha hua', 'is mahine ki sale', 'kitna kharcha hua'],
    ['aaj ki sale and kitna GST bharna hai', 'aaj ki sale', 'kitna GST bharna hai'],
    ['sabse zyada kya bika, kitna stock hai', 'sabse zyada kya bika', 'kitna stock hai'],
    // Terse but genuinely two: "sale" and "kharcha" each parse alone. I
    // expected this NOT to split and was wrong — worth keeping as the boundary.
    ['sale aur kharcha', 'sale', 'kharcha'],
  ])('%s', (q, left, right) => {
    expect(splitCompound(q)?.halves).toEqual([left, right])
  })

  test('each half still parses on its own — that is what makes them offerable', () => {
    // The halves are handed straight back as questions to ask. A half that no
    // longer parses would be a button that leads nowhere.
    const c = splitCompound('aaj ki sale and kitna GST bharna hai')!
    expect(parseAsk(c.halves[0])?.intent).toBe('sales_period')
    expect(parseAsk(c.halves[1])?.intent).toBe('tax_due')
  })

  test('the period does not leak between halves', () => {
    /*
     * THE REAL BUG. Answered as one question, "aaj" from the sales half landed
     * on the GST half and produced "GST payable · today". Split, each half
     * carries only its own period.
     */
    const c = splitCompound('aaj ki sale and kitna GST bharna hai')!
    expect(parseAsk(c.halves[0])?.period).toBe('today')
    expect(parseAsk(c.halves[1])?.period).toBe('this_month')
  })

  test('splits at the join that works, not the first one it sees', () => {
    // "Ramesh aur Suresh" is one subject; the real join is the second "aur".
    const c = splitCompound('Ramesh aur Suresh ka balance aur is mahine ki sale')
    expect(c?.halves[1]).toBe('is mahine ki sale')
  })
})

describe('what must NEVER be split', () => {
  test.each([
    ['Ramesh aur Suresh ka balance', 'one question about two people'],
    ['kitna udhaar hai', 'no join at all'],
    ['aur pichhle mahine?', 'a follow-up — B1 owns this, and neither half parses'],
    ['Anil ka kitna baaki hai aur Ramesh ka', '"Ramesh ka" alone is not a question — Phase C'],
    ['chai aur biscuit ka stock', 'product names do not parse, so this stays one question'],
    ['profit aur loss', 'one concept, not two questions — "loss" alone parses as nothing'],
    ['', 'empty'],
  ])('%s — %s', (q) => {
    expect(splitCompound(q)).toBeNull()
  })

  test('a half that does not parse means the join was part of one question', () => {
    /*
     * The whole safety property, stated as a test. If we split on "aur" alone,
     * "Ramesh aur Suresh ka balance" becomes "Ramesh" + "Suresh ka balance"
     * and a perfectly good question turns into a question back at the
     * shopkeeper.
     */
    expect(parseAsk('Ramesh')).toBeNull()
    expect(splitCompound('Ramesh aur Suresh ka balance')).toBeNull()
  })
})
