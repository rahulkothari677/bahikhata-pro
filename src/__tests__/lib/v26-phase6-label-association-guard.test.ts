/**
 * 🔒 V26 PHASE 6 §5.2 GUARDRAIL: Label/Input association.
 *
 * Phase 6 audit (§5.2 REAL BUG) found 107 <Label> usages with only 4 htmlFor
 * — screen readers announced unlabeled fields, and tapping a label didn't
 * focus its input. The fix swept all Label+Input pairs adding htmlFor/id.
 *
 * This test makes the regression visible in CI: every <Label> that's followed
 * by an <Input> within 3 lines MUST have an htmlFor matching the Input's id.
 *
 * (We don't enforce that EVERY <Label> has htmlFor — some Labels are for
 * Switches/Toggles which have their own aria labeling. We only enforce the
 * Label→Input pairing, which is the accessibility-critical case.)
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src/components')

describe('V26 Phase 6 §5.2 — Label/Input association', () => {
  test('every <Label> followed by an <Input> has htmlFor matching the Input id', () => {
    const violations: string[] = []

    function walkDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else if (entry.name.endsWith('.tsx')) {
          // Skip ui/ primitives (label.tsx, form.tsx) — they define the components.
          if (fullPath.includes('/ui/')) continue
          const content = fs.readFileSync(fullPath, 'utf8')
          const lines = content.split('\n')

          for (let i = 0; i < lines.length; i++) {
            // Find <Label ...>Text</Label> (single-line, with text content)
            const labelMatch = lines[i].match(/<Label(?:\s[^>]*)?>([^<]+)<\/Label>/)
            if (!labelMatch) continue

            // Check if htmlFor is present
            const htmlForMatch = lines[i].match(/htmlFor="([^"]+)"/)
            if (!htmlForMatch) continue  // Labels without htmlFor are checked manually (Switches etc.)

            const htmlFor = htmlForMatch[1]

            // Find the next <Input within 3 lines
            for (let j = i; j < Math.min(i + 4, lines.length); j++) {
              if (/<Input\b/.test(lines[j])) {
                const idMatch = lines[j].match(/id="([^"]+)"/)
                if (!idMatch) {
                  const relPath = path.relative(SRC_ROOT, fullPath)
                  violations.push(`${relPath}:${i + 1}: Label has htmlFor="${htmlFor}" but Input has no id`)
                } else if (idMatch[1] !== htmlFor) {
                  const relPath = path.relative(SRC_ROOT, fullPath)
                  violations.push(`${relPath}:${i + 1}: Label htmlFor="${htmlFor}" ≠ Input id="${idMatch[1]}"`)
                }
                break
              }
            }
          }
        }
      }
    }
    walkDir(SRC_ROOT)

    if (violations.length > 0) {
      throw new Error(
        `\n\n🔒 V26 PHASE 6 §5.2 GUARDRAIL FAILED.\n\n` +
        `Found ${violations.length} Label/Input mismatch(es):\n\n` +
        violations.slice(0, 20).map(v => `  ${v}`).join('\n') +
        (violations.length > 20 ? `\n  ... and ${violations.length - 20} more` : '') +
        `\n\nFix: every <Label htmlFor="field-x"> must be followed by an <Input id="field-x">.`
      )
    }
  })

  test('htmlFor count is now substantial (was 4, should be 90+)', () => {
    let count = 0
    function walkDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) walkDir(fullPath)
        else if (entry.name.endsWith('.tsx') && !fullPath.includes('/ui/')) {
          const content = fs.readFileSync(fullPath, 'utf8')
          count += (content.match(/htmlFor="/g) || []).length
        }
      }
    }
    walkDir(SRC_ROOT)
    // We had 4 before the fix; after sweeping 16 files we should have 90+.
    expect(count).toBeGreaterThanOrEqual(90)
  })
})
