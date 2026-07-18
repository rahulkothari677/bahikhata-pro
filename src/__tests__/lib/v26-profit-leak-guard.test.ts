/**
 * V26 N4 - CI guardrail: every profit-bearing API route must call shouldHideProfit.
 *
 * This is a structural guardrail to stop the recurring anti-pattern
 * (BUG-021 in V24 -> M4/M5 in V26 -> next leak). A new endpoint that returns
 * grossProfit, profit, or margin in its response body MUST call
 * shouldHideProfit and gate the profit fields on the result. If it doesn't,
 * a staff member the owner explicitly hid profit from can read the exact
 * numbers via the raw API response.
 *
 * This test scans every file under src/app/api (route.ts files) and asserts:
 *   - If the file's source mentions grossProfit / profit / margin in a
 *     response-shaping context, the file MUST import and call shouldHideProfit.
 *
 * The allowlist records routes that legitimately handle profit but are exempt
 * (e.g. owner-only routes that don't accept staff callers).
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api')

function listRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listRouteFiles(full))
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      out.push(full)
    }
  }
  return out
}

/**
 * Routes that legitimately handle profit but are exempt from the guardrail.
 * Each entry MUST have a justification comment.
 */
const ALLOWLIST: string[] = [
  // Restore is a WRITE-only path: it writes grossProfit into the DB from a
  // backup file. It never returns profit to the caller. Restore is also
  // founder-only per the V26 audit (M6) — staff can't invoke it. N5 will
  // harden restore further; the leak surface here is "staff restores a backup
  // and then reads the restored transactions via GET" — and GET already has
  // its own shouldHideProfit gate (verified by this guardrail).
  'src/app/api/import/restore/route.ts',
]

/** Tokens that indicate a route is profit-bearing. */
const PROFIT_TOKENS = /\b(grossProfit|profit|margin)\b/g

/** Excludes comments and string literals — crude but effective. */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/\/\/.*$/gm, '')           // line comments
    .replace(/`[^`]*`/g, '""')          // template literals (crude)
    .replace(/"[^"]*"/g, '""')          // double-quoted strings
    .replace(/'[^']*'/g, "''")          // single-quoted strings
}

describe('🔒 V26 N4 — Profit-leak guardrail (CI)', () => {
  const routeFiles = listRouteFiles(API_ROOT)

  test('route files were discovered', () => {
    expect(routeFiles.length).toBeGreaterThan(0)
  })

  test('every profit-bearing route calls shouldHideProfit', () => {
    const violations: string[] = []

    for (const file of routeFiles) {
      const rel = path.relative(process.cwd(), file).replace(/\\/g, '/')
      if (ALLOWLIST.includes(rel)) continue

      const raw = fs.readFileSync(file, 'utf8')
      const stripped = stripCommentsAndStrings(raw)

      // Does this route mention grossProfit / profit / margin in code?
      const matches = stripped.match(PROFIT_TOKENS)
      if (!matches) continue

      // It's profit-bearing. Does it call shouldHideProfit?
      if (!/\bshouldHideProfit\b/.test(stripped)) {
        violations.push(
          `${rel}: mentions ${Array.from(new Set(matches)).join('/')} but does NOT call shouldHideProfit. ` +
          `Add \`const hideProfit = await shouldHideProfit(userId, role)\` and gate the profit fields on it.`
        )
      }
    }

    if (violations.length > 0) {
      console.error('\n❌ Profit-leak guardrail violations:\n' + violations.map(v => '  - ' + v).join('\n'))
    }
    expect(violations).toEqual([])
  })
})
