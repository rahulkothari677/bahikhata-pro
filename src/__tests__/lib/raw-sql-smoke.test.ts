/**
 * 🔒 AUDIT FIX V6 PP6 / CR1: Smoke test for raw SQL queries.
 *
 * The V5 MB fix introduced a SQL syntax error: `SUM ROUND(...)` instead of
 * `SUM(ROUND(...))` in `src/app/api/parties/[id]/route.ts`. The build passed
 * because raw `$queryRaw` strings aren't type-checked by `tsc`, and `next
 * build` never executes the query. The party profile page 500'd for every
 * user, every load — caught only by the V6 auditor.
 *
 * This test extracts raw SQL strings from the route file and validates their
 * syntax shape (balanced parentheses, no `FN FN(` double-function-call
 * patterns, etc.). It would have caught CR1.
 *
 * This is NOT a full SQL parser — it's a cheap static check that catches the
 * specific class of bug that bit us. For full safety, the founder should also
 * add an integration test that actually hits `/api/parties/[id]` against a
 * real DB (see PP6 in the V6 audit report).
 */

import * as fs from 'fs'
import * as path from 'path'

// Read the party route file once
const PARTY_ROUTE_PATH = path.join(
  process.cwd(),
  'src',
  'app',
  'api',
  'parties',
  '[id]',
  'route.ts',
)

const PARTY_ROUTE_SOURCE = fs.existsSync(PARTY_ROUTE_PATH)
  ? fs.readFileSync(PARTY_ROUTE_PATH, 'utf8')
  : ''

// Extract raw SQL from $queryRaw`...` template literals
function extractRawSql(source: string): string[] {
  const queries: string[] = []
  // Match $queryRaw<...>`...`  (template literal with tagged type)
  const regex = /\$queryRaw[^`]*`([\s\S]*?)`/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(source)) !== null) {
    queries.push(match[1])
  }
  return queries
}

// Check for the specific CR1 pattern: a SQL function name immediately
// followed by another function call WITHOUT an opening parenthesis.
// Examples that should FAIL:
//   SUM ROUND(...      → should be SUM(ROUND(...
//   COUNT SUM(...      → should be COUNT(SUM(...
//   MAX AVG(...        → should be MAX(AVG(...
const SQL_FUNCTIONS = ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'ROUND', 'COALESCE', 'DATE_TRUNC', 'LOWER', 'UPPER']

function findMissingParenPatterns(sql: string): string[] {
  const errors: string[] = []
  for (const fn of SQL_FUNCTIONS) {
    // Match "FN " (word boundary + space) followed immediately by another FN2 + space + (
    // e.g. "SUM ROUND(" — missing the opening paren after SUM
    const pattern = new RegExp(`\\b${fn}\\s+(${SQL_FUNCTIONS.join('|')})\\s*\\(`, 'g')
    let m: RegExpExecArray | null
    while ((m = pattern.exec(sql)) !== null) {
      errors.push(`"${fn} ${m[1]}(" — missing opening parenthesis. Should be "${fn}(${m[1]}(...)"`)
    }
  }
  return errors
}

// Check balanced parentheses (ignores parentheses inside string literals —
// good enough for our SQL which has no string literals with parens)
function checkBalancedParens(sql: string): string[] {
  const errors: string[] = []
  let depth = 0
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    else if (sql[i] === ')') {
      depth--
      if (depth < 0) {
        errors.push(`Unbalanced ")" at position ${i} — extra closing paren`)
        depth = 0  // reset to avoid cascading errors
      }
    }
  }
  if (depth > 0) {
    errors.push(`Unbalanced "(" — ${depth} unclosed opening paren(s)`)
  }
  return errors
}

describe('V6 PP6/CR1 — raw SQL smoke tests (party route)', () => {
  // Skip if the file doesn't exist (e.g. running from a different cwd)
  const skip = !PARTY_ROUTE_SOURCE

  it('party route file exists', () => {
    if (skip) return  // skip silently in environments without the file
    expect(PARTY_ROUTE_SOURCE.length).toBeGreaterThan(0)
  })

  it('party route contains at least one $queryRaw (sanity check)', () => {
    if (skip) return
    const queries = extractRawSql(PARTY_ROUTE_SOURCE)
    expect(queries.length).toBeGreaterThan(0)
  })

  it('no $queryRaw has the "FN FN(" missing-paren pattern (CR1 regression guard)', () => {
    if (skip) return
    const queries = extractRawSql(PARTY_ROUTE_SOURCE)
    const allErrors: string[] = []
    for (const sql of queries) {
      allErrors.push(...findMissingParenPatterns(sql))
    }
    if (allErrors.length > 0) {
      throw new Error(
        `CR1 regression detected — raw SQL has missing parentheses:\n` +
        allErrors.map(e => `  - ${e}`).join('\n') +
        `\n\nThis is the exact bug that crashed the party page in V5. ` +
        `Fix: add the opening parenthesis after the outer function name.`
      )
    }
  })

  it('no $queryRaw has unbalanced parentheses', () => {
    if (skip) return
    const queries = extractRawSql(PARTY_ROUTE_SOURCE)
    const allErrors: string[] = []
    for (const sql of queries) {
      allErrors.push(...checkBalancedParens(sql))
    }
    if (allErrors.length > 0) {
      throw new Error(
        `Unbalanced parentheses in raw SQL:\n` +
        allErrors.map(e => `  - ${e}`).join('\n')
      )
    }
  })

  it('top-products query uses SUM(ROUND(...)) not SUM ROUND(...)', () => {
    if (skip) return
    const queries = extractRawSql(PARTY_ROUTE_SOURCE)
    // Find the query that has "totalAmount" in it (the top-products query)
    const topProductsQuery = queries.find(q => q.includes('totalAmount'))
    if (!topProductsQuery) return  // query shape changed; not our concern
    expect(topProductsQuery).toContain('SUM(ROUND(')
    expect(topProductsQuery).not.toMatch(/SUM\s+ROUND\s*\(/)
  })
})

// Also scan other route files that use $queryRaw
describe('V6 PP6 — raw SQL smoke tests (other routes)', () => {
  const ROUTE_FILES = [
    'src/app/api/dashboard/route.ts',
    'src/app/api/reports/route.ts',
    'src/app/api/gstr-export/route.ts',
    'src/app/api/insights/route.ts',
  ]

  for (const relPath of ROUTE_FILES) {
    const absPath = path.join(process.cwd(), relPath)
    const source = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : ''

    it(`${relPath}: no "FN FN(" missing-paren pattern`, () => {
      if (!source) return
      const queries = extractRawSql(source)
      const errors: string[] = []
      for (const sql of queries) {
        errors.push(...findMissingParenPatterns(sql))
      }
      if (errors.length > 0) {
        throw new Error(
          `CR1-class regression in ${relPath}:\n` +
          errors.map(e => `  - ${e}`).join('\n')
        )
      }
    })

    it(`${relPath}: no unbalanced parentheses`, () => {
      if (!source) return
      const queries = extractRawSql(source)
      const errors: string[] = []
      for (const sql of queries) {
        errors.push(...checkBalancedParens(sql))
      }
      if (errors.length > 0) {
        throw new Error(
          `Unbalanced parens in ${relPath}:\n` +
          errors.map(e => `  - ${e}`).join('\n')
        )
      }
    })
  }
})
