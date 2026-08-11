/**
 * 🔒 Every receipt must open the document it names.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────
 *
 * The expenses answer grouped its rows by category and gave each one a made-up
 * id:
 *
 *     sources: groups.map(([name, amount]) => ({
 *       kind: 'transaction', id: `category:${name}`, label: name, amount,
 *     }))
 *
 * with a comment claiming the client would "fall back to the income-and-expense
 * screen". It does not. AskAnswer sets `kind: 'transaction'` ids straight into
 * `setSelectedTransactionId` and navigates, so tapping "Rent ₹5,000" landed the
 * shopkeeper on **"Transaction not found"**.
 *
 * ── WHY IT SURVIVED VERIFICATION ──────────────────────────────────────
 *
 * I checked that answer against a shop with NO expenses recorded. It replied
 * "₹0.00 spent this month" with an empty source list — correct, and completely
 * unable to reveal the bug, because a list with no rows has no rows to tap.
 *
 * Rahul's instruction: record the data first, then ask again. That is what
 * surfaced it, and it is now rule C8.
 *
 * ── WHAT THIS GUARDS ──────────────────────────────────────────────────
 *
 * `sources` is the promise of this whole feature — every figure opens the
 * document behind it. A synthesised id breaks that promise silently: the row
 * still renders, still shows a rupee amount, and only fails when someone taps.
 * So no id in this route may be constructed; each must come from a row.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const ROUTE = path.resolve(process.cwd(), 'src/app/api/ask/route.ts')

/** Blank comments, keeping line numbers, so documentation is never a hit. */
function withoutComments(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank)
}

describe('Ask receipts point at real records', () => {
  const src = withoutComments(fs.readFileSync(ROUTE, 'utf8'))

  test('the scan reaches the file', () => {
    expect(src.length).toBeGreaterThan(2000)
    expect(src).toMatch(/sources:/)
  })

  test('no source id is built from a template string', () => {
    /*
     * `id: \`category:${name}\`` is the exact shape that shipped broken. Any
     * constructed id is suspect: the client treats it as a primary key.
     */
    const violations: string[] = []
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (/\bid:\s*`/.test(line)) {
        violations.push(`${i + 1}: ${line.trim().slice(0, 90)}`)
      }
    })

    if (violations.length) {
      throw new Error(
        `\n\n🔒 ASK RECEIPT GUARD FAILED.\n\n` +
        `A source id was built from a template string. The client passes these\n` +
        `straight to setSelectedTransactionId and navigates, so a synthesised\n` +
        `id renders a normal-looking row that says "Transaction not found"\n` +
        `when tapped.\n\n` +
        `If a figure has no document behind it, put it in \`detail\` as words —\n` +
        `that is where the expense category breakdown lives now.\n\n` +
        violations.map(v => `  ${v}`).join('\n') + `\n`,
      )
    }
  })

  test('every source id reads a field off a row', () => {
    /*
     * The positive form of the same rule, so a future edit cannot satisfy the
     * check above with `id: someString` instead of a template.
     *
     * Allowed: `id: r.id`, `id: b.id`, `id: p.id`, `id: x.id` — a property
     * read. Anything else is flagged for a human to look at.
     */
    const bad: string[] = []
    for (const m of src.matchAll(/\bid:\s*([^,\n}]+)/g)) {
      const value = m[1].trim()
      if (/^[a-zA-Z_$][\w$]*\.id$/.test(value)) continue      // r.id
      if (/^[a-zA-Z_$][\w$]*$/.test(value)) continue          // id (shorthand var)
      bad.push(value.slice(0, 60))
    }
    expect({ suspiciousSourceIds: bad }).toEqual({ suspiciousSourceIds: [] })
  })

  test('the expense answer no longer groups its receipts by category', () => {
    // The specific regression, pinned by name.
    expect(src).not.toMatch(/id:\s*`category:/)
  })
})
