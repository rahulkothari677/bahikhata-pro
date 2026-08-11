/**
 * 🔒 Finding a screen by the words a shopkeeper actually says.
 *
 * ── WHAT THIS FOUND, WHICH IS NOT A NEW-FEATURE BUG ───────────────────
 *
 * Building open-by-command meant matching spoken names against the nav
 * registry, and probing it showed that **34 of 66 destinations had no search
 * keywords at all** — P&L, every GSTR return, trial balance, stock report,
 * inventory aging, backup.
 *
 * That is a bug in the LIVE SEARCH BOX, not just in my new code: GlobalSearch
 * filters on the same `keywords` field, so typing "profit and loss" into
 * search could not find the Profit & Loss report either. It worked only for
 * people who typed something close to the label.
 *
 * Keywords are now filled in for all 34, in English and Hinglish, which fixes
 * search and enables commands from the same data. One vocabulary (rule B6).
 *
 * ── THE THREE TIES THAT WORD-COUNTING COULD NOT BREAK ─────────────────
 *
 * "profit and loss", "annual return" and "dead stock" each tied several
 * destinations, because scoring words in isolation cannot tell "annual
 * return" from "sale return" — both contain "return". An exact PHRASE match
 * now outranks scattered words, which is the rule a person is applying when
 * they say it.
 */

import { describe, test, expect } from '@jest/globals'
import { findDestinations } from '@/lib/nav-match'
import { NAV_REGISTRY } from '@/lib/nav-registry'

const top = (q: string) => findDestinations(q)[0]?.destination.id
const all = (q: string) => findDestinations(q).map(m => m.destination.id)

describe('exact names resolve to exactly one screen', () => {
  test.each([
    ['sales', 'sales'],
    ['dashboard', 'dashboard'],
    ['parties dikhao', 'parties'],
    ['inventory kholo', 'inventory'],
    ['stock report', 'stock-report'],
    ['cash flow', 'cashflow'],
    ['trial balance', 'trial-balance'],
    ['staff access', 'staff-access'],
    ['hsn summary', 'hsn-summary'],
  ])('%s → %s', (q, id) => {
    expect(findDestinations(q)).toHaveLength(1)
    expect(top(q)).toBe(id)
  })
})

describe('the command words themselves are ignored', () => {
  test('kholo / dikhao / open / show do not affect the match', () => {
    for (const q of ['GSTR-1', 'GSTR-1 kholo', 'open GSTR-1', 'show me GSTR-1', 'GSTR-1 dikhao']) {
      expect({ q, id: top(q) }).toEqual({ q, id: 'gstr-1' })
    }
  })
})

describe('abbreviations people actually write', () => {
  test('P&L finds the P&L Statement', () => {
    /*
     * This found NOTHING before. Punctuation strips to "p l" — two
     * single letters, both discarded as too short to score. The compact-id
     * check catches abbreviations that ARE the id.
     */
    expect(top('P&L')).toBe('pl')
    expect(top('pl')).toBe('pl')
  })

  test('gstr 3b, with or without the hyphen', () => {
    expect(top('gstr 3b')).toBe('gstr-3b')
    expect(top('gstr-3b')).toBe('gstr-3b')
    expect(top('gstr3b')).toBe('gstr-3b')
  })
})

describe('an exact phrase beats scattered words', () => {
  test('"annual return" is GSTR-9, not a sale return', () => {
    // Tied at 90 with sale-return and purchase-return before the phrase rule —
    // all three contain the word "return".
    expect(findDestinations('annual return')).toHaveLength(1)
    expect(top('annual return')).toBe('gstr-9')
  })

  test('"dead stock" is Inventory Aging, not the stock report', () => {
    expect(findDestinations('dead stock')).toHaveLength(1)
    expect(top('dead stock')).toBe('inventory-aging')
  })

  test('"sale return" is still the sale return — the rule cuts both ways', () => {
    expect(top('sale return')).toBe('sale-return')
    expect(top('purchase return')).toBe('purchase-return')
  })
})

describe('Hinglish finds screens with English labels', () => {
  test.each([
    ['purana udhaar', 'debt-aging'],
    ['customer statement', 'party-statement'],
  ])('%s → %s', (q, id) => expect(top(q)).toBe(id))
})

describe('it offers rather than guesses', () => {
  test('a genuine ambiguity returns several, and does not pick', () => {
    /*
     * "profit and loss" legitimately fits both the P&L Statement and the
     * Reports hub. Returning both and letting the shopkeeper choose is the
     * same treatment two customers named Ramesh get — the alternative is the
     * app deciding what they meant.
     */
    const matches = all('profit and loss')
    expect(matches.length).toBeGreaterThan(1)
    expect(matches).toContain('pl')
  })

  test('nothing matching returns nothing, rather than the nearest thing', () => {
    expect(findDestinations('xyzzy')).toEqual([])
    expect(findDestinations('')).toEqual([])
    expect(findDestinations('   ')).toEqual([])
    // Only stop-words: no meaning left to match on.
    expect(findDestinations('kholo dikhao')).toEqual([])
  })
})

describe('the registry itself', () => {
  test('every destination now has search keywords', () => {
    /*
     * The gap this whole file came from. A destination with no keywords is
     * findable only by typing its label, which is not how anyone searches.
     */
    const without = NAV_REGISTRY.filter(d => !d.keywords || !d.keywords.trim()).map(d => d.id)
    expect({ destinationsWithNoKeywords: without }).toEqual({ destinationsWithNoKeywords: [] })
  })

  test('a "coming soon" destination is never offered as somewhere to go', () => {
    // Sending someone there by command would answer "open X" with a message
    // saying X does not exist yet.
    const comingSoon = NAV_REGISTRY.filter(d => d.actionKind === 'coming-soon')
    for (const d of comingSoon) {
      expect({ id: d.id, offered: all(d.label).includes(d.id) })
        .toEqual({ id: d.id, offered: false })
    }
  })
})
