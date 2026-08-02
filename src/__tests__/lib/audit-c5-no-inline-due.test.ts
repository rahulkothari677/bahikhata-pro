/**
 * 🔒 AUDIT C5 — nothing may compute a bill's due inline.
 *
 * `total − paidAmount` looks obviously right and is now wrong: it ignores every
 * payment allocated to the bill. That is the exact expression that produced the
 * stale "Due ₹2,992.50" on a bill with ₹1,000 already settled, and it is easy
 * to reintroduce because it reads as the natural thing to write.
 *
 * So it is banned on the per-BILL paths and must go through computeInvoiceDue().
 *
 * THE IMPORTANT EXCEPTION, and why this guard has an allowlist rather than
 * being absolute: per-PARTY balance code uses the same expression legitimately.
 *
 *     party balance = Σ(sale.total − sale.paid) − Σ(payments)
 *
 * An allocation IS a payment and is already subtracted by the second term.
 * Netting it again inside the first term would double-count and understate what
 * every customer owes — turning a display bug into a balance bug. Those files
 * are listed below with that reason attached, so nobody "finishes the job" by
 * converting them.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/**
 * Files where `total − paid` is the CORRECT expression because the payment is
 * subtracted separately as its own term.
 */
const PARTY_BALANCE_FILES = new Set([
  'lib/party-balance.ts',
  'lib/balance-as-of.ts',
  'lib/statement-balance.ts',
  'lib/invoice-due.ts',              // the implementation itself
  'app/api/reports/route.ts',        // periodActivity: payments counted separately
  'app/api/parties/[id]/balance-as-of/route.ts',
  'app/api/debug/party-balance-detail/route.ts',
  'app/api/debug/repair-headers/route.ts',
])

/**
 * Blank out comments while PRESERVING length and newlines.
 *
 * Collapsing them to a single space (the obvious implementation) shifts every
 * subsequent character index, so the reported line numbers point at unrelated
 * code — which is exactly what happened on this test's first run: it correctly
 * found an inline calculation in insights/route.ts but pointed at a comment
 * block dozens of lines away. A guard that reports the wrong location wastes
 * the time of whoever it fires on.
 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, m => ' '.repeat(m.length))
}

function scan(): Array<{ rel: string; line: number; snippet: string }> {
  const found: Array<{ rel: string; line: number; snippet: string }> = []

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!p.includes('__tests__')) walk(p)
        continue
      }
      if (!/\.tsx?$/.test(e.name)) continue

      const rel = path.relative(SRC, p).split(path.sep).join('/')
      if (PARTY_BALANCE_FILES.has(rel)) continue

      const raw = fs.readFileSync(p, 'utf8')
      const code = stripComments(raw)

      // total − paid, in any of the shapes this codebase actually used.
      const re = /(\w+\.)?totalAmount\s*-\s*\(?\s*(\w+\.)?paidAmount/g
      let m: RegExpExecArray | null
      while ((m = re.exec(code)) !== null) {
        found.push({
          rel,
          line: raw.slice(0, m.index).split('\n').length,
          snippet: code.slice(m.index, m.index + 60).replace(/\s+/g, ' '),
        })
      }
    }
  }

  walk(SRC)
  return found
}

describe('C5 — due is computed in exactly one place', () => {
  test('the scanner works (guards against a regex that finds nothing)', () => {
    // If this scan silently matched zero things it would "pass" forever while
    // protecting nothing — a failure mode already hit once in this audit.
    const anyMatch = /(\w+\.)?totalAmount\s*-\s*\(?\s*(\w+\.)?paidAmount/.test(
      'const due = t.totalAmount - t.paidAmount',
    )
    expect(anyMatch).toBe(true)
  })

  test('no per-bill path computes total − paid inline', () => {
    const offenders = scan()

    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} inline due calculation(s):\n\n` +
        offenders.map(o => `  ${o.rel}:${o.line}  ${o.snippet}`).join('\n') +
        `\n\nUse computeInvoiceDue({ totalAmount, paidAmount, allocatedAmount })\n` +
        `from lib/invoice-due.ts. \`total − paidAmount\` ignores payments settled\n` +
        `against the bill, which is the stale figure that let a bill be collected\n` +
        `twice (see docs/audit/08-c5-verified-and-design.md).\n\n` +
        `If this file computes a PARTY BALANCE rather than a bill's due, the\n` +
        `expression is correct — payments are subtracted separately there, and\n` +
        `netting allocations again would double-count. Add it to\n` +
        `PARTY_BALANCE_FILES in this test WITH that reason.`,
      )
    }

    expect(offenders).toEqual([])
  })
})
