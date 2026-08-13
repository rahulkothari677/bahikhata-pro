/**
 * 🔒 C2b — "pehla" picks the first option.
 *
 * When two customers share a name the app offers both instead of guessing.
 * That refusal is the right behaviour, but it hands the shopkeeper a job — and
 * if they asked by VOICE their hands are busy. Making them look at the phone
 * and tap accurately is how the safe path becomes the annoying one, and an
 * annoying safe path is how people learn to avoid the thing protecting them.
 *
 * THE DANGEROUS DIRECTION IS THE FALSE PICK. Reading an ordinary question as
 * a tap opens somebody's ledger without being asked, so most of this file is
 * about what must NOT count.
 */

import { describe, test, expect } from '@jest/globals'
import { pickFromChoices } from '@/lib/pick-from-choices'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('picking by voice or keyboard', () => {
  test.each([
    ['pehla', 0], ['pahla', 0], ['first', 0], ['1', 0], ['ek', 0],
    ['dusra', 1], ['doosra', 1], ['second', 1], ['2', 1], ['do', 1],
    ['teesra', 2], ['third', 2], ['3', 2], ['teen', 2],
  ])('%s picks option %i', (said, index) => {
    expect(pickFromChoices(said, 3)).toBe(index)
  })

  test('case and punctuation do not matter — voice adds both', () => {
    expect(pickFromChoices('Pehla.', 2)).toBe(0)
    expect(pickFromChoices('  DUSRA  ', 2)).toBe(1)
  })

  test('the filler people actually say is ignored', () => {
    // "pehla wala" — the first one.
    expect(pickFromChoices('pehla wala', 2)).toBe(0)
    expect(pickFromChoices('option 2', 2)).toBe(1)
  })
})

describe('what must NEVER be read as a pick', () => {
  test('nothing is a pick when no list is waiting', () => {
    /*
     * "1" and "do" are ordinary words. Outside a choice list they must reach
     * the normal pipeline, or a real question gets swallowed and a different
     * one answered.
     */
    expect(pickFromChoices('pehla', 0)).toBeNull()
    expect(pickFromChoices('1', 0)).toBeNull()
  })

  test('a question that merely starts with an ordinal is left alone', () => {
    /*
     * THE FALSE PICK THIS GUARDS. "pehle wale Ramesh ka kitna baaki hai" is a
     * question, not a tap — answering it as a tap would open a ledger nobody
     * asked for. The whole message must be the pick.
     */
    expect(pickFromChoices('pehle wale Ramesh ka kitna baaki hai', 2)).toBeNull()
    expect(pickFromChoices('first month ki sale', 2)).toBeNull()
  })

  test('asking for an option that does not exist is not a pick', () => {
    // "chautha" with two on screen is a misunderstanding, not a choice. Better
    // to answer it as a question and let them see the list again.
    expect(pickFromChoices('chautha', 2)).toBeNull()
    expect(pickFromChoices('5', 3)).toBeNull()
  })

  test.each(['', '   ', 'kitna udhaar hai', 'Ramesh', 'aur pichhle mahine?'])(
    '%s is not a pick', (q) => {
      expect(pickFromChoices(q, 3)).toBeNull()
    },
  )
})

describe('the wiring', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  test('the chat checks for a pick before sending a question', () => {
    const chat = read('src/components/ask/AskChat.tsx')
    expect(chat).toContain('pickFromChoices(')
    // Only when a list is actually on screen.
    expect(chat).toMatch(/waiting\.length > 1/)
  })

  test('the list is numbered on screen', () => {
    // A spoken "pehla" is useless if nothing shows which one is first.
    const answer = read('src/components/ask/AskAnswer.tsx')
    expect(answer).toMatch(/choices\.map\(\(c, i\)/)
    expect(answer).toMatch(/\{i \+ 1\}\./)
  })

  test('and the server offers the most recent match first', () => {
    /*
     * Two customers called Ramesh are identical on the page. The only thing
     * that separates them is which one you saw last week — a stored fact, and
     * the same rule the resolver core uses to break ties.
     */
    const route = read('src/app/api/ask/route.ts')
    expect(route).toMatch(/enriched\.sort\(\(a, b\) => b\._at - a\._at\)/)
  })
})
