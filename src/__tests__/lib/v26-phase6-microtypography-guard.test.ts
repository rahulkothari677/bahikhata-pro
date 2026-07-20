/**
 * 🔒 V26 PHASE 6 §1.2 GUARDRAIL: No off-scale text-[Npx] classes.
 *
 * Phase 6 audit (§1.2) found 404 usages of text-[9px]/[10px]/[11px]/[13px] —
 * off-scale arbitrary values that made dense screens read as cramped and were
 * illegible at the bottom end (9px below any legibility floor on mid-range
 * Android in bright shops).
 *
 * The fix added named tokens (--text-2xs, --text-3xs) and replaced all 404
 * usages. This test makes sure they can't come back.
 *
 * If this test fails on your new feature: use text-2xs (11px) or text-3xs
 * (10px) instead of text-[11px]/[10px]. For body copy, use text-xs (12px)
 * minimum. The only exceptions are documented below.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src')

describe('V26 Phase 6 §1.2 — No off-scale text-[Npx] classes', () => {
  test('no text-[Npx] arbitrary value classes in src/ (use text-2xs/text-3xs instead)', () => {
    const violations: string[] = []
    const TEXT_BRACKET_RE = /text-\[\d+px\]/

    function walkDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          // Skip this guard test itself — its JSDoc mentions the patterns.
          if (entry.name.includes('microtypography-guard')) continue
          const content = fs.readFileSync(fullPath, 'utf8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            // Skip comment lines — they may mention the pattern in docs.
            const trimmed = lines[i].trim()
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
            if (TEXT_BRACKET_RE.test(lines[i])) {
              const relPath = path.relative(SRC_ROOT, fullPath)
              violations.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 100)}`)
            }
          }
        }
      }
    }
    walkDir(SRC_ROOT)

    if (violations.length > 0) {
      throw new Error(
        `\n\n🔒 V26 PHASE 6 §1.2 GUARDRAIL FAILED.\n\n` +
        `Found ${violations.length} off-scale text-[Npx] class(es) in src/.\n` +
        `Use the named tokens instead:\n` +
        `  text-2xs  (11px) — micro labels, section descriptions\n` +
        `  text-3xs  (10px) — badges, chart ticks, nav counts\n` +
        `  text-xs   (12px) — body copy minimum\n\n` +
        `Violations:\n` +
        violations.slice(0, 20).map(v => `  ${v}`).join('\n') +
        (violations.length > 20 ? `\n  ... and ${violations.length - 20} more` : '') +
        `\n`
      )
    }
  })

  test('globals.css defines --text-2xs and --text-3xs tokens', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toMatch(/--text-2xs:\s*0\.6875rem/)
    expect(css).toMatch(/--text-3xs:\s*0\.625rem/)
    expect(css).toMatch(/--text-2xs--line-height/)
    expect(css).toMatch(/--text-3xs--line-height/)
  })
})
