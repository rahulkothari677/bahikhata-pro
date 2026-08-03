/**
 * 🔒 A SEARCH TERM MUST MATCH LITERALLY.
 *
 * Found by probing the live API on 2026-08-03, not by reading code and not by
 * any existing test:
 *
 *   GET /api/transactions?search=%   → the entire ledger came back
 *   GET /api/transactions?search=_   → the entire ledger came back
 *
 * Prisma's `contains` compiles to LIKE and does not escape the term, so
 * Postgres' metacharacters stayed live. Scoped by userId throughout, so no
 * other shop's data was reachable — but the results were simply wrong, and `_`
 * is common enough in references that a shopkeeper would hit it by accident.
 */
import fs from 'fs'
import path from 'path'
import { escapeLikeWildcards } from '@/lib/escape-like'

describe('escapeLikeWildcards', () => {
  test('an ordinary term is untouched', () => {
    expect(escapeLikeWildcards('INV-20260428-009')).toBe('INV-20260428-009')
    expect(escapeLikeWildcards('Ramesh Verma')).toBe('Ramesh Verma')
    expect(escapeLikeWildcards('')).toBe('')
  })

  test('% no longer means "anything"', () => {
    expect(escapeLikeWildcards('%')).toBe('\\%')
    expect(escapeLikeWildcards('50%')).toBe('50\\%')
  })

  test('_ no longer means "any single character"', () => {
    // INV_001 must not also match INV-001 / INV0001.
    expect(escapeLikeWildcards('INV_001')).toBe('INV\\_001')
  })

  test('a literal backslash survives', () => {
    expect(escapeLikeWildcards('a\\b')).toBe('a\\\\b')
  })

  test('the backslash is escaped BEFORE the metacharacters', () => {
    // Escaping % first would produce a\% and then double-escape the backslash
    // into a\\%, turning an escaped wildcard back into a live one.
    expect(escapeLikeWildcards('\\%')).toBe('\\\\\\%')
  })

  test('a term of only metacharacters escapes to only escaped ones', () => {
    expect(escapeLikeWildcards('%_%')).toBe('\\%\\_\\%')
  })
})

describe('the transactions API escapes before querying', () => {
  const src = fs
    .readFileSync(path.join(process.cwd(), 'src/app/api/transactions/route.ts'), 'utf8')
    .replace(/\r\n/g, '\n')

  test('the search param is passed through the escaper', () => {
    expect(src).toMatch(/const search = escapeLikeWildcards\(/)
  })

  test('nothing else feeds a raw search term into contains', () => {
    // Guards against a future arm being added from the unescaped value.
    const block = src.slice(src.indexOf('const search = '), src.indexOf('const search = ') + 900)
    const containsArms = block.match(/contains: (\w+)/g) || []
    expect(containsArms.length).toBeGreaterThanOrEqual(4)
    for (const arm of containsArms) expect(arm).toBe('contains: search')
  })
})
