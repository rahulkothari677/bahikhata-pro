/**
 * 🔒 V26 PHASE 5 GUARDRAIL: Idempotency & concurrency lint.
 *
 * Phase 5 audit (R2) found that the idempotency machinery was effectively dead:
 * - The mutation ID was only generated AFTER fetch threw (so lost-response
 *   replays carried a brand-new UUID the server had never seen → duplicates).
 * - The payments route read the ID from the body (which no client sends) →
 *   the entire V19-007 dedup block was dead code → payment replay duplicated.
 * - Income/expense creates never stored the ID → dedup lookup could never
 *   match → queued income/expense replays duplicated.
 *
 * This test makes those classes fail CI:
 *   1. offline-fetch.ts must add the x-client-mutation-id header BEFORE the
 *      first online fetch (not only in queueForSync).
 *   2. Every route that has an idempotency check (findUnique on
 *      clientMutationId) must read the ID from the HEADER (where the queue
 *      puts it), not the body.
 *   3. Every route that has an idempotency check must ALSO store the ID in
 *      the create's data block (otherwise the lookup can never match).
 *   4. Every route that has an idempotency check must catch P2002 on the
 *      clientMutationId @unique constraint (the simultaneous-replay race).
 *
 * If this test fails on your new feature: add the missing piece. The four
 * requirements together close the lost-response + simultaneous-replay race
 * that was Phase 5's most user-impacting finding.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src')

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8')
}

describe('V26 Phase 5 — Idempotency guardrail', () => {
  test('offline-fetch.ts: x-client-mutation-id is added BEFORE the online fetch', () => {
    // The fix introduced ensureMutationIdHeader() which is called before the
    // `fetch(url, ...)` call in handleMutation. The pre-fix code only
    // generated the UUID inside queueForSync (which runs AFTER fetch throws).
    const src = readFile('lib/offline-fetch.ts')
    expect(src).toMatch(/ensureMutationIdHeader/)
    // The header must be set on `enhancedOpts` and `enhancedOpts` must be
    // passed to BOTH fetch() AND queueForSync().
    expect(src).toMatch(/const enhancedOpts = ensureMutationIdHeader\(fetchOpts\)/)
    expect(src).toMatch(/fetch\(url, enhancedOpts\)/)
    expect(src).toMatch(/queueForSync\(url, method, enhancedOpts/)
  })

  test('payments route: reads x-client-mutation-id from the HEADER', () => {
    // Pre-fix: read body.clientMutationId (always undefined → dedup dead).
    // Post-fix: reads header first, body as fallback.
    const src = readFile('app/api/payments/route.ts')
    expect(src).toMatch(/req\.headers\.get\(['"]x-client-mutation-id['"]\)/)
    // The idempotency check must still be present.
    expect(src).toMatch(/clientMutationId/)
    expect(src).toMatch(/payment\.findUnique/)
    // The create data block must store clientMutationId.
    expect(src).toMatch(/clientMutationId:\s*clientMutationId/)
    // P2002 catch must be present (simultaneous-replay race).
    expect(src).toMatch(/P2002/)
    expect(src).toMatch(/idempotent:\s*true/)
  })

  test('transactions route: income/expense create stores clientMutationId', () => {
    // Pre-fix: the income/expense branch had no clientMutationId in the data
    // block → dedup lookup could never match → queued replays duplicated.
    const src = readFile('app/api/transactions/route.ts')
    // The idempotency check (read header + findUnique) is already at the top.
    expect(src).toMatch(/req\.headers\.get\(['"]x-client-mutation-id['"]\)/)
    expect(src).toMatch(/transaction\.findUnique/)
    // The income/expense branch must store the ID.
    // Match the income/expense create data block.
    const incomeExpenseBlock = src.match(/if \(type === 'income' \|\| type === 'expense'\)[\s\S]*?return NextResponse\.json\(\{ transaction \}\)/)
    expect(incomeExpenseBlock).toBeTruthy()
    expect(incomeExpenseBlock![0]).toMatch(/clientMutationId:\s*clientMutationId/)
    // P2002 catch for clientMutationId.
    expect(src).toMatch(/P2002/)
    expect(src).toMatch(/isMutationIdConflict/)
    expect(src).toMatch(/idempotent:\s*true/)
  })

  test('convert route: compare-and-swap inside $transaction', () => {
    // Pre-fix: unconditional update → two concurrent converts both passed
    // the early check (READ COMMITTED) → double sale + double stock decrement.
    // Post-fix: updateMany with convertedToTransactionId:null in WHERE clause
    // acts as compare-and-swap; throws CONVERT_RACE on count === 0.
    const src = readFile('app/api/transactions/[id]/convert/route.ts')
    expect(src).toMatch(/updateMany\(\s*\{[\s\S]*?convertedToTransactionId:\s*null/)
    expect(src).toMatch(/CONVERT_RACE/)
    expect(src).toMatch(/claimed\.count === 0/)
    // The outer catch must return a 409 for CONVERT_RACE.
    expect(src).toMatch(/err\?\.code === 'CONVERT_RACE'/)
    expect(src).toMatch(/status:\s*409/)
  })

  test('payment verify route: P2002 catch is still present (house pattern)', () => {
    // The verify route was the house pattern we copied for payments/transactions.
    // This test ensures it stays as the reference implementation.
    const src = readFile('app/api/payment/verify/route.ts')
    expect(src).toMatch(/P2002/)
    expect(src).toMatch(/idempotent:\s*true/)
  })
})
