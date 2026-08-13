/**
 * 🔒 D1 — a customer's name, once spoken, is never silently dropped.
 *
 * Voice entry matched the spoken party like this:
 *
 *     if (matched) setPartyId(matched.id)
 *
 * With no else. Say "sold 2 kg sugar to Ramesh", have the name fail to match,
 * and the customer vanished — the sale kept whatever party was already
 * selected, or none at all, and nothing on screen said so.
 *
 * That is the worst shape a bug can take in a ledger: a sale recorded against
 * the WRONG PERSON is a debt the right person never sees, and the shopkeeper
 * has no way to discover it. They spoke the name; they would reasonably assume
 * it was used.
 *
 * The match was also substring-both-ways, so "Ramesh" quietly claimed
 * "Rameshwar Traders" while one misheard letter matched nothing.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveName } from '@/lib/resolve-name'

/*
 * Comments quote the very line being banned ("This was `if (matched)…`"), so
 * they are stripped first. Fourth time a source scan of mine has read its own
 * prose as code — it is now the default, not an afterthought.
 */
const src = readFileSync(
  join(process.cwd(), 'src/components/ledger/TransactionEntry.tsx'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the silent drop is gone', () => {
  test('every outcome of the lookup is handled', () => {
    /*
     * The exact line that shipped. If it ever returns, a spoken name can be
     * lost again with no trace.
     */
    expect(src).not.toMatch(/if \(matched\) setPartyId\(matched\.id\)/)
    expect(src).toMatch(/decision\.status === 'ambiguous'/)
    expect(src).toMatch(/\} else \{[\s\S]{0,400}No customer called/)
  })

  test('the shopkeeper is told, not left guessing', () => {
    // Two different messages, because "I found several" and "I found none"
    // need two different things from them.
    expect(src).toMatch(/Which \$\{decision\.matches/)
    expect(src).toMatch(/No customer called/)
  })

  test('it uses the same resolver as Ask, not a sixth matching path', () => {
    /*
     * There were already five places that decided what a name meant, each
     * slightly differently. Adding a better one here would have made six.
     */
    expect(src).toContain("from '@/lib/resolve-name'")
    expect(src).toMatch(/resolveName\(\s*\n?\s*data\.partyName/)
    // ...and the old substring-both-ways match is gone.
    expect(src).not.toMatch(/data\.partyName\.toLowerCase\(\)\.includes\(p\.name/)
  })
})

describe('what the resolver does for the cases voice actually produces', () => {
  const SHOP = [
    { id: 'a', name: 'Ramesh Kumar' },
    { id: 'b', name: 'Rameshwar Traders' },
    { id: 'c', name: 'Anil Kumar' },
  ]

  test('a misheard name that means one person is used', () => {
    const r = resolveName('Ramesh Kumar', SHOP)
    expect(r.status).toBe('exact')
    expect(r.matches[0].candidate.id).toBe('a')
  })

  test('"Ramesh" alone is NOT quietly given to Rameshwar Traders', () => {
    /*
     * The old substring match could do exactly that: "Rameshwar Traders"
     * CONTAINS "Ramesh", and `.find()` returned whichever sat first in the
     * list — so a sale meant for Ramesh Kumar could land on another party's
     * ledger without a word.
     *
     * I expected the resolver to call this ambiguous. It does not, and it is
     * right: "Ramesh" is the whole first word of "Ramesh Kumar" and merely
     * the start of "Rameshwar", so one is clearly nearer. What matters is
     * that the answer is DETERMINISTIC and is the sensible person — not the
     * accident of list order.
     */
    const r = resolveName('Ramesh', SHOP)
    expect(r.matches[0].candidate.id).toBe('a')
    expect(r.matches[0].candidate.name).not.toBe('Rameshwar Traders')
  })

  test('a name nobody has is refused, so the else branch fires', () => {
    expect(resolveName('Zebra Industries', SHOP).status).toBe('none')
  })
})
