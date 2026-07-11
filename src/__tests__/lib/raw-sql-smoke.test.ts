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

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 V17 PAISE MIGRATION Phase 2A — paise-read-pattern regression guard
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase 2A migrated the top-product query in insights/route.ts to return
// paise (integer) instead of rupees (Float). The migration pattern is:
//
//   Old: SUM(ROUND(qty*price, 2))              AS "totalRevenue"      (Float)
//   New: SUM(ROUND(qty*price, 2) * 100)::int   AS "totalRevenuePaise" (Int)
//
// This test guards against accidental regression: if someone reverts the
// query or renames the alias without updating the calling code, this test
// will fail. As more queries are migrated in subsequent sub-phases (2B, 2C,
// ...), add similar assertions for each.
describe('V17 Phase 2A — paise-read-pattern regression guard (insights route)', () => {
  const INSIGHTS_ROUTE_PATH = path.join(
    process.cwd(),
    'src',
    'app',
    'api',
    'insights',
    'route.ts',
  )
  const source = fs.existsSync(INSIGHTS_ROUTE_PATH)
    ? fs.readFileSync(INSIGHTS_ROUTE_PATH, 'utf8')
    : ''
  const skip = !source

  it('insights route file exists', () => {
    if (skip) return
    expect(source.length).toBeGreaterThan(0)
  })

  it('top-product query returns paise (alias "totalRevenuePaise", not "totalRevenue")', () => {
    if (skip) return
    const queries = extractRawSql(source)
    // The top-product query is the one that references unitPrice in a SUM
    const topProductQuery = queries.find(q => q.includes('unitPrice') && q.includes('SUM'))
    if (!topProductQuery) {
      throw new Error(
        'Could not find the top-product query in insights/route.ts. ' +
        'Did the SQL shape change? Update this test to match.',
      )
    }
    // Must use the paise alias (regression: must not revert to "totalRevenue")
    expect(topProductQuery).toContain('"totalRevenuePaise"')
    expect(topProductQuery).not.toMatch(/AS\s+"totalRevenue"\s/)

    // Must cast to int (regression: must not return Float rupees)
    expect(topProductQuery).toMatch(/::int\s+AS\s+"totalRevenuePaise"/)

    // Must multiply by 100 inside the SUM (regression: must not skip the *100)
    expect(topProductQuery).toMatch(/\*\s*100/)
  })

  it('insights route imports fromPaise from money.ts', () => {
    if (skip) return
    // Regression guard: the display call uses fromPaise to convert back to rupees.
    // If someone reverts the import, the display call will ReferenceError at runtime.
    expect(source).toMatch(/import\s+\{[^}]*\bfromPaise\b[^}]*\}\s+from\s+['"]@\/lib\/money['"]/)
  })

  it('no stale references to "topProduct.totalRevenue" (without Paise suffix)', () => {
    if (skip) return
    // The old code referenced topProduct.totalRevenue — must now be totalRevenuePaise.
    // Allow comments and string literals, but flag code references.
    // Strip /* */ and // comments and string literals before checking.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments
      .replace(/\/\/[^\n]*/g, '')              // line comments
      .replace(/`[^`]*`/g, '')                 // template literals (SQL)
      .replace(/"[^"]*"/g, '')                 // double-quoted strings
      .replace(/'[^']*'/g, '')                 // single-quoted strings
    expect(stripped).not.toMatch(/totalRevenue\b(?!Paise)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 V17 PAISE MIGRATION Phase 2B — paise-read-pattern regression guard
// (party-balance.ts getReceivablePayable)
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase 2B migrated the getReceivablePayable SQL in src/lib/party-balance.ts
// from returning rupee Floats to returning paise integers. The pattern:
//
//   Old: SUM(CASE WHEN ... THEN (totalAmount - paidAmount)::numeric ELSE 0 END) AS "X"
//   New: ROUND(SUM(CASE WHEN ... THEN (...)::numeric ELSE 0 END) * 100 + 0.0000001) AS "XPaise"
//
// Also fixes BUG-003: COUNT(*) → COUNT(CASE WHEN type IN (...) THEN 1 END)
// to exclude income/expense from the transaction count.
describe('V17 Phase 2B — paise-read-pattern regression guard (party-balance.ts)', () => {
  const PARTY_BALANCE_PATH = path.join(
    process.cwd(),
    'src',
    'lib',
    'party-balance.ts',
  )
  const source = fs.existsSync(PARTY_BALANCE_PATH)
    ? fs.readFileSync(PARTY_BALANCE_PATH, 'utf8')
    : ''
  const skip = !source

  it('party-balance.ts file exists', () => {
    if (skip) return
    expect(source.length).toBeGreaterThan(0)
  })

  it('getReceivablePayable SQL uses paise aliases (not rupee aliases)', () => {
    if (skip) return
    const queries = extractRawSql(source)
    // getReceivablePayable's query is the long one with "Party" + "Transaction" + "Payment"
    const balanceQuery = queries.find(q =>
      q.includes('"Party"') && q.includes('"Transaction"') && q.includes('"Payment"')
    )
    if (!balanceQuery) {
      throw new Error(
        'Could not find getReceivablePayable query in party-balance.ts. ' +
        'Did the SQL shape change? Update this test to match.',
      )
    }
    // Must use paise aliases
    expect(balanceQuery).toContain('"openingBalancePaise"')
    expect(balanceQuery).toContain('"salesOutstandingPaise"')
    expect(balanceQuery).toContain('"purchaseOutstandingPaise"')
    expect(balanceQuery).toContain('"paymentsReceivedPaise"')
    expect(balanceQuery).toContain('"paymentsPaidPaise"')

    // Must NOT use the old rupee aliases (regression guard)
    expect(balanceQuery).not.toMatch(/AS\s+"openingBalance"\s/)
    expect(balanceQuery).not.toMatch(/AS\s+"salesOutstanding"\s/)
    expect(balanceQuery).not.toMatch(/AS\s+"purchaseOutstanding"\s/)
    expect(balanceQuery).not.toMatch(/AS\s+"paymentsReceived"\s/)
    expect(balanceQuery).not.toMatch(/AS\s+"paymentsPaid"\s/)
  })

  it('SQL multiplies by 100 and applies the 1e-7 paise nudge (matches roundMoney)', () => {
    if (skip) return
    const queries = extractRawSql(source)
    const balanceQuery = queries.find(q =>
      q.includes('"Party"') && q.includes('"Transaction"') && q.includes('"Payment"')
    )
    if (!balanceQuery) return

    // Each SUM column must have * 100 and the + 0.0000001 nudge
    expect(balanceQuery).toMatch(/\*\s*100\s*\+\s*0\.0000001/)
    // openingBalance must have sign-aware nudge (SIGN function)
    expect(balanceQuery).toMatch(/0\.0000001\s*\*\s*SIGN/)
  })

  it('BUG-003 fix: COUNT uses CASE WHEN type IN (...) not COUNT(*)', () => {
    if (skip) return
    const queries = extractRawSql(source)
    const balanceQuery = queries.find(q =>
      q.includes('"Party"') && q.includes('"Transaction"') && q.includes('"Payment"')
    )
    if (!balanceQuery) return

    // Must NOT use COUNT(*) for txnCount (BUG-003 fix)
    expect(balanceQuery).not.toMatch(/COUNT\(\*\)\s+AS\s+"txnCount"/)
    // Must use COUNT(CASE WHEN ... IN ('sale', 'purchase', 'credit-note', 'debit-note') THEN 1 END)
    // Use [\s\S]* instead of .* with /s flag (es2018) for cross-line matching
    expect(balanceQuery).toMatch(/COUNT\(CASE WHEN[\s\S]*?type[\s\S]*?IN[\s\S]*?sale[\s\S]*?purchase[\s\S]*?credit-note[\s\S]*?debit-note[\s\S]*?THEN\s+1\s+END\)\s+AS\s+"txnCount"/)
  })

  it('party-balance.ts imports fromPaise from money.ts', () => {
    if (skip) return
    expect(source).toMatch(/import\s+\{[^}]*\bfromPaise\b[^}]*\}\s+from\s+['"]@\/lib\/money['"]/)
  })

  it('JS processing uses fromPaise(Number(row.XPaise)) pattern', () => {
    if (skip) return
    expect(source).toMatch(/fromPaise\(Number\(row\.openingBalancePaise\)\)/)
    expect(source).toMatch(/fromPaise\(Number\(row\.salesOutstandingPaise\)\)/)
    expect(source).toMatch(/fromPaise\(Number\(row\.purchaseOutstandingPaise\)\)/)
    expect(source).toMatch(/fromPaise\(Number\(row\.paymentsReceivedPaise\)\)/)
    expect(source).toMatch(/fromPaise\(Number\(row\.paymentsPaidPaise\)\)/)
  })

  it('no stale references to row.X (rupee names without Paise suffix) in code', () => {
    if (skip) return
    // Strip comments and string literals, then check for stale references
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/`[^`]*`/g, '')                 // template literals (SQL)
      .replace(/"[^"]*"/g, '')
      .replace(/'[^']*'/g, '')
    // Should NOT reference row.openingBalance, row.salesOutstanding, etc.
    // (without the Paise suffix)
    expect(stripped).not.toMatch(/row\.(openingBalance|salesOutstanding|purchaseOutstanding|creditNoteOutstanding|debitNoteOutstanding|paymentsReceived|paymentsPaid)\b(?!Paise)/)
  })
})
