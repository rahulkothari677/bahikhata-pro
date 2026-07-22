/**
 * 🔒 PROFIT-LEAK ROUTE SWEEP — hiding a number in the UI is not access control.
 *
 * WHY THIS EXISTS
 * ---------------
 * Rounds 12-15 fixed a series of "profit visible to staff" findings. The
 * Dashboard fix was done correctly (server-side, via stripDashboardProfit).
 * The Inventory fix was NOT: it gated the figures in the COMPONENT (stat card,
 * list column, grid card, ProductDialog preview) while /api/products kept
 * returning `purchasePrice` — the cost price — to every caller. A staff member
 * with hideProfit enabled could read the margin on every product straight from
 * the Network tab, or out of the offline IndexedDB cache.
 *
 * A sibling sweep then found the same leak in /api/transactions/[id]/convert,
 * which returned the freshly-created sale (including grossProfit) unstripped.
 *
 * This test enforces the rule at the routing layer: if a route can emit a
 * cost/profit field, it must consult shouldHideProfit. Component-level hiding
 * is cosmetic and does not count.
 */

import fs from 'fs'
import path from 'path'
import { stripProductProfit } from '@/lib/profit-visibility'

const API_DIR = path.join(process.cwd(), 'src/app/api')

/** Fields that reveal cost or margin. */
const PROFIT_FIELDS = /\b(purchasePrice|grossProfit|potentialProfit|profitMargin|netProfit|profitGrowth)\b/

/**
 * Routes exempt from the rule, each with a reason.
 * Founder/owner-only endpoints legitimately see everything.
 */
const EXEMPT: Record<string, string> = {
  'debug/paise-audit/route.ts': 'founder-only diagnostic',
  'debug/party-balance-detail/route.ts': 'founder-only diagnostic',
  'debug/party-balance-recon/route.ts': 'founder-only diagnostic',
  'debug/repair-payment-amount/route.ts': 'founder-only repair',
  'debug/repair-null-paidamount/route.ts': 'founder-only repair',
  'import/restore/route.ts': 'owner-only restore (getAuthUserIdOwnerOnly)',
  'export/full/route.ts': 'owner-only full export',
  'account/export/route.ts': 'owner-only data export',
  'account/delete/route.ts': 'owner-only account deletion',
  'seed/route.ts': 'owner-only demo seed',
  'cron/nightly-reconciliation/route.ts': 'CRON_SECRET-gated, no user session',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name === 'route.ts') out.push(p)
  }
  return out
}

describe('profit-leak sweep across API routes', () => {
  const routes = walk(API_DIR)

  test('the sweep actually finds routes (guard is wired)', () => {
    expect(routes.length).toBeGreaterThan(20)
  })

  test('every route that can emit cost/profit consults shouldHideProfit', () => {
    const offenders: string[] = []

    for (const file of routes) {
      const rel = file.replace(/\\/g, '/').split('src/app/api/')[1]
      if (EXEMPT[rel]) continue

      const src = fs.readFileSync(file, 'utf8')
      // Ignore comments so prose about profit doesn't trip the sweep — the
      // "grep matched a comment describing the bug" trap.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')

      if (!PROFIT_FIELDS.test(code)) continue
      if (/shouldHideProfit/.test(code)) continue

      offenders.push(
        `${rel} — emits a cost/profit field without a shouldHideProfit gate. ` +
        `Strip it server-side (stripProductsProfit / stripTransactionProfit / ` +
        `stripReportProfit), or add it to EXEMPT with a reason if the route is ` +
        `founder/owner-only.`,
      )
    }

    expect(offenders).toEqual([])
  })

  test('the product strip helper removes cost but keeps what staff need', () => {
    // Behavioural: staff must still be able to sell and reorder.
    const stripped = stripProductProfit({
      id: 'p1', name: 'Atta 5kg',
      purchasePrice: 200, salePrice: 260, mrp: 280,
      currentStock: 12, lowStockThreshold: 5, stockValue: 2400, isLowStock: false,
    })
    // Removed — these reveal the margin.
    expect(stripped.purchasePrice).toBeUndefined()
    expect(stripped.stockValue).toBeUndefined()
    // Kept — needed to operate the shop.
    expect(stripped.salePrice).toBe(260)
    expect(stripped.mrp).toBe(280)
    expect(stripped.currentStock).toBe(12)
    expect(stripped.name).toBe('Atta 5kg')
  })
})
