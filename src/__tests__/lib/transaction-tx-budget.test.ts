/**
 * Guards for the P2028 fix (2026-07-22).
 *
 * Rahul could not edit a six-line bill: every attempt returned
 * "Failed to update transaction". The response body, once the error mapper
 * landed, named it — P2028, Prisma's interactive-transaction timeout. The
 * transaction ran ~18 SEQUENTIAL statements (one stock update per old item,
 * one per new item, plus locks/checks/writes) against a 5s default budget, on
 * a database where this app sees 200-500ms per statement under pool
 * contention. Deterministic for a bill with enough lines — which is exactly
 * how it presented.
 *
 * Two properties keep it fixed, and both are asserted here: the budget is
 * explicit, and the per-item statement fan-out is gone.
 */
import fs from 'fs'
import path from 'path'

const ROUTES = [
  'src/app/api/transactions/route.ts',
  'src/app/api/transactions/[id]/route.ts',
]

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('interactive transaction budget', () => {
  test.each(ROUTES)('%s declares an explicit budget', (rel) => {
    const src = stripComments(read(rel))
    expect(src).toMatch(/const TX_OPTIONS = \{/)
    // Prisma's defaults (2s wait / 5s run) are what failed. Anything at or
    // below them would reintroduce the bug.
    const maxWait = Number((src.match(/maxWait:\s*([\d_]+)/) || [])[1]?.replace(/_/g, ''))
    const timeout = Number((src.match(/timeout:\s*([\d_]+)/) || [])[1]?.replace(/_/g, ''))
    expect(maxWait).toBeGreaterThan(2_000)
    expect(timeout).toBeGreaterThan(5_000)
  })

  test.each(ROUTES)('%s applies the budget to every $transaction call', (rel) => {
    const src = stripComments(read(rel))
    const opened = (src.match(/db\.\$transaction\(async \(tx\)/g) || []).length
    const budgeted = (src.match(/\}, TX_OPTIONS\)/g) || []).length
    expect(opened).toBeGreaterThan(0)
    // Every interactive transaction, not just the one that was reported —
    // fixing a single handler and leaving its siblings is the recurring
    // failure mode in this repo.
    expect(budgeted).toBe(opened)
  })

  test.each(ROUTES)('%s gives the serverless function room to outlive the transaction', (rel) => {
    const src = stripComments(read(rel))
    const maxDuration = Number((src.match(/export const maxDuration = (\d+)/) || [])[1])
    const timeout = Number((src.match(/timeout:\s*([\d_]+)/) || [])[1]?.replace(/_/g, ''))
    // Otherwise the platform kills the request before Prisma can return a
    // clean, mapped error and the user sees a generic failure again.
    expect(maxDuration * 1000).toBeGreaterThanOrEqual(timeout)
  })
})

describe('stock updates do not fan out per line item', () => {
  const src = stripComments(read('src/app/api/transactions/[id]/route.ts'))

  test('reversal and application are grouped per product', () => {
    expect(src).toMatch(/reversalByProduct/)
    expect(src).toMatch(/applyByProduct/)
  })

  test('no awaited product update sits inside a per-item for loop', () => {
    // The shape that caused P2028: `for (const item of ...) { await tx.product... }`
    const forLoops = src.match(/for \(const \w+ of (lockedOldItems|txItems)\) \{[\s\S]*?\n      \}/g) || []
    for (const loop of forLoops) {
      expect(loop).not.toMatch(/await tx\.product\./)
    }
  })

  test('the grouped updates are issued concurrently', () => {
    const concurrent = src.match(/await Promise\.all\(\s*\[\.\.\.(reversalByProduct|applyByProduct)\.entries\(\)\]/g) || []
    expect(concurrent.length).toBeGreaterThanOrEqual(2)
  })

  test('block-mode overselling is still detected after grouping', () => {
    // Grouping must not lose the STOCK_BLOCK behaviour — a bill that oversells
    // has to be rejected, now checked against the per-product TOTAL.
    expect(src).toMatch(/currentStock: \{ gte: entry\.qty \}/)
    expect(src).toMatch(/const blocked = results\.find\(r => r\.count === 0\)/)
    expect(src).toMatch(/err\.code = 'STOCK_BLOCK'/)
  })
})
