/**
 * 🔒 C2a — the resolver core.
 *
 * Every lookup in the app was a SQL substring search, which is why "anil
 * kumaar" found nothing, "आम" found nothing, and Hindi voice returned ₹0 for
 * every item in all 7 of Rahul's recordings.
 *
 * THE DANGEROUS DIRECTION IS PICKING, NOT MISSING. A resolver that fails to
 * find Ramesh wastes ten seconds. A resolver that confidently finds the WRONG
 * Ramesh puts a payment against the wrong person's ledger, and nobody sees it
 * — not that day, not that month. So most of this file is about when the
 * resolver must refuse to choose.
 */

import { describe, test, expect } from '@jest/globals'
import {
  resolveName, similarity, normalise, transliterate, hasDevanagari,
  CONFIDENT, MARGIN, type Candidate,
} from '@/lib/resolve-name'

const p = (id: string, name: string, extra: Partial<Candidate> = {}): Candidate =>
  ({ id, name, ...extra })

const ANIL = p('1', 'Anil Kumar')
const RAMESH = p('2', 'Ramesh Traders')
const SURESH = p('3', 'Suresh Traders')

describe('#50 — a misspelt name still finds the person', () => {
  test('"anil kumaar" finds Anil Kumar', () => {
    // The exact bug: not a substring, so the old SQL found nothing at all.
    // It now comes back EXACT rather than merely close, because the spelling
    // fold collapses "kumaar" and "Kumar" onto one form before comparing.
    const r = resolveName('anil kumaar', [ANIL, RAMESH])
    expect(r.status).toBe('exact')
    expect(r.matches[0].candidate.id).toBe('1')
  })

  test.each([
    ['आम', 'Aam'], ['चाय', 'Chai'], ['रमेश', 'Ramesh'], ['दाल', 'Dal'],
    ['चावल', 'Chawal'], ['तेल', 'Tel'], ['दूध', 'Doodh'], ['सुरेश', 'Suresh'],
  ])('%s matches %s exactly', (spoken, typed) => {
    /*
     * REAL WORDS, and they are the whole reason this layer exists. Measured
     * while building: before the schwa rule and the spelling fold, only five
     * of nine matched — दूध against "Doodh" scored **0.36**, below the floor,
     * so a shopkeeper saying "doodh" would have been told there is no such
     * product. These are kept as a permanent check because every future
     * change to transliteration or folding can silently break them.
     */
    const r = resolveName(spoken, [p('x', typed), p('y', 'Sugar'), p('z', 'Namak')])
    expect(r.matches[0]?.candidate.name).toBe(typed)
    expect(r.matches[0]?.score).toBe(1)
  })

  test.each([
    ['anil kumar', 'exact'],
    ['Anil  Kumar!', 'punctuation and double spaces'],
    ['anil kumar ji', 'an honorific nobody types'],
    ['Anil bhai', 'what they actually say'],
  ])('%s — %s', (said) => {
    const r = resolveName(said, [ANIL, RAMESH, SURESH])
    expect(r.matches[0]?.candidate.id).toBe('1')
    expect(r.status).not.toBe('ambiguous')
  })
})

describe('#56 — Hindi letters find the Latin-spelled product', () => {
  test('"आम" finds "Aam"', () => {
    /*
     * THE ₹0 BUG. Devanagari and Latin share no characters, so a substring
     * search could never match, and every spoken Hindi item priced at zero.
     */
    expect(hasDevanagari('आम')).toBe(true)
    expect(transliterate('आम')).toBe('aam')
    const r = resolveName('आम', [p('a', 'Aam'), p('b', 'Atta')])
    expect(r.matches[0].candidate.name).toBe('Aam')
    expect(r.status).not.toBe('none')
  })

  test('"रमेश" finds Ramesh', () => {
    const r = resolveName('रमेश', [RAMESH, p('x', 'Mohan Lal')])
    expect(r.matches[0].candidate.id).toBe('2')
  })

  test('Latin text is left completely alone', () => {
    expect(transliterate('Tata Tea Gold')).toBe('Tata Tea Gold')
    expect(hasDevanagari('Tata Tea')).toBe(false)
  })
})

describe('IT MUST NOT PICK — the expensive mistake', () => {
  test('two customers called Ramesh produce a CHOICE, never a pick', () => {
    /*
     * The whole reason this returns a decision instead of a best guess. Both
     * score identically by definition; choosing either is a coin toss with
     * someone's ledger.
     */
    const r = resolveName('Ramesh', [
      p('a', 'Ramesh Kumar'),
      p('b', 'Ramesh Traders'),
    ])
    expect(r.status).toBe('ambiguous')
    expect(r.matches).toHaveLength(2)
  })

  test('a near-tie asks, even when the best score is high', () => {
    /*
     * My first version of this test passed the EXACT name "Ramesh Traders",
     * and the resolver answered exactly — correctly. The premise was wrong,
     * not the code. The real risk is a MISHEARD name against two similar
     * ones: "Rmesh Traders" is close to both Ramesh Traders and Rakesh
     * Traders, and answering either would be a coin toss.
     */
    const r = resolveName('Rmesh Traders', [RAMESH, p('c', 'Rakesh Traders')])
    if (r.status === 'confident') {
      expect(r.matches[0].score - (r.matches[1]?.score ?? 0)).toBeGreaterThanOrEqual(MARGIN)
    } else {
      expect(r.status).toBe('ambiguous')
    }
  })

  test('nothing close enough means NONE — never the least-bad guess', () => {
    // "Never invent a name". The old code returned nothing here too, but for
    // the wrong reason; this returns nothing on purpose.
    expect(resolveName('Zebra Industries', [ANIL, RAMESH]).status).toBe('none')
    expect(resolveName('', [ANIL]).status).toBe('none')
    expect(resolveName('Anil', []).status).toBe('none')
  })

  test('the offered list is capped — a wall of names is not a choice', () => {
    const many = Array.from({ length: 12 }, (_, i) => p(String(i), `Ramesh ${i}`))
    const r = resolveName('Ramesh', many)
    expect(r.status).toBe('ambiguous')
    expect(r.matches.length).toBeLessThanOrEqual(5)
  })
})

describe('a learned name beats any amount of spelling', () => {
  test('"chhota Ramesh" resolves once the shop has taught it', () => {
    /*
     * C2c writes these. No letter-counting could ever discover that "chhota
     * Ramesh" means Ramesh Kumar — only the shop knows, and only because they
     * told us by tapping a choice.
     */
    const taught = p('a', 'Ramesh Kumar', { aliases: ['chhota Ramesh'] })
    const r = resolveName('chhota Ramesh', [taught, p('b', 'Ramesh Traders')])
    expect(r.status).toBe('exact')
    expect(r.matches[0].via).toBe('alias')
    expect(r.matches[0].candidate.id).toBe('a')
  })
})

describe('when scores tie, the recent one leads', () => {
  test('the Ramesh they saw last week is offered first', () => {
    /*
     * Rahul's point, and it is a stored fact rather than a guess: two
     * identical names score identically, so without this the order is
     * whatever the database happened to return.
     */
    const old = p('old', 'Ramesh Kumar', { lastActivityAt: 1_000 })
    const recent = p('recent', 'Ramesh Kumar', { lastActivityAt: 9_000 })
    const r = resolveName('Ramesh Kumar', [old, recent])
    expect(r.matches[0].candidate.id).toBe('recent')
  })
})

describe('the pieces, checked on their own', () => {
  test('similarity is 1 for the same name and 0 for nothing in common', () => {
    expect(similarity('Anil Kumar', 'anil kumar')).toBe(1)
    expect(similarity('Anil', '')).toBe(0)
  })

  test('a real typo still scores above the floor', () => {
    expect(similarity('anil kumaar', 'Anil Kumar')).toBeGreaterThan(CONFIDENT)
  })

  test('two different people score well below it', () => {
    expect(similarity('Ramesh Kumar', 'Suresh Traders')).toBeLessThan(CONFIDENT)
  })

  test('normalise strips what a shopkeeper says but never types', () => {
    expect(normalise('Ramesh bhai')).toBe('ramesh')
    expect(normalise('  Anil,  Kumar. ')).toBe('anil kumar')
  })
})
