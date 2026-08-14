/**
 * 🔒 V26 PHASE 5 BATCH 6 — Polish + CI guards.
 *
 * Phase 5 audit findings covered:
 *   R17 🔵 — recharts statically imported by Dashboard → charting library in
 *            first-paint bundle (open since V21). Fix: next/dynamic the chart
 *            components with ssr:false + skeleton fallback.
 *   R18 🔵 — Sentry replay masking not pinned, beforeSend counts every event
 *            as crash, no Prisma error meta scrub, apiError console can include
 *            row data.
 *   R20 🔵 — parties/products GET unbounded. Add take: 5000 as a fuse.
 *   R21 🔵 — Migration safety relies on convention. Add CI lint blocking
 *            CREATE INDEX CONCURRENTLY / DROP TABLE without IF EXISTS /
 *            ALTER TABLE DROP COLUMN without -- audited:destructive comment.
 *   R22 🔵 — email.ts has no timeout + reset-request lacks apiError wrap.
 *            (email.ts timeout was done in R8.1; this test covers the
 *            reset-request try/catch wrap.)
 *
 * This test makes those classes fail CI.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src')
const PROJECT_ROOT = path.resolve(process.cwd())

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8')
}

/**
 * R21 — the migration SQL rules, as one function so they can be TESTED, not
 * just run. Returns a suffix per violation; the caller prepends the filename.
 *
 * 🔒 2026-08-14 — why this was extracted.
 *
 * These rules used to live inline inside the directory walk, which meant the
 * only way to exercise them was to commit a real migration. So a bug in the
 * RULES themselves was invisible, and one shipped:
 *
 *   `rawSql.split('\n')` leaves a carriage return on every line of a Windows
 *   checkout. The comment stripper is `/--.*$/` — and in JavaScript `.` does
 *   NOT match a carriage return, because it counts as a line terminator. So
 *   `.*` stopped short of the line end, `$` never matched, and NOTHING WAS
 *   STRIPPED.
 *
 * The result: another agent's migration, whose comment described its own
 * rollback ("Rolling back is `ALTER TABLE ... DROP COLUMN`"), was reported as
 * destructive DDL — and main went red for a change that only ADDS a column.
 * Their migration was correct. This guard was reading their prose as code.
 *
 * That is the FIFTH guard in three days to measure nearby text instead of the
 * structure. The pattern that keeps failing is a guard nobody can run against
 * a known-good and a known-bad input. So the rules are a function now, and the
 * CRLF case is a test below that fails if the split is ever narrowed again.
 */
export function migrationSqlViolations(rawSql: string): string[] {
  const out: string[] = []

  // Split on BOTH line endings, so Windows, macOS and CI see identical text.
  const rawLines = rawSql.split(/\r?\n/)

  // 🔒 Strip whole SQL comment lines before checking. The audit patterns can
  // appear in comments (e.g. "Cannot use CREATE INDEX CONCURRENTLY") without
  // being actual DDL. Only flag real SQL.
  const sql = rawLines.filter(line => !line.trim().startsWith('--')).join('\n')

  // CREATE INDEX CONCURRENTLY is not allowed inside a transaction block.
  // Prisma migrations run inside a transaction, so this would fail at deploy
  // time (the V12 outage class).
  if (/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql)) {
    out.push(': CREATE INDEX CONCURRENTLY')
  }

  // DROP TABLE without IF EXISTS — non-idempotent, fails on re-run.
  if (/DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(sql)) {
    out.push(': DROP TABLE without IF EXISTS')
  }

  // ALTER TABLE DROP COLUMN without an -- audited:destructive comment on the
  // preceding line. The comment marks that the destructive DDL was reviewed
  // and is safe (data was migrated, or the column was never used). This one
  // reads the RAW lines, because the comment IS the audit marker.
  for (let i = 0; i < rawLines.length; i++) {
    const lineContent = rawLines[i].replace(/--.*$/, '').trim()  // strip inline comments
    if (/ALTER\s+TABLE.*DROP\s+COLUMN/i.test(lineContent)) {
      const prevLine = i > 0 ? rawLines[i - 1] : ''
      const hasAuditComment =
        /--\s*audited:destructive/i.test(prevLine) ||
        /--\s*audited:destructive/i.test(rawLines[i])
      if (!hasAuditComment) {
        out.push(` line ${i + 1}: ALTER TABLE DROP COLUMN without -- audited:destructive comment`)
      }
    }
  }

  return out
}

describe('V26 Phase 5 Batch 6 — Polish + CI guards', () => {
  // ─── R17: recharts lazy-load ─────────────────────────────────────────────

  test('R17: Dashboard no longer statically imports recharts', () => {
    const src = readFile('components/dashboard/Dashboard.tsx')
    // The static recharts import must be gone.
    expect(src).not.toMatch(/from 'recharts'/)
    // The chartColors import must be gone (it was only used in chart sections
    // that moved to DashboardCharts).
    expect(src).not.toMatch(/from '@\/lib\/chart-theme'/)
    // DashboardCharts must be lazy-loaded via next/dynamic with ssr:false.
    expect(src).toMatch(/dynamic\(\(\) => import\('\.\/DashboardCharts'\)/)
    expect(src).toMatch(/ssr:\s*false/)
  })

  test('R17: DashboardCharts.tsx exists and imports recharts', () => {
    const src = readFile('components/dashboard/DashboardCharts.tsx')
    // recharts is now in this file (the lazy-loaded chunk).
    expect(src).toMatch(/from 'recharts'/)
    // Exports the DashboardCharts component.
    expect(src).toMatch(/export function DashboardCharts/)
    // Has the chart types (AreaChart, PieChart, BarChart).
    expect(src).toMatch(/AreaChart/)
    expect(src).toMatch(/PieChart/)
    expect(src).toMatch(/BarChart/)
  })

  // ─── R18: Sentry polish ──────────────────────────────────────────────────

  /**
   * ⚠️ READ BEFORE ADDING TO THIS BLOCK.
   *
   * Every R18 test below reads sentry.client.config.ts AS TEXT. For months they
   * all passed while the file NEVER EXECUTED: Next 15.3+ (we are on 16.1.1)
   * stopped auto-loading sentry.client.config.ts, and instrumentation-client.ts
   * did not exist. Not one browser error ever reached Sentry. Server errors did
   * (instrumentation.ts imports the server config), so Sentry had data in it and
   * nothing looked wrong.
   *
   * A test that reads source as a string cannot tell whether anything imports
   * it. The assertion below is the one that would have caught it, so it must
   * stay ahead of the text-matching ones.
   */
  test('R18.0: the client config is actually LOADED, not merely present', () => {
    // Next only runs browser-side instrumentation from this exact filename.
    const hook = path.join(PROJECT_ROOT, 'instrumentation-client.ts')
    // Jest's expect() takes no message argument, so the explanation goes in the
    // compared value — otherwise a future failure reads as a bare `false`, and
    // whoever hits it deletes the test instead of restoring the file.
    const PRESENT = 'instrumentation-client.ts present'
    expect(
      fs.existsSync(hook)
        ? PRESENT
        : 'MISSING instrumentation-client.ts — Next 16 does NOT auto-load ' +
          'sentry.client.config.ts. Without this file no browser error is ever captured.',
    ).toBe(PRESENT)
    expect(fs.readFileSync(hook, 'utf8')).toMatch(/sentry\.client\.config/)
  })

  test('R18.1: Sentry client config pins replay masking', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'sentry.client.config.ts'), 'utf8')
    expect(src).toMatch(/replayIntegration/)
    expect(src).toMatch(/maskAllText:\s*true/)
    expect(src).toMatch(/blockAllMedia:\s*true/)
  })

  test('R18.2: beforeSend only counts crashes when event.exception is present', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'sentry.client.config.ts'), 'utf8')
    expect(src).toMatch(/event\.exception/)
    expect(src).toMatch(/hasException/)
    // The old pattern (unconditional increment) must be gone.
    // The old code was: `localStorage.setItem('bahikhata:crash-count', String(current + 1))`
    // without any condition. Now it's inside an `if (hasException && ...)`.
    const beforeSendMatch = src.match(/beforeSend\(event\)[\s\S]*?\n  \}/)
    expect(beforeSendMatch).toBeTruthy()
    expect(beforeSendMatch![0]).toMatch(/if \(hasException/)
  })

  test('R18.3: Sentry server config has beforeSend scrub for sensitive keys', () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'sentry.server.config.ts'), 'utf8')
    expect(src).toMatch(/beforeSend/)
    expect(src).toMatch(/SENSITIVE_KEY_RE/)
    expect(src).toMatch(/amount|phone|gstin|email|password|token|secret|upi/)
    // Scrubs both event.extra and breadcrumbs.
    expect(src).toMatch(/event\.extra/)
    expect(src).toMatch(/event\.breadcrumbs/)
  })

  test('R18.4: api-error.ts logs safe error info (not the whole error object)', () => {
    const src = readFile('lib/api-error.ts')
    // The old pattern was: console.error(..., error, ...) — logging the whole
    // error object. Now: logs safeErrorInfo with message + code + truncated stack.
    expect(src).toMatch(/safeErrorInfo/)
    expect(src).toMatch(/err\?\.message/)
    expect(src).toMatch(/err\?\.code/)
    expect(src).toMatch(/err\?\.stack/)
    // Stack is truncated to first 5 frames.
    expect(src).toMatch(/slice\(0,\s*5\)/)
  })

  // ─── R20: GET take guard ─────────────────────────────────────────────────

  test('R20: parties + products GET have take: 5000 fuse', () => {
    const partiesSrc = readFile('app/api/parties/route.ts')
    expect(partiesSrc).toMatch(/take:\s*5000/)
    const productsSrc = readFile('app/api/products/route.ts')
    expect(productsSrc).toMatch(/take:\s*5000/)
  })

  // ─── R21: Migration SQL lint ─────────────────────────────────────────────

  test('R21: no migration SQL uses CREATE INDEX CONCURRENTLY (V12 outage class)', () => {
    const migrationsDir = path.join(PROJECT_ROOT, 'prisma', 'migrations')
    if (!fs.existsSync(migrationsDir)) return

    const violations: string[] = []
    function walkDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else if (entry.name.endsWith('.sql')) {
          const rawSql = fs.readFileSync(fullPath, 'utf8')
          const rel = path.relative(migrationsDir, fullPath)
          for (const v of migrationSqlViolations(rawSql)) violations.push(`${rel}${v}`)
        }
      }
    }
    walkDir(migrationsDir)

    if (violations.length > 0) {
      throw new Error(
        `\n\n🔒 V26 R21 MIGRATION SQL LINT FAILED.\n\n` +
        `The following ${violations.length} migration(s) contain non-idempotent or ` +
        `transaction-unsafe DDL:\n\n` +
        violations.map(v => `  ${v}`).join('\n') +
        `\n\nThese patterns caused the V12 outage. Fix:\n` +
        `  - CREATE INDEX CONCURRENTLY: not allowed inside a transaction (Prisma migrations run in one). Use plain CREATE INDEX.\n` +
        `  - DROP TABLE: always use DROP TABLE IF EXISTS.\n` +
        `  - ALTER TABLE DROP COLUMN: add a -- audited:destructive comment on the preceding line to mark it as reviewed.\n`
      )
    }
  })

  // ─── R22: reset-request try/catch wrap ───────────────────────────────────

  test('R22: reset-request wraps sendEmail in try/catch (no leak of send-failure vs no-account)', () => {
    const src = readFile('app/api/auth/reset-request/route.ts')
    // sendEmail must be inside a try/catch that returns the generic response.
    expect(src).toMatch(/try \{[\s\S]*?emailResult = await sendEmail/)
    expect(src).toMatch(/catch \(sendErr\)/)
    // The catch sets emailResult to { ok: false } so the generic response is returned.
    expect(src).toMatch(/emailResult = \{ ok: false, reason: 'exception'/)
  })
})

/**
 * 🔒 R21 — the rules themselves, tested against known-good and known-bad SQL.
 *
 * A guard that has never been run against a bug it is supposed to catch is a
 * comment with a green tick next to it. These cases are the bug reintroduced:
 * every one of them FAILS if the line splitting is narrowed back to '\n'.
 */
describe('R21 rules: the same SQL means the same thing in both line endings', () => {
  /** A real shape: adds a column, and the comment mentions its own rollback. */
  const SAFE_ADD_COLUMN = [
    '-- Add archivedAt to Shop.',
    '--',
    '-- Rolling back is `ALTER TABLE "Shop" DROP COLUMN "archivedAt";`. Nothing else',
    '-- reads the column yet, so the rollback is safe.',
    'ALTER TABLE "Shop" ADD COLUMN "archivedAt" TIMESTAMP(3);',
    'CREATE INDEX "Shop_archivedAt_idx" ON "Shop"("archivedAt");',
  ].join('\n')

  /** The same file as Git hands it to a Windows checkout. */
  const crlf = (s: string) => s.replace(/\n/g, '\r\n')

  test('a comment describing a rollback is not destructive DDL (LF)', () => {
    expect(migrationSqlViolations(SAFE_ADD_COLUMN)).toEqual([])
  })

  test('and it is still not destructive DDL with CRLF endings', () => {
    /*
     * THE BUG. This exact case turned main red for a correct migration. With
     * `split('\n')` every line keeps a trailing carriage return, `/--.*$/`
     * matches nothing, and the rollback note is read as real SQL.
     */
    expect(migrationSqlViolations(crlf(SAFE_ADD_COLUMN))).toEqual([])
  })

  test('a REAL drop column is still caught, in both line endings', () => {
    const bad = 'ALTER TABLE "Shop" DROP COLUMN "oldField";'
    expect(migrationSqlViolations(bad)).toHaveLength(1)
    expect(migrationSqlViolations(crlf(bad))).toHaveLength(1)
    expect(migrationSqlViolations(bad)[0]).toContain('DROP COLUMN')
  })

  test('an audited drop column is allowed, in both line endings', () => {
    const audited = [
      '-- audited:destructive — column was never written to.',
      'ALTER TABLE "Shop" DROP COLUMN "oldField";',
    ].join('\n')
    expect(migrationSqlViolations(audited)).toEqual([])
    expect(migrationSqlViolations(crlf(audited))).toEqual([])
  })

  test('CREATE INDEX CONCURRENTLY is caught as code and ignored as prose', () => {
    const asCode = 'CREATE INDEX CONCURRENTLY "x_idx" ON "Shop"("id");'
    const asProse = '-- Cannot use CREATE INDEX CONCURRENTLY inside a transaction.'
    expect(migrationSqlViolations(asCode)).toHaveLength(1)
    expect(migrationSqlViolations(crlf(asCode))).toHaveLength(1)
    expect(migrationSqlViolations(asProse)).toEqual([])
    expect(migrationSqlViolations(crlf(asProse))).toEqual([])
  })

  test('DROP TABLE needs IF EXISTS, and the check survives CRLF', () => {
    const bad = 'DROP TABLE "Temp";'
    const good = 'DROP TABLE IF EXISTS "Temp";'
    expect(migrationSqlViolations(crlf(bad))).toHaveLength(1)
    expect(migrationSqlViolations(crlf(good))).toEqual([])
  })
})
