/**
 * 🔒 #73 — a list must say how many MATCHED, not how many are loaded.
 *
 * Rahul searched the sales ledger, saw "5 entries", and concluded the app had
 * searched only the fifty rows on screen. It had not — the search runs in the
 * database across invoice number, notes, party name and phone, over every
 * record — but the only number any list could show was the size of the page.
 *
 * That is the cheapest kind of damage to do to a ledger app: nothing was
 * wrong with the data, and he stopped trusting it anyway.
 */

import { describe, test, expect } from '@jest/globals'
import { listCountLabel } from '@/lib/list-count-label'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('when there is more than the page shows', () => {
  test('says how many matched', () => {
    // THE BUG, stated as a test: 50 loaded, 128 matched.
    expect(listCountLabel({ shown: 50, matched: 128 })).toBe('Showing 50 of 128')
  })

  test('a capped count says so with a plus, never a fake exact number', () => {
    /*
     * Counting every row in a shop with millions is slow, so the server counts
     * to a ceiling. "500+" is true and cheap; claiming to know the exact
     * figure would trade a misleading label for a slow screen.
     */
    expect(listCountLabel({ shown: 50, matched: 500, matchedIsExact: false }))
      .toBe('Showing 50 of 500+')
  })
})

describe('when the page IS everything', () => {
  test('says nothing extra — a five-bill shop reads "5 entries"', () => {
    // "Showing 5 of 5" invites a question where none exists.
    expect(listCountLabel({ shown: 5, matched: 5 })).toBe('5 entries')
  })

  test('one entry is singular', () => {
    expect(listCountLabel({ shown: 1, matched: 1 })).toBe('1 entry')
  })

  test('an empty list says nothing at all', () => {
    expect(listCountLabel({ shown: 0, matched: 0 })).toBeNull()
  })
})

describe('when we do not know the total', () => {
  /*
   * Offline, or a response cached before this field existed. Inventing a
   * total here would be exactly the invented number this task exists to
   * remove. Written out rather than as test.each — the three cases have
   * different types, and fighting the table's typing taught nothing.
   */
  test('field absent — an older cached response', () => {
    expect(listCountLabel({ shown: 12 })).toBe('12 entries')
  })

  test('explicitly unknown', () => {
    expect(listCountLabel({ shown: 12, matched: null })).toBe('12 entries')
  })

  test('garbage', () => {
    expect(listCountLabel({ shown: 12, matched: NaN })).toBe('12 entries')
  })

  test('a total SMALLER than the page does not print nonsense', () => {
    /*
     * Reachable for a moment in the real screen: the list filters locally on
     * every keystroke while the server query is still debounced by 350ms, so
     * the two counts briefly answer different questions. "Showing 8 of 3"
     * would be visible nonsense.
     */
    expect(listCountLabel({ shown: 8, matched: 3 })).toBe('8 entries')
  })
})

describe('the ledger actually uses it', () => {
  const ledger = readFileSync(join(process.cwd(), 'src/components/ledger/Ledger.tsx'), 'utf8')
  const api = readFileSync(join(process.cwd(), 'src/app/api/transactions/route.ts'), 'utf8')

  test('the screen no longer prints the loaded row count', () => {
    // The exact expression that produced "5 entries" for a 128-row result.
    expect(ledger).not.toMatch(/\{sorted\.length\} \{sorted\.length === 1 \?/)
    expect(ledger).toContain('listCountLabel(')
  })

  test('and the API sends a real total to show', () => {
    expect(api).toContain('matched:')
    expect(api).toContain('matchedIsExact')
    // Counted by ids only, with a ceiling — never a bare count(*) over
    // millions of filtered rows.
    expect(api).toMatch(/COUNT_CAP/)
  })
})
