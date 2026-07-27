/**
 * V26 Phase 8 NEW-3 GUARDRAIL: No swallowed errors in readError files.
 *
 * The P7-2 / PB-5 / NEW-3 class has regressed 3 times: the server's error
 * message is fetched via readError(r) and thrown, then the catch block
 * discards e.message and toasts a hardcoded string. This test enforces
 * that every unbound catch in a file that imports readError is either:
 *   (a) followed within 5 lines by e?.message or e.message in the toast
 *   (b) marked with an intentional-ignore comment
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src/components')

describe('V26 Phase 8 NEW-3 — No swallowed errors in readError files', () => {
  test('every catch block in a readError-importing file surfaces e.message', () => {
    const violations: string[] = []

    function walkDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else if (entry.name.endsWith('.tsx')) {
          const content = fs.readFileSync(fullPath, 'utf8')
          if (!content.includes('readError')) continue

          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes('} catch {')) continue
            // Skip intentional ignores
            if (lines[i].includes('/* ignore') || lines[i].includes('/* default') || lines[i].includes('/* skip')) continue

            // 🐛 FIX (audit 2026-07-27): skip an EMPTY catch body, `catch {}`.
            // It contains no statements, so it cannot be swallowing an error
            // that a toast should have surfaced. This is the correct idiom for
            // localStorage.clear(), which genuinely throws in private browsing
            // and has nothing to report to the user.
            if (/catch\s*\{\s*\}/.test(lines[i])) continue

            // Look ahead for e?.message — but STOP at the end of this block.
            //
            // 🐛 FIX (audit 2026-07-27): the look-ahead was a flat 5 lines,
            // which walked straight out of the catch and into the sibling
            // `} else {` branch. It found that branch's sonnerToast.error and
            // blamed it on this catch. That produced 2 false positives in
            // Settings.tsx against code that was entirely correct.
            //
            // A toast only counts if it is INSIDE the catch we are judging.
            let foundMessage = false
            let hasToast = false
            for (let j = i; j < Math.min(i + 6, lines.length); j++) {
              // Leaving the block: a closing brace or an else at the same or
              // lower indentation than the catch itself.
              if (j > i && /^\s*\}\s*(else\b|catch\b|finally\b)?/.test(lines[j])) {
                const catchIndent = lines[i].search(/\S/)
                const lineIndent = lines[j].search(/\S/)
                if (lineIndent <= catchIndent) break
              }
              if (lines[j].includes('e?.message') || lines[j].includes('e.message') || lines[j].includes('err?.message') || lines[j].includes('err.message')) {
                foundMessage = true
                break
              }
              if (lines[j].includes('sonnerToast.error') || lines[j].includes('toast.error')) {
                hasToast = true
              }
            }
            // Only flag if there's a toast.error nearby (the pattern is:
            // throw new Error(await readError(r)) → catch → toast.error("hardcoded"))
            // Catches without a toast (localStorage, JSON.parse, etc.) are fine.
            if (!foundMessage && hasToast) {
              const relPath = path.relative(SRC_ROOT, fullPath)
              violations.push(`${relPath}:${i + 1}: catch without e?.message in next 5 lines`)
            }
          }
        }
      }
    }
    walkDir(SRC_ROOT)

    if (violations.length > 0) {
      throw new Error(
        `\n\n🔒 V26 PHASE 8 NEW-3 GUARDRAIL FAILED.\n\n` +
        `Found ${violations.length} swallowed catch block(s) in files that import readError.\n` +
        `The server's error message is fetched and then discarded.\n\n` +
        `Fix: change } catch { to } catch (e: any) { and use e?.message in the toast.\n\n` +
        violations.slice(0, 20).map(v => `  ${v}`).join('\n') +
        (violations.length > 20 ? `\n  ... and ${violations.length - 20} more` : '') +
        `\n`
      )
    }
  })
})
