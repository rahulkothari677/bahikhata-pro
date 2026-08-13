/**
 * 🔒 D2 (#56) — a spoken item never lands at ₹0 without saying so.
 *
 * Hindi voice entry priced EVERY item at zero, in all seven of Rahul's
 * recordings. The cause was one line:
 *
 *     products.find(p => p.name?.toLowerCase().includes(itemName) || …)
 *
 * A substring test against Latin product names. "आम" shares no characters
 * with "Aam", so nothing ever matched; with no product and no spoken price,
 * the item was added at `unitPrice: 0` — and the toast still said "Added 2
 * items to sale".
 *
 * A SUCCESS MESSAGE OVER A LINE WORTH NOTHING, in the entry path the app is
 * built around. The shopkeeper finds out weeks later, in a report, if at all.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveName } from '@/lib/resolve-name'

/** Comments quote the patterns being banned — read the code, not the prose. */
const src = readFileSync(
  join(process.cwd(), 'src/components/ledger/TransactionEntry.tsx'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the substring match is gone', () => {
  test('items resolve through the shared resolver', () => {
    expect(src).toMatch(/resolveName\(\s*\n?\s*spokenName/)
  })

  test('and not by pushing strings into each other', () => {
    // The exact shape that could never match Devanagari.
    expect(src).not.toMatch(/itemName\.includes\(p\.name/)
  })
})

describe('a zero-price line is announced, never celebrated', () => {
  test('success counts only what matched', () => {
    expect(src).toMatch(/const matchedCount = newItems\.length - unmatched\.length/)
    expect(src).toMatch(/if \(matchedCount > 0\)/)
  })

  test('and anything unmatched is named so it can be priced', () => {
    /*
     * The line is still ADDED — dropping what they said is the D1 mistake,
     * and a shopkeeper who spoke an item should see it on screen. What
     * changes is that it arrives labelled instead of silently worth nothing.
     */
    expect(src).toMatch(/Not in your products/)
    expect(src).toMatch(/unmatched\.push\(spokenName\)/)
  })
})

describe('what the resolver does with real spoken items', () => {
  const SHELF = [
    { id: '1', name: 'Aam' },
    { id: '2', name: 'Doodh' },
    { id: '3', name: 'Chawal' },
    { id: '4', name: 'Tata Tea Gold 500g' },
  ]

  test.each([
    ['आम', '1'],
    ['दूध', '2'],
    ['चावल', '3'],
  ])('%s finds the right product', (spoken, id) => {
    /*
     * The whole of #56 in three rows. Each of these previously matched
     * nothing and was priced at zero.
     */
    const r = resolveName(spoken, SHELF)
    expect(r.matches[0]?.candidate.id).toBe(id)
    expect(r.status).not.toBe('none')
  })

  test.each([
    ['dudh', '2'],     // the shop typed "Doodh"
    ['chaval', '3'],   // the shop typed "Chawal"
  ])('%s survives the spelling nobody agrees on', (spoken, id) => {
    expect(resolveName(spoken, SHELF).matches[0]?.candidate.id).toBe(id)
  })

  test('something not on the shelf is refused, so the warning fires', () => {
    expect(resolveName('Refrigerator', SHELF).status).toBe('none')
  })
})
