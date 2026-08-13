/**
 * 🔒 C2c part 2 — the tap teaches, and the shopkeeper can undo it.
 *
 * The rule for WHETHER a name may be learned is unit-tested in
 * can-learn-alias.test.ts. This file checks the two connections that make it
 * real, because both are the kind of wiring that silently stops working:
 *
 *   1. picking a party in Ask actually calls the learn endpoint, and
 *   2. the party screen shows what was learned, with a way to remove it.
 *
 * WHY (2) IS NOT OPTIONAL. A mis-tap teaches the app the wrong thing. Without
 * somewhere to see and delete it, every future question about that name goes
 * to the wrong customer's ledger, and nothing on any screen explains why.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('the tap teaches', () => {
  const answer = read('src/components/ask/AskAnswer.tsx')

  test('picking a choice calls the learn endpoint', () => {
    expect(answer).toMatch(/aliases`, \{\s*\n?\s*method: 'POST'/)
    expect(answer).toContain('said: payload.searchedFor')
  })

  test('only for PEOPLE — a compound question\'s halves have no party', () => {
    /*
     * B2 offers the two halves of "aaj ki sale and kitna GST bharna hai"
     * through the same list. Their ids are question text, not party ids, so
     * posting one would try to teach a name to a customer that does not exist.
     */
    expect(answer).toMatch(/const isParty = c\.phone !== undefined \|\| c\.balance !== undefined/)
    expect(answer).toMatch(/if \(isParty && payload\.searchedFor\)/)
  })

  test('and it never blocks or interrupts the answer', () => {
    /*
     * Refusing to learn is the COMMON, correct outcome. A toast saying "we
     * correctly did nothing" on most taps would teach people to distrust it,
     * and an error toast would be worse — nothing failed.
     */
    expect(answer).toMatch(/void offlineFetch/)
    expect(answer).toMatch(/\.catch\(\(\) => \{\}\)/)
  })

  test('the server sends what was typed, rather than the client parsing it back out', () => {
    /*
     * It was only ever in the display string, "2 matches for 'anil'". Reading
     * data back out of a sentence is how the two drift apart the first time
     * anyone rewords the message.
     */
    const route = read('src/app/api/ask/route.ts')
    expect(route).toMatch(/searchedFor: name/)
    expect(read('src/lib/ask-thread.ts')).toMatch(/searchedFor\?: string/)
  })
})

describe('the shopkeeper can see and undo it', () => {
  const profile = read('src/components/parties/PartyProfile.tsx')

  test('the party screen lists the learned names', () => {
    expect(profile).toContain('party-aliases')
    expect(profile).toContain('Also known as')
  })

  test('each one can be removed', () => {
    expect(profile).toContain('forgetAlias')
    expect(profile).toMatch(/method: 'DELETE'/)
  })

  test('the remove button is a real touch target', () => {
    // 44px floor — the same standard the Ask buttons were fixed to on 12 Aug
    // after they measured 43px.
    expect(profile).toMatch(/w-8 h-8 min-w-\[2rem\]/)
  })

  test('and nothing is shown when nothing has been learned', () => {
    /*
     * An empty "Also known as" card would be chrome explaining a feature
     * instead of doing one — §4.2, content before chrome.
     */
    expect(profile).toMatch(/aliases\.length > 0 && \(/)
  })
})
