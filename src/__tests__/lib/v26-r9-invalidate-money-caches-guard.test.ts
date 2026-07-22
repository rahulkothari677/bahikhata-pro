/**
 * CI guard: every money-mutation success path must call invalidateMoneyCaches.
 *
 * This locks the R9-6/R9-7/R9-8/R9-10 fix — without it, future code that adds
 * a new mutation handler will silently revert to the old pattern (only
 * invalidating ['transactions'] + ['dashboard']) and reintroduce the
 * stale-party-balance / stale-product-stock bug.
 *
 * The grep-shaped assertions below check that:
 *   1. The helper exists and is exported from src/lib/invalidate-money-caches.ts
 *   2. Every file that performs a money mutation (POST/PUT/DELETE to
 *      /api/transactions or /api/payments) imports and calls the helper in
 *      its success path.
 *
 * If you add a new money-mutation site, ADD it to MUTATION_FILES below and
 * ensure it calls invalidateMoneyCaches(queryClient) on success.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..', '..', '..')

const HELPER_FILE = path.join(ROOT, 'src/lib/invalidate-money-caches.ts')

// Files that perform money mutations (POST/PUT/DELETE to /api/transactions
// or /api/payments). Each must import + call invalidateMoneyCaches.
const MUTATION_FILES = [
  'src/components/ledger/TransactionEntry.tsx',
  'src/components/ledger/TransactionDetail.tsx',
  'src/components/ledger/Ledger.tsx',
  'src/components/income/IncomeExpense.tsx',
  'src/components/parties/PartyProfile.tsx',
  'src/hooks/use-recurring-entries.ts',
]

describe('invalidateMoneyCaches helper [R9-6/R9-7/R9-8/R9-10]', () => {
  test('helper file exists and exports invalidateMoneyCaches', () => {
    expect(fs.existsSync(HELPER_FILE)).toBe(true)
    const src = fs.readFileSync(HELPER_FILE, 'utf8')
    expect(src).toMatch(/export\s+async\s+function\s+invalidateMoneyCaches/)
    // Must invalidate the key caches — party-profile (prefix), products (prefix),
    // parties (prefix), transactions, dashboard, setting.
    expect(src).toMatch(/queryKey:\s*\['party-profile'\]/)
    expect(src).toMatch(/queryKey:\s*\['products'\]/)
    expect(src).toMatch(/queryKey:\s*\['parties'\]/)
    expect(src).toMatch(/queryKey:\s*\['transactions'\]/)
    expect(src).toMatch(/queryKey:\s*\['dashboard'\]/)
  })

  test.each(MUTATION_FILES)('%s imports invalidateMoneyCaches', (rel) => {
    const file = path.join(ROOT, rel)
    expect(fs.existsSync(file)).toBe(true)
    const src = fs.readFileSync(file, 'utf8')
    expect(src).toMatch(/import\s+\{[^}]*invalidateMoneyCaches[^}]*\}\s+from\s+['"]@\/lib\/invalidate-money-caches['"]/)
  })

  test.each(MUTATION_FILES)('%s calls invalidateMoneyCaches(queryClient) at least once', (rel) => {
    const file = path.join(ROOT, rel)
    const src = fs.readFileSync(file, 'utf8')
    // Match either `invalidateMoneyCaches(queryClient)` (fire-and-forget) or
    // `await invalidateMoneyCaches(queryClient)` (awaited).
    expect(src).toMatch(/invalidateMoneyCaches\(queryClient\)/)
  })
})
