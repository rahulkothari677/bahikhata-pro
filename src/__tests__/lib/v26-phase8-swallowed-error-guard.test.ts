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

            // Look ahead 5 lines for e?.message or e.message
            let foundMessage = false
            let hasToast = false
            for (let j = i; j < Math.min(i + 6, lines.length); j++) {
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
