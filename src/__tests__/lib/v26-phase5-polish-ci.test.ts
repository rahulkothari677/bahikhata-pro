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
          // 🔒 Strip SQL comments (-- lines) before checking. The audit
          // patterns can appear in comments (e.g. "Cannot use CREATE INDEX
          // CONCURRENTLY") without being actual DDL. Only flag real SQL.
          const sql = rawSql
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n')

          // CREATE INDEX CONCURRENTLY is not allowed inside a transaction block.
          // Prisma migrations run inside a transaction, so this would fail at
          // deploy time (the V12 outage class).
          if (/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql)) {
            violations.push(`${path.relative(migrationsDir, fullPath)}: CREATE INDEX CONCURRENTLY`)
          }
          // DROP TABLE without IF EXISTS — non-idempotent, fails on re-run.
          if (/DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(sql)) {
            violations.push(`${path.relative(migrationsDir, fullPath)}: DROP TABLE without IF EXISTS`)
          }
          // ALTER TABLE DROP COLUMN without -- audited:destructive comment on
          // the preceding line. The comment marks that the destructive DDL was
          // reviewed and is safe (data was migrated or column was never used).
          // Check the RAW sql (with comments) for this one — the comment is
          // the audit marker.
          const rawLines = rawSql.split('\n')
          for (let i = 0; i < rawLines.length; i++) {
            const lineContent = rawLines[i].replace(/--.*$/, '').trim()  // strip inline comments
            if (/ALTER\s+TABLE.*DROP\s+COLUMN/i.test(lineContent)) {
              // Check if the preceding line (or same line) has the audit comment.
              const prevLine = i > 0 ? rawLines[i - 1] : ''
              const hasAuditComment = /--\s*audited:destructive/i.test(prevLine) || /--\s*audited:destructive/i.test(rawLines[i])
              if (!hasAuditComment) {
                violations.push(`${path.relative(migrationsDir, fullPath)} line ${i + 1}: ALTER TABLE DROP COLUMN without -- audited:destructive comment`)
              }
            }
          }
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
