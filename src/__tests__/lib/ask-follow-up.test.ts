/**
 * 🔒 B1 — "aur pichhle mahine?"
 *
 * Before this, a follow-up matched no pattern, so it went to a MODEL with
 * three words of context and had to guess what it continued. The rest of Ask
 * exists so a model never guesses; this was the hole.
 *
 * The dangerous direction is over-eagerness, not under. A question that has a
 * subject of its own must be answered on its own terms — resolving it against
 * an earlier one would answer something the shopkeeper did not ask, using
 * their real money, and the transcript would look perfectly reasonable.
 */

import { describe, test, expect } from '@jest/globals'
import { resolveFollowUp, isBarePeriod } from '@/lib/ask-follow-up'
import { parseAsk } from '@/lib/ask-patterns'

const SALES = 'is mahine ki sale kitni hui'

describe('what counts as a follow-up', () => {
  test.each([
    'aur pichhle mahine?',
    'aur pichhle mahine ka kya hua',
    'and last month?',
    'what about last month',
    'pichhle mahine?',
    'aur aaj?',
    'aur is hafte',
  ])('%s is bare — it carries no subject of its own', (q) => {
    expect(isBarePeriod(q)).toBe(true)
  })

  test.each([
    ['pichhle mahine ki sale', 'names its own subject'],
    ['aur Ramesh ka?', 'a bare NAME is not resolved — see the file header'],
    ['kitna kharcha hua', 'no period at all'],
    ['aur?', 'no period, so nothing to change'],
    ['', 'empty'],
    ['kya hua', 'filler only, no period'],
  ])('%s is NOT bare (%s)', (q) => {
    expect(isBarePeriod(q)).toBe(false)
  })
})

describe('rebuilding the whole question', () => {
  test('keeps the subject, swaps the period', () => {
    const r = resolveFollowUp('aur pichhle mahine?', [SALES])
    expect(r?.question).toBe('ki sale kitni hui pichhle mahine')
    expect(r?.basedOn).toBe(SALES)
  })

  test('and the rebuilt question actually parses to the same intent', () => {
    /*
     * THE TEST THAT MATTERS. A rewrite that reads well but no longer matches
     * any pattern would send the shopkeeper to the model anyway — B1 would
     * look done and change nothing. So assert on the PARSER, not the string.
     */
    const before = parseAsk(SALES)
    const after = parseAsk(resolveFollowUp('aur pichhle mahine?', [SALES])!.question)
    expect(after?.intent).toBe(before?.intent)
    expect(before?.period).toBe('this_month')
    expect(after?.period).toBe('last_month')
  })

  test('a party question keeps the particle its pattern matches on', () => {
    /*
     * THE BUG THIS PINS. The obvious implementation reuses stripPeriodWords,
     * which also removes ka/ki/ke because its real job is pulling names out of
     * sentences. That would turn "Anil ka kitna baaki hai" into "Anil kitna
     * baaki hai" and partyBalanceShape would stop matching — so the follow-up
     * would silently stop being about Anil.
     */
    const r = resolveFollowUp('aur pichhle mahine?', ['Anil ka kitna baaki hai'])
    expect(r?.question).toContain('anil ka')
    expect(parseAsk(r!.question)?.partyName?.toLowerCase()).toBe('anil')
  })

  test('two follow-ups in a row both resolve against the real question', () => {
    /*
     * "aur pichhle mahine?" then "aur is hafte?". Resolving the second against
     * the first would rebuild "is hafte aur pichhle mahine" — a question about
     * nothing. Walking back past bare questions is what stops that.
     */
    const r = resolveFollowUp('aur is hafte?', ['aur pichhle mahine?', SALES])
    expect(r?.question).toBe('ki sale kitni hui is hafte')
    expect(r?.basedOn).toBe(SALES)
  })
})

describe('when it must NOT resolve', () => {
  test('the very first message is a bare period — nothing to attach to', () => {
    // Inventing a subject here would answer a question nobody asked. Null
    // sends it down the normal path, which says it cannot answer and offers
    // examples: the honest outcome.
    expect(resolveFollowUp('aur pichhle mahine?', [])).toBeNull()
    expect(resolveFollowUp('aur pichhle mahine?', null)).toBeNull()
  })

  test('every earlier question was itself bare', () => {
    expect(resolveFollowUp('aur is hafte?', ['aur pichhle mahine?', 'aur aaj?'])).toBeNull()
  })

  test('a question with its own subject is left completely alone', () => {
    expect(resolveFollowUp('pichhle mahine ki sale', [SALES])).toBeNull()
    expect(resolveFollowUp('kitna GST bharna hai', [SALES])).toBeNull()
  })

  test('a bare NAME is never resolved', () => {
    // "never invent a name" is a hard rule: Ramesh could be a party, a product
    // or a category. That collision is Phase C's resolver, not this.
    expect(resolveFollowUp('aur Ramesh ka?', [SALES])).toBeNull()
  })
})
