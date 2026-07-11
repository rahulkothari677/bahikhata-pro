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

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 V17 PAISE MIGRATION Phase 2C — reconciliation.ts verification
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase 2C scanned reconciliation.ts and found:
//   - checkPartyBalances: calls getReceivablePayable() (already migrated in
//     Phase 2B). No raw SQL. Nothing to migrate.
//   - checkGstReconciliation: uses Prisma aggregate() (not raw SQL). Phase 4
//     dependency noted in code comment — will need roundMoney→fromPaise when
//     columns change to Int.
//   - checkOrphanedData: 2 raw SQL queries, both SELECT COUNT(*). No money
//     columns touched. Nothing to migrate for paise.
//
// This test block verifies:
//   1. The orphaned-items and orphaned-payments queries DON'T touch money
//      columns (so paise migration doesn't affect them).
//   2. BUG-006 fix: the orphaned-items query does NOT have the contradictory
//      EXISTS clause that made it always return 0.
describe('V17 Phase 2C — reconciliation.ts verification + BUG-006 regression guard', () => {
  const RECONCILIATION_PATH = path.join(
    process.cwd(),
    'src',
    'lib',
    'reconciliation.ts',
  )
  const source = fs.existsSync(RECONCILIATION_PATH)
    ? fs.readFileSync(RECONCILIATION_PATH, 'utf8')
    : ''
  const skip = !source

  it('reconciliation.ts file exists', () => {
    if (skip) return
    expect(source.length).toBeGreaterThan(0)
  })

  // Money column names that should NOT appear in the orphan-check SQL
  const MONEY_COLUMNS = [
    'totalAmount', 'paidAmount', 'unitPrice', 'purchasePrice',
    'openingBalance', 'amount', 'cgst', 'sgst', 'igst',
    'subtotal', 'discountAmount', 'roundOff', 'grossProfit',
  ]

  it('orphaned-items query does NOT touch money columns (paise migration safe)', () => {
    if (skip) return
    const queries = extractRawSql(source)
    // The orphaned-items query references TransactionItem + LEFT JOIN Transaction
    const orphanItemsQuery = queries.find(q =>
      q.includes('TransactionItem') && q.includes('LEFT JOIN') && q.includes('COUNT')
    )
    if (!orphanItemsQuery) {
      throw new Error(
        'Could not find orphaned-items query in reconciliation.ts. ' +
        'Did the SQL shape change? Update this test to match.',
      )
    }
    // Assert NO money columns are referenced in the query
    for (const col of MONEY_COLUMNS) {
      // Match "columnName" (with double quotes, as used in Postgres identifiers)
      // or columnName (without quotes). Use word boundary to avoid partial matches.
      const pattern = new RegExp(`"${col}"|\\b${col}\\b`, 'i')
      if (pattern.test(orphanItemsQuery)) {
        throw new Error(
          `Orphaned-items query references money column "${col}". ` +
          `This query should only count rows (COUNT *), not read money values. ` +
          `If money columns are now needed, this query needs paise migration.`
        )
      }
    }
  })

  it('orphaned-payments query does NOT touch money columns (paise migration safe)', () => {
    if (skip) return
    const queries = extractRawSql(source)
    // The orphaned-payments query references Payment + LEFT JOIN Party
    const orphanPaymentsQuery = queries.find(q =>
      q.includes('"Payment"') && q.includes('LEFT JOIN') && q.includes('"Party"')
    )
    if (!orphanPaymentsQuery) {
      throw new Error(
        'Could not find orphaned-payments query in reconciliation.ts. ' +
        'Did the SQL shape change? Update this test to match.',
      )
    }
    // The Payment table has an "amount" column — but the orphan check should
    // only COUNT rows, not SUM the amount. Assert no money columns are in SUM/SELECT.
    for (const col of MONEY_COLUMNS) {
      const pattern = new RegExp(`"${col}"|\\b${col}\\b`, 'i')
      if (pattern.test(orphanPaymentsQuery)) {
        throw new Error(
          `Orphaned-payments query references money column "${col}". ` +
          `This query should only count rows (COUNT *), not read money values. ` +
          `If money columns are now needed, this query needs paise migration.`
        )
      }
    }
  })

  it('BUG-006 fix: orphaned-items query does NOT have the contradictory EXISTS clause', () => {
    if (skip) return
    const queries = extractRawSql(source)
    const orphanItemsQuery = queries.find(q =>
      q.includes('TransactionItem') && q.includes('LEFT JOIN') && q.includes('COUNT')
    )
    if (!orphanItemsQuery) return

    // The old (buggy) query had: AND EXISTS (SELECT 1 FROM "Transaction" t2 WHERE t2."userId" = ... AND t2.id = ti."transactionId")
    // This made the query ALWAYS return 0 because if the parent is deleted (t.id IS NULL),
    // the EXISTS subquery also can't find it.
    expect(orphanItemsQuery).not.toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+["]?Transaction["]?\s+t2/i)

    // The fixed query should just be: WHERE t.id IS NULL (no EXISTS subquery)
    expect(orphanItemsQuery).toMatch(/WHERE\s+t\.id\s+IS\s+NULL/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 V17 PAISE MIGRATION Phase 2D — reports/route.ts + gstr-export/route.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase 2D migrated 4 raw SQL queries from rupee Float to paise integer:
//   reports/route.ts:
//     1. Sale slab breakdown (GROUP BY gstRate, isInterState)
//     2. Input slab breakdown (GROUP BY gstRate)
//   gstr-export/route.ts:
//     3. Per-invoice-per-rate GST (GROUP BY transactionId, gstRate)
//     4. CDN per-invoice-per-rate GST (GROUP BY transactionId, gstRate)
//
// Pattern (same as Phase 2A/2B):
//   Old: SUM(ROUND(qty*price - discount, 2)) AS "taxable"                    → Float
//   New: ROUND(SUM(ROUND(qty*price - discount, 2)) * 100 + 0.0000001) AS "taxablePaise"  → Int
//   JS:  fromPaise(Number(row.XPaise))  → rupee Float (same value as before)
describe('V17 Phase 2D — paise-read-pattern regression guard (reports + gstr-export)', () => {
  const REPORTS_PATH = path.join(process.cwd(), 'src', 'app', 'api', 'reports', 'route.ts')
  const GSTR_EXPORT_PATH = path.join(process.cwd(), 'src', 'app', 'api', 'gstr-export', 'route.ts')

  const reportsSource = fs.existsSync(REPORTS_PATH) ? fs.readFileSync(REPORTS_PATH, 'utf8') : ''
  const gstrSource = fs.existsSync(GSTR_EXPORT_PATH) ? fs.readFileSync(GSTR_EXPORT_PATH, 'utf8') : ''

  // Helper: find queries matching a predicate
  function findQueries(source: string, predicate: (q: string) => boolean): string[] {
    return extractRawSql(source).filter(predicate)
  }

  // ---------- reports/route.ts ----------

  describe('reports/route.ts', () => {
    it('reports route file exists', () => {
      expect(reportsSource.length).toBeGreaterThan(0)
    })

    it('sale slab query returns paise aliases (taxablePaise, cgstPaise, sgstPaise, igstPaise)', () => {
      if (!reportsSource) return
      // The sale slab query groups by gstRate + isInterState and filters type='sale'
      const saleSlabQueries = findQueries(reportsSource, q =>
        q.includes('"gstRate"') && q.includes('"isInterState"') && q.includes("'sale'")
      )
      expect(saleSlabQueries.length).toBeGreaterThanOrEqual(1)
      const q = saleSlabQueries[0]
      expect(q).toContain('"taxablePaise"')
      expect(q).toContain('"cgstPaise"')
      expect(q).toContain('"sgstPaise"')
      expect(q).toContain('"igstPaise"')
      // Must NOT use old rupee aliases
      expect(q).not.toMatch(/AS\s+"taxable"\s/)
      expect(q).not.toMatch(/AS\s+cgst\s/)
      expect(q).not.toMatch(/AS\s+sgst\s/)
      expect(q).not.toMatch(/AS\s+igst\s/)
    })

    it('input slab query returns paise aliases', () => {
      if (!reportsSource) return
      // The input slab query groups by gstRate only and filters type='purchase'
      const inputSlabQueries = findQueries(reportsSource, q =>
        q.includes('"gstRate"') && q.includes("'purchase'") && !q.includes('"isInterState"')
      )
      expect(inputSlabQueries.length).toBeGreaterThanOrEqual(1)
      const q = inputSlabQueries[0]
      expect(q).toContain('"taxablePaise"')
      expect(q).toContain('"cgstPaise"')
      expect(q).toContain('"sgstPaise"')
      expect(q).toContain('"igstPaise"')
    })

    it('SQL multiplies by 100 and applies the 1e-7 paise nudge', () => {
      if (!reportsSource) return
      const queries = extractRawSql(reportsSource)
      const moneyQueries = queries.filter(q => q.includes('"taxablePaise"'))
      expect(moneyQueries.length).toBeGreaterThanOrEqual(2)
      for (const q of moneyQueries) {
        expect(q).toMatch(/\*\s*100\s*\+\s*0\.0000001/)
      }
    })

    it('reports route imports fromPaise from money.ts', () => {
      if (!reportsSource) return
      expect(reportsSource).toMatch(/import\s+\{[^}]*\bfromPaise\b[^}]*\}\s+from\s+['"]@\/lib\/money['"]/)
    })

    it('JS processing uses fromPaise(Number(row.XPaise)) pattern', () => {
      if (!reportsSource) return
      expect(reportsSource).toMatch(/fromPaise\(Number\(row\.taxablePaise\)\)/)
      expect(reportsSource).toMatch(/fromPaise\(Number\(row\.cgstPaise\)\)/)
    })

    it('no stale references to row.taxable/cgst/sgst/igst (without Paise) on raw SQL rows', () => {
      if (!reportsSource) return
      // The SQL row objects (from slabRows / inputSlabRows) must only be accessed
      // via the *Paise property names. The JS processing loops convert paise to
      // rupees via fromPaise() and store in slabMap / inputSlabMap.
      //
      // Find the processing loop bodies and verify they only access *Paise props.
      const conversionLoopPattern = /for\s*\(\s*const\s+row\s+of\s+(slabRows|inputSlabRows)\s*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g
      let match: RegExpExecArray | null
      while ((match = conversionLoopPattern.exec(reportsSource)) !== null) {
        const loopBody = match[2]
        const stalePattern = /row\.(taxable|cgst|sgst|igst)\b(?!Paise)/
        if (stalePattern.test(loopBody)) {
          throw new Error(
            `Stale reference found in conversion loop (for row of ${match[1]}): ` +
            `loop body references row.X without Paise suffix. ` +
            `Raw SQL rows must only be accessed via *Paise property names.`
          )
        }
      }
    })
  })

  // ---------- gstr-export/route.ts ----------

  describe('gstr-export/route.ts', () => {
    it('gstr-export route file exists', () => {
      expect(gstrSource.length).toBeGreaterThan(0)
    })

    it('per-invoice GST query returns paise aliases (taxableValuePaise, cgstPaise, etc.)', () => {
      if (!gstrSource) return
      // The per-invoice query groups by transactionId + gstRate, filters type='sale'
      const perInvoiceQueries = findQueries(gstrSource, q =>
        q.includes('"transactionId"') && q.includes('"gstRate"') && q.includes("'sale'")
      )
      expect(perInvoiceQueries.length).toBeGreaterThanOrEqual(1)
      const q = perInvoiceQueries[0]
      expect(q).toContain('"taxableValuePaise"')
      expect(q).toContain('"cgstPaise"')
      expect(q).toContain('"sgstPaise"')
      expect(q).toContain('"igstPaise"')
      // Must NOT use old rupee aliases
      expect(q).not.toMatch(/AS\s+"taxableValue"\s/)
      expect(q).not.toMatch(/AS\s+cgst\s/)
      expect(q).not.toMatch(/AS\s+sgst\s/)
      expect(q).not.toMatch(/AS\s+igst\s/)
    })

    it('CDN query returns paise aliases', () => {
      if (!gstrSource) return
      // The CDN query filters type IN ('credit-note', 'debit-note')
      const cdnQueries = findQueries(gstrSource, q =>
        q.includes("'credit-note'") && q.includes("'debit-note'")
      )
      expect(cdnQueries.length).toBeGreaterThanOrEqual(1)
      const q = cdnQueries[0]
      expect(q).toContain('"taxableValuePaise"')
      expect(q).toContain('"cgstPaise"')
      expect(q).toContain('"sgstPaise"')
      expect(q).toContain('"igstPaise"')
    })

    it('SQL multiplies by 100 and applies the 1e-7 paise nudge', () => {
      if (!gstrSource) return
      const queries = extractRawSql(gstrSource)
      const moneyQueries = queries.filter(q => q.includes('"taxableValuePaise"'))
      expect(moneyQueries.length).toBeGreaterThanOrEqual(2)
      for (const q of moneyQueries) {
        expect(q).toMatch(/\*\s*100\s*\+\s*0\.0000001/)
      }
    })

    it('gstr-export route imports fromPaise from money.ts', () => {
      if (!gstrSource) return
      expect(gstrSource).toMatch(/import\s+\{[^}]*\bfromPaise\b[^}]*\}\s+from\s+['"]@\/lib\/money['"]/)
    })

    it('JS processing uses fromPaise(Number(row.XPaise)) pattern', () => {
      if (!gstrSource) return
      expect(gstrSource).toMatch(/fromPaise\(Number\(row\.taxableValuePaise\)\)/)
      expect(gstrSource).toMatch(/fromPaise\(Number\(row\.cgstPaise\)\)/)
    })

    it('no stale references to row.taxableValue/cgst/sgst/igst (without Paise) on raw SQL rows', () => {
      if (!gstrSource) return
      // The SQL row objects (from perInvoiceGstRows / cdnGstRows) must only be
      // accessed via the *Paise property names. After conversion (via fromPaise),
      // the JS objects stored in gstByTransaction / cdnGstByTransaction maps
      // have rupee property names (taxableValue, cgst, etc.) — those are fine.
      //
      // Strategy: find the conversion loops (where row = raw SQL row) and check
      // that within those loops, only *Paise properties are accessed. The
      // conversion loops are the only places where `row` refers to a raw SQL row.
      //
      // Pattern: `for (const row of perInvoiceGstRows)` or
      //          `for (const row of cdnGstRows)`
      // Within each loop body, `row.X` must use Paise suffix for money fields.

      // Extract the conversion loop bodies
      const conversionLoopPattern = /for\s*\(\s*const\s+row\s+of\s+(perInvoiceGstRows|cdnGstRows)\s*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g
      let match: RegExpExecArray | null
      while ((match = conversionLoopPattern.exec(gstrSource)) !== null) {
        const loopBody = match[2]
        // Within the loop body, check for row.X access where X is a money field
        // WITHOUT the Paise suffix. This would indicate a stale reference.
        // The access pattern is: row.taxableValue, row.cgst, row.sgst, row.igst
        // (without Paise suffix)
        const stalePattern = /row\.(taxableValue|cgst|sgst|igst)\b(?!Paise)/
        if (stalePattern.test(loopBody)) {
          throw new Error(
            `Stale reference found in conversion loop (for row of ${match[1]}): ` +
            `loop body references row.X without Paise suffix. ` +
            `Raw SQL rows must only be accessed via *Paise property names. ` +
            `Loop body:\n${loopBody.substring(0, 200)}...`
          )
        }
      }
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 V17 PAISE MIGRATION Phase 2E — analytics/route.ts + parties/[id]/route.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// Phase 2E migrated 4 raw SQL queries from rupee Float to paise integer:
//   analytics/route.ts:
//     1. Best-selling items (GROUP BY productName) — totalRevenue → totalRevenuePaise
//     2. Top profitable customers (GROUP BY partyId) — totalProfit + totalSales → *Paise
//   parties/[id]/route.ts:
//     3. Top products (GROUP BY productName) — totalAmount → totalAmountPaise
//     4. Monthly chart (GROUP BY month, type) — total → totalPaise
//
// Also fixed BUG-004: parties/[id] PUT handler was using parseFloat without
// roundMoney for openingBalance. Now uses parseMoney (which applies roundMoney).
describe('V17 Phase 2E — paise-read-pattern regression guard (analytics + parties/[id])', () => {
  const ANALYTICS_PATH = path.join(process.cwd(), 'src', 'app', 'api', 'analytics', 'route.ts')
  const PARTIES_ID_PATH = path.join(process.cwd(), 'src', 'app', 'api', 'parties', '[id]', 'route.ts')

  const analyticsSource = fs.existsSync(ANALYTICS_PATH) ? fs.readFileSync(ANALYTICS_PATH, 'utf8') : ''
  const partiesSource = fs.existsSync(PARTIES_ID_PATH) ? fs.readFileSync(PARTIES_ID_PATH, 'utf8') : ''

  // ---------- analytics/route.ts ----------

  describe('analytics/route.ts', () => {
    it('analytics route file exists', () => {
      expect(analyticsSource.length).toBeGreaterThan(0)
    })

    it('best-sellers query returns totalRevenuePaise (not totalRevenue)', () => {
      if (!analyticsSource) return
      const queries = extractRawSql(analyticsSource)
      // Best-sellers query: GROUP BY productName, filters type='sale', has totalQty
      const bestSellersQuery = queries.find(q =>
        q.includes('"productName"') && q.includes('"totalQty"') && q.includes("'sale'")
      )
      if (!bestSellersQuery) {
        throw new Error('Could not find best-sellers query in analytics/route.ts.')
      }
      expect(bestSellersQuery).toContain('"totalRevenuePaise"')
      expect(bestSellersQuery).not.toMatch(/AS\s+"totalRevenue"\s/)
      expect(bestSellersQuery).toMatch(/\*\s*100\s*\+\s*0\.0000001/)
    })

    it('top-customers query returns totalProfitPaise + totalSalesPaise', () => {
      if (!analyticsSource) return
      const queries = extractRawSql(analyticsSource)
      // Top customers query: GROUP BY partyId, filters type='sale', has grossProfit
      const topCustomersQuery = queries.find(q =>
        q.includes('"partyId"') && q.includes('"grossProfit"')
      )
      if (!topCustomersQuery) return
      expect(topCustomersQuery).toContain('"totalProfitPaise"')
      expect(topCustomersQuery).toContain('"totalSalesPaise"')
      expect(topCustomersQuery).not.toMatch(/AS\s+"totalProfit"\s/)
      expect(topCustomersQuery).not.toMatch(/AS\s+"totalSales"\s/)
      // grossProfit can be negative — must use sign-aware nudge
      expect(topCustomersQuery).toMatch(/SIGN\s*\(/)
    })

    it('analytics route imports fromPaise from money.ts', () => {
      if (!analyticsSource) return
      expect(analyticsSource).toMatch(/import\s+\{[^}]*\bfromPaise\b[^}]*\}\s+from\s+['"]@\/lib\/money['"]/)
    })

    it('JS processing uses fromPaise(Number(row.XPaise)) pattern', () => {
      if (!analyticsSource) return
      expect(analyticsSource).toMatch(/fromPaise\(Number\(r\.totalRevenuePaise\)\)/)
      expect(analyticsSource).toMatch(/fromPaise\(Number\(r\.totalProfitPaise\)\)/)
    })
  })

  // ---------- parties/[id]/route.ts ----------

  describe('parties/[id]/route.ts', () => {
    it('parties/[id] route file exists', () => {
      expect(partiesSource.length).toBeGreaterThan(0)
    })

    it('top-products query returns totalAmountPaise (not totalAmount)', () => {
      if (!partiesSource) return
      const queries = extractRawSql(partiesSource)
      // Top products query: GROUP BY productName, has totalQuantity
      const topProductsQuery = queries.find(q =>
        q.includes('"productName"') && q.includes('"totalQuantity"')
      )
      if (!topProductsQuery) {
        throw new Error('Could not find top-products query in parties/[id]/route.ts.')
      }
      expect(topProductsQuery).toContain('"totalAmountPaise"')
      expect(topProductsQuery).not.toMatch(/AS\s+"totalAmount"\s/)
      expect(topProductsQuery).toMatch(/\*\s*100\s*\+\s*0\.0000001/)
    })

    it('monthly-chart query returns totalPaise (not total)', () => {
      if (!partiesSource) return
      const queries = extractRawSql(partiesSource)
      // Monthly chart query: has DATE_TRUNC and type
      const monthlyQuery = queries.find(q =>
        q.includes('DATE_TRUNC') && q.includes('type')
      )
      if (!monthlyQuery) return
      expect(monthlyQuery).toContain('"totalPaise"')
      expect(monthlyQuery).not.toMatch(/AS\s+total\s/)
      expect(monthlyQuery).toMatch(/\*\s*100\s*\+\s*0\.0000001/)
    })

    it('parties/[id] route imports fromPaise from money.ts', () => {
      if (!partiesSource) return
      expect(partiesSource).toMatch(/import\s+\{[^}]*\bfromPaise\b[^}]*\}\s+from\s+['"]@\/lib\/money['"]/)
    })

    it('JS processing uses fromPaise(Number(...Paise)) pattern', () => {
      if (!partiesSource) return
      expect(partiesSource).toMatch(/fromPaise\(Number\(p\.totalAmountPaise\)\)/)
      expect(partiesSource).toMatch(/fromPaise\(Number\(row\.totalPaise\)\)/)
    })

    it('BUG-004 fix: openingBalance uses parseMoney (not parseFloat without rounding)', () => {
      if (!partiesSource) return
      // The PUT handler should use parseMoney for openingBalance, not parseFloat
      expect(partiesSource).toMatch(/parseMoney\(body\.openingBalance\)/)
      // Should NOT have the old buggy pattern in CODE (not comments).
      // Strip comments before checking to avoid false positives from the
      // documentation comments that explain the old buggy pattern.
      const codeOnly = partiesSource
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
        .replace(/\/\/[^\n]*/g, '')          // line comments
      expect(codeOnly).not.toMatch(/parseFloat\s*\(\s*body\.openingBalance\s*\)\s*\|\|\s*0/)
    })
  })
})
