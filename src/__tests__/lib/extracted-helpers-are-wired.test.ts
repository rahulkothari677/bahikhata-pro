/**
 * Extracted helpers must actually be USED by the app (2026-07-26).
 *
 * The agent's "Phase 7: Extract + test 6 HIGH-risk pure functions (31
 * behavioral tests)" copied four statement helpers and the scanner enricher
 * out of their components into src/lib, wrote 31 tests against the new files —
 * and never imported them anywhere. Production kept running the original
 * inline copies.
 *
 * That is worse than having no tests, for two reasons:
 *
 *   1. FALSE ASSURANCE. 31 green tests read as "these high-risk functions are
 *      now verified". They verified a copy that never executed.
 *
 *   2. SILENT DRIFT. The copies immediately diverged. statement-rows.ts lost
 *      the `.reverse()` its own docstring promised and read statement[0] (the
 *      NEWEST entry) as "oldest". Against real newest-first data that prints
 *      every customer statement backwards and invents an opening balance —
 *      Rs 1,500 on the test's own fixture. Nobody noticed because the shipped
 *      code was the other copy.
 *
 * This guard fails if a lib module is imported ONLY by its tests.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/** Every .ts/.tsx file under src, excluding tests. */
function appFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full)
      }
    }
  }
  walk(SRC)
  return out
}

const APP_SOURCE = appFiles().map((f) => fs.readFileSync(f, 'utf8')).join('\n')

/**
 * Modules extracted specifically so they could be unit-tested. Each must be
 * imported by real application code, not just by its test.
 */
const EXTRACTED_HELPERS = [
  'statement-rows',
  'scanner-enrich',
  'statement-balance',
  'paid-amount',
  'note-validation',
  'friendly-validation',
]

describe('extracted helpers are wired into the app', () => {
  test.each(EXTRACTED_HELPERS)('lib/%s is imported by application code', (mod) => {
    const file = path.join(SRC, 'lib', `${mod}.ts`)
    if (!fs.existsSync(file)) return // module renamed or removed — not this guard's business

    // An import from anywhere under src that is NOT a test file.
    const imported = new RegExp(`from '@/lib/${mod}'|from '\\./${mod}'|from '\\.\\./lib/${mod}'`).test(APP_SOURCE)
    expect(imported).toBe(true)
  })
})

describe('the statement helpers are not duplicated back into the component', () => {
  const partyProfile = fs.readFileSync(
    path.join(SRC, 'components/parties/PartyProfile.tsx'),
    'utf8',
  )
  const scanner = fs.readFileSync(
    path.join(SRC, 'components/scanner/BillScanner.tsx'),
    'utf8',
  )

  test('PartyProfile delegates rather than re-implementing', () => {
    // The inline copies are what drifted. Delegation keeps one definition.
    expect(partyProfile).toMatch(/buildStatementRowsShared/)
    expect(partyProfile).toMatch(/computeStatementOpening\(/)
    expect(partyProfile).toMatch(/computeAgeingBuckets\(/)
    // The hand-rolled ageing walk must be gone.
    expect(partyProfile).not.toMatch(/const buckets = \{ current: 0, overdue: 0/)
  })

  test('BillScanner delegates the enricher', () => {
    // Money-sensitive: unit normalisation + "trust the printed line total".
    expect(scanner).toMatch(/enrichScannedItemsShared/)
    expect(scanner).not.toMatch(/const printedTotal = Number\(item\.total\)/)
  })
})

describe('statement ordering is stated where it matters', () => {
  const lib = fs.readFileSync(path.join(SRC, 'lib/statement-rows.ts'), 'utf8')

  test('the newest-first contract is documented on each order-dependent helper', () => {
    // The extraction bug was purely an ordering assumption nobody wrote down.
    const matches = lib.match(/NEWEST-FIRST/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  test('rows are reversed for display and opening reads the last entry', () => {
    expect(lib).toMatch(/\[\.\.\.statement\]\.reverse\(\)/)
    expect(lib).toMatch(/statement\[statement\.length - 1\]/)
    expect(lib).not.toMatch(/const oldest = statement\[0\]/)
  })
})
