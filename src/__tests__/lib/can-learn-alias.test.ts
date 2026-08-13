/**
 * 🔒 C2c — teaching the app a name must never remove a correct question.
 *
 * "Learn from what they confirmed" sounds unambiguously good. It is not, and
 * this is the case that shows why:
 *
 *   A shop has Anil Kumar and Anil Sharma. They type "anil". The app offers
 *   both — CORRECTLY, because "anil" genuinely means either. They pick Kumar.
 *
 * Learn "anil" → Anil Kumar from that, and Anil Sharma becomes unreachable by
 * the name his own shopkeeper calls him, silently, forever. We would have
 * destroyed the disambiguation in the act of improving it. What they told us
 * was "this time I meant Kumar", not "anil always means Kumar".
 */

import { describe, test, expect } from '@jest/globals'
import { canLearnAlias } from '@/lib/can-learn-alias'

const SHOP = ['Anil Kumar', 'Anil Sharma', 'Ramesh Kumar', 'Tata Traders']

describe('what IS worth learning', () => {
  test('a nickname the names cannot explain', () => {
    /*
     * The whole point. No amount of letter-comparing discovers that "chhota
     * Ramesh" means Ramesh Kumar — only the shop knows, and only because they
     * just told us.
     */
    const r = canLearnAlias({ said: 'chhota Ramesh', allPartyNames: SHOP })
    expect(r.learn).toBe(true)
  })

  test('it stores the NORMALISED form, so lookups cannot drift', () => {
    const r = canLearnAlias({ said: '  Chhota  RAMESH ', allPartyNames: SHOP })
    expect(r).toEqual({ learn: true, alias: 'chota ramesh' })
  })

  test('but a mere MISSPELLING is not worth learning', () => {
    /*
     * I expected this to be learnable and it is not — correctly.
     *
     * "aneel kumaar" normalises to exactly "anil kumar", because the spelling
     * fold built in C2a already collapses ee→i and aa→a. The ordinary
     * matching finds him without any help, so storing a row would be a second
     * vocabulary repeating the first.
     *
     * Which sharpens what aliases are FOR: not spellings — the comparison
     * handles those — but names the spelling can never reach.
     */
    expect(canLearnAlias({ said: 'aneel kumaar', allPartyNames: SHOP }).learn).toBe(false)
  })

  test('a name no spelling rule could ever reach IS learnable', () => {
    // What the shop actually calls him. Nothing about "bade bhaiya" resembles
    // "Ramesh Kumar"; only the shop could tell us, and they just did.
    expect(canLearnAlias({ said: 'bade bhaiya', allPartyNames: SHOP }).learn).toBe(true)
  })
})

describe('what must NEVER be learned', () => {
  test('a name that genuinely means two people', () => {
    /*
     * THE TRAP. Both Anils start with "anil", so the choice list is the right
     * answer and must stay the answer.
     */
    const r = canLearnAlias({ said: 'anil', allPartyNames: SHOP })
    expect(r).toEqual({ learn: false, reason: 'explained-by-names' })
  })

  test('a name the ordinary matching already finds', () => {
    // "ramesh" already reaches Ramesh Kumar. Storing it would be a second
    // vocabulary repeating the first — and one more row to go stale when the
    // customer is renamed.
    expect(canLearnAlias({ said: 'ramesh', allPartyNames: SHOP }).learn).toBe(false)
    expect(canLearnAlias({ said: 'Tata Traders', allPartyNames: SHOP }).learn).toBe(false)
  })

  test('something too short to be a name', () => {
    // "ra" learned once would swallow Ramesh, Rakesh and Rajesh.
    expect(canLearnAlias({ said: 'ra', allPartyNames: SHOP }))
      .toEqual({ learn: false, reason: 'too-short' })
  })

  test.each(['', '   ', '!!'])('%s is nothing at all', (said) => {
    expect(canLearnAlias({ said, allPartyNames: SHOP }).learn).toBe(false)
  })
})

describe('a shop with nothing in it yet', () => {
  test('the first customer\'s nickname is still learnable', () => {
    expect(canLearnAlias({ said: 'bhaiya ka shop', allPartyNames: [] }).learn).toBe(true)
  })
})
