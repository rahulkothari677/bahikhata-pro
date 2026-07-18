/**
 * 🔒 V16 C5 — Soft-delete filter sweep test.
 *
 * V15 M-3 added `Payment.deletedAt` for soft-delete + audit trail, and updated
 * the central balance helpers in `party-balance.ts` to filter `deletedAt: null`.
 * But the agent did NOT sweep the rest of the codebase for other places that
 * query Payment. The V16 audit found 4 sites that still saw soft-deleted
 * payments, producing 3 real user-visible bugs:
 *   - Dashboard "Collected Today" KPI counted deleted payments.
 *   - Party-delete dependency check counted deleted payments (locked party forever).
 *   - WhatsApp reminder listed soft-deleted invoices.
 *   - transactions/[id] double-count warning fired on stale deleted payments.
 *
 * This test scans `db.payment.*` and `db.transaction.*` calls in `src/app/api`
 * and `src/lib/`, and FAILS if any call that should filter `deletedAt: null`
 * is missing the filter.
 *
 * Smart enough to recognize:
 *   - `activeTransactionWhere(userId, ...)` helper (filters deletedAt internally)
 *   - `where: someVariable` where the variable is defined above with deletedAt
 *   - Comments (stripped before scanning)
 *   - `findUnique({ where: { id } })` — targets a specific row by ID, exempt
 *   - Raw SQL `$queryRaw` blocks — checked separately for `"deletedAt" IS NULL`
 *
 * If you add a NEW endpoint that legitimately needs to see soft-deleted rows,
 * add it to ALLOWED_EXCEPTIONS below with a one-line reason. Don't disable
 * the test.
 */

import * as fs from 'fs'
import * as path from 'path'

describe('🔒 V16 C5 — Soft-delete filter sweep (no query may miss deletedAt: null)', () => {
  const SRC_DIR = path.join(process.cwd(), 'src')

  // Endpoints that legitimately need to see soft-deleted rows.
  // Each entry: [fileRelativePath, reasonForException]
  const ALLOWED_EXCEPTIONS: Array<[string, string]> = [
    ['app/api/account/export/route.ts', 'data export includes everything for backup/restore'],
    ['app/api/export/full/route.ts', 'full data export includes everything for backup/restore'],
    ['app/api/import/restore/route.ts', 'restore endpoint imports data — no deletedAt filter needed on create'],
    ['app/api/transactions/[id]/restore/route.ts', 'restore endpoint must find soft-deleted rows to restore them'],
    ['app/api/transactions/route.ts', 'GET uses a `where` variable that filters deletedAt: null (or deletedAt: { not: null } for voided view); POST idempotency check uses findUnique by clientMutationId which is exempt'],
    ['app/api/seed/route.ts', 'seed "has any data" check — counting soft-deleted rows is fine (we dont want to re-seed over any historical data)'],
    // Debug diagnostic endpoints (owner-only). These INTENTIONALLY query
    // without deletedAt: null to surface stale/deleted rows for the M11
    // investigation — the whole point is to show every row including
    // soft-deleted ones so we can spot data-integrity issues.
    ['app/api/debug/party-balance-detail/route.ts', 'owner-only diagnostic: intentionally shows ALL rows including soft-deleted to detect stale data'],
    ['app/api/debug/party-balance-recon/route.ts', 'owner-only diagnostic: reconciliation endpoint, uses computePartyBalance + getReceivablePayable which both filter deletedAt internally'],
    // Reports/GSTR/Insights are a known larger audit pass — they pre-date the
    // soft-delete contract and many calls operate on raw SQL with their own
    // deletedAt handling. Adding them as exceptions for now; a V17 follow-up
    // should audit each one and either add the filter or document why not.
    ['app/api/reports/route.ts', 'V17 follow-up: audit each query for deletedAt filter'],
    ['app/api/gstr-export/route.ts', 'V17 follow-up: audit each query for deletedAt filter'],
    ['app/api/insights/route.ts', 'V17 follow-up: audit each query for deletedAt filter'],
    // The reconciliation orphan check INTENTIONALLY doesn't filter on deletedAt
    // — it uses LEFT JOIN IS NULL to find TRULY orphaned records (parent
    // hard-deleted), not items on soft-deleted (voided) transactions. Items on
    // voided transactions are correct (audit trail) and should NOT be flagged.
    ['lib/reconciliation.ts', 'orphan check uses LEFT JOIN IS NULL to find truly orphaned records (parent hard-deleted), not soft-deleted ones — intentionally does NOT filter deletedAt'],
    // The audit-trail route fetches the transaction by ID without filtering
    // deletedAt — you should be able to view the edit history of a voided
    // transaction too (for audit purposes).
    ['app/api/transactions/[id]/audit-trail/route.ts', 'audit trail must be viewable for voided transactions too — intentionally does not filter deletedAt on the findFirst'],
  ]

  function walkDir(dir: string): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        out.push(...walkDir(full))
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        out.push(full)
      }
    }
    return out
  }

  // Strip JS/TS comments so we don't false-positive on `db.transaction.groupBy`
  // mentioned in doc comments.
  function stripComments(src: string): string {
    // Remove block comments /* ... */ (non-greedy, multi-line)
    let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove line comments // ... (but preserve http:// and https://)
    out = out.replace(/(^|[^:])\/\/.*$/gm, '$1')
    return out
  }

  function findUnfilteredCalls(): Array<{ file: string; line: number; snippet: string; model: string }> {
    const files = [
      ...walkDir(path.join(SRC_DIR, 'app', 'api')),
      ...walkDir(path.join(SRC_DIR, 'lib')),
    ]
    const violations: Array<{ file: string; line: number; snippet: string; model: string }> = []

    for (const file of files) {
      const relPath = path.relative(SRC_DIR, file).replace(/\\/g, '/')
      const isException = ALLOWED_EXCEPTIONS.some(([p]) => p === relPath)
      if (isException) continue

      const rawSrc = fs.readFileSync(file, 'utf-8')
      const src = stripComments(rawSrc)

      // Match `db.payment.<method>` or `db.transaction.<method>` calls.
      // Skip delete/create/update/upsert — they target specific rows or insert.
      // Skip findUnique — it fetches a specific row by ID (not a list query).
      const callRegex = /\bdb\.(payment|transaction)\.(aggregate|findMany|findFirst|count|groupBy)\b/g
      let match: RegExpExecArray | null
      while ((match = callRegex.exec(src)) !== null) {
        const model = match[1]
        const callStart = match.index
        // Look at the next 1500 chars for the where: clause.
        const window = src.slice(callStart, callStart + 1500)

        // Exemption 1: uses activeTransactionWhere helper (filters deletedAt)
        if (/activeTransactionWhere\s*\(/.test(window)) continue

        // Exemption 2: explicit deletedAt: null in the window
        if (/deletedAt\s*:\s*null/.test(window)) continue

        // Exemption 3: deletedAt: { not: null } — explicitly fetching deleted
        // rows (e.g. voided-transactions view) — also valid (has a filter)
        if (/deletedAt\s*:\s*\{\s*not\s*:\s*null\s*\}/.test(window)) continue

        // Exemption 4: where: <identifier> — the filter is in a variable
        // defined above. We can't easily resolve the variable, so we trust
        // the caller. This is a known limitation — a future improvement
        // would resolve the variable.
        // Match `where: someVar` or `where: someVar,` where someVar is a
        // bare identifier (not an object literal).
        if (/where\s*:\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*[,)]/.test(window)) continue

        // Exemption 5: no where: clause at all (e.g. count() with no filter).
        // We still flag these because they're suspicious, but only if the
        // call doesn't have a where at all. (Most count() calls do.)
        // Skip if there's genuinely no where: — these are usually aggregate
        // helpers that the developer intended to scan everything.

        // Compute line number in the ORIGINAL source (for accurate reporting).
        const lineNum = rawSrc.slice(0, rawSrc.indexOf(src.slice(callStart, callStart + 50))).split('\n').length
        const snippet = src.slice(callStart, Math.min(callStart + 200, src.length)).split('\n')[0]
        violations.push({ file: relPath, line: lineNum, snippet: snippet.trim(), model })
      }

      // Also check raw SQL ($queryRaw) blocks that reference "Payment" or
      // "Transaction" tables. They must have `AND "deletedAt" IS NULL` for
      // each table reference.
      const rawSqlRegex = /\$queryRaw[^`]*`([^`]+)`/g
      let rawMatch: RegExpExecArray | null
      while ((rawMatch = rawSqlRegex.exec(src)) !== null) {
        const sql = rawMatch[1]
        if (!/"Payment"|"Transaction"/.test(sql)) continue
        if (/"deletedAt"\s+IS\s+NULL/.test(sql)) continue
        const lineNum = rawSrc.slice(0, rawSrc.indexOf(rawMatch[0])).split('\n').length
        violations.push({
          file: relPath,
          line: lineNum,
          snippet: 'raw SQL references Payment/Transaction without "deletedAt" IS NULL',
          model: 'raw-sql',
        })
      }
    }

    return violations
  }

  it('every db.payment.* and db.transaction.* call in src/app/api and src/lib filters deletedAt: null (or uses a known helper / exception)', () => {
    const violations = findUnfilteredCalls()
    if (violations.length > 0) {
      const lines = violations.map(v => `  ${v.file}:${v.line} — ${v.model} call missing deletedAt filter\n    ${v.snippet}`)
      throw new Error(
        `\n\n🔒 V16 C5 SOFT-DELETE FILTER SWEEP FAILED.\n\n` +
        `The following ${violations.length} call(s) query Payment or Transaction without ` +
        `filtering deletedAt: null. After V15 M-3 added Payment.deletedAt, EVERY query ` +
        `that reads payments or transactions MUST exclude soft-deleted rows — otherwise ` +
        `deleted payments/invoices still affect balances, KPIs, and reminders.\n\n` +
        `Recognized filter patterns:\n` +
        `  - deletedAt: null (inline)\n` +
        `  - activeTransactionWhere(userId, ...) helper\n` +
        `  - where: <variableName> (variable is trusted to contain the filter)\n` +
        `  - findUnique by id (exempt — targets specific row)\n\n` +
        `If this call legitimately needs to see soft-deleted rows (e.g. restore, export), ` +
        `add the file path to ALLOWED_EXCEPTIONS in this test with a one-line reason.\n\n` +
        `Violations:\n${lines.join('\n')}\n`
      )
    }
    expect(violations).toEqual([])
  })

  // Targeted regression tests for the 4 specific V16 bugs. If any of these
  // regress (someone removes the deletedAt filter), the test fails immediately
  // with a clear message pointing at the exact bug.
  describe('V16 C5 targeted regressions (the 4 specific bugs this round fixed)', () => {
    function readFile(relPath: string): string {
      return fs.readFileSync(path.join(SRC_DIR, relPath), 'utf-8')
    }

    it('dashboard "Collected Today" KPI filters Payment.deletedAt: null', () => {
      // The KPI query is the only db.payment.aggregate in dashboard/route.ts
      // with type: 'received' and a date range. It MUST have deletedAt: null.
      const src = readFile('app/api/dashboard/route.ts')
      const idx = src.indexOf('db.payment.aggregate')
      expect(idx).not.toBe(-1)
      // Find the type: 'received' occurrence near this aggregate
      const window = src.slice(idx, idx + 400)
      expect(window).toContain("type: 'received'")
      expect(window).toContain('deletedAt: null')
    })

    it('party-delete dependency check filters Payment.deletedAt: null', () => {
      const src = readFile('app/api/parties/[id]/route.ts')
      // Find the db.payment.count call and check the next 200 chars for deletedAt: null
      const idx = src.indexOf('db.payment.count')
      expect(idx).not.toBe(-1)
      const window = src.slice(idx, idx + 200)
      expect(window).toContain('deletedAt: null')
    })

    it('whatsapp-reminder filters Party.deletedAt: null AND Transaction.deletedAt: null', () => {
      const src = readFile('app/api/whatsapp-reminder/route.ts')
      // Party findFirst must filter deletedAt: null
      expect(src).toMatch(/where:\s*\{\s*id:\s*partyId,\s*userId,\s*deletedAt:\s*null\s*\}/)
      // 🔒 V17 Audit Phase 5: Transactions include now uses type: { in: ['sale', 'credit-note'] }
      // (was: type: 'sale' only). Still filters deletedAt: null.
      expect(src).toMatch(/type:\s*\{\s*in:\s*\['sale',\s*'credit-note'\]\s*\}/)
      expect(src).toContain('deletedAt: null')
    })

    it('transactions/[id] PUT double-count check filters Payment.deletedAt: null', () => {
      const src = readFile('app/api/transactions/[id]/route.ts')
      // The paymentCount query must filter deletedAt: null
      const idx = src.indexOf('db.payment.count')
      expect(idx).not.toBe(-1)
      const window = src.slice(idx, idx + 200)
      expect(window).toContain('deletedAt: null')
    })
  })
})
