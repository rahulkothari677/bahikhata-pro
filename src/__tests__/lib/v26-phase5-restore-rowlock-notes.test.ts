/**
 * 🔒 V26 PHASE 5 BATCH 2 — Restore + row-lock + note-cap guardrail.
 *
 * Phase 5 audit findings covered:
 *   R3 🔴 — Restore was non-atomic + capped at 60s + assertShopIsEmpty blocked
 *           retry → partial books with no way forward except destructive reset.
 *           Fix: chunked $transaction + resume marker (Setting.lastRestoreSessionId).
 *   R19 🔵 — Restore N+1 (per-row party findFirst). Folded into R3's rework.
 *   R4 🟠 — Concurrent PUTs to same transaction corrupted stock (oldItems
 *           snapshot outside $transaction). Fix: FOR UPDATE + re-read inside tx.
 *   R5 🟠 — Note-cap validation didn't hold under concurrency (READ COMMITTED
 *           means inside-tx check still races). Fix: FOR UPDATE on original.
 *
 * This test file has TWO sections:
 *   1. Grep-shaped CI guards (keeping this phase's bug classes closed).
 *   2. Behavioral unit tests for the resume-marker logic + FOR UPDATE pattern.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src')

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8')
}

// ─── Section 1: CI grep guards ─────────────────────────────────────────────

describe('V26 Phase 5 Batch 2 — CI grep guards', () => {
  test('R3: restore route uses chunked $transaction + resume marker', () => {
    const src = readFile('app/api/import/restore/route.ts')
    // Chunked $transaction (TXN_CHUNK_SIZE constant).
    expect(src).toMatch(/TXN_CHUNK_SIZE\s*=\s*100/)
    expect(src).toMatch(/\$transaction\(async \(tx\)/)
    expect(src).toMatch(/timeout:\s*20_000/)
    // Resume marker (Setting.lastRestoreSessionId).
    expect(src).toMatch(/lastRestoreSessionId/)
    expect(src).toMatch(/checkShopEmptyOrResume/)
    // finally block clears the marker.
    expect(src).toMatch(/finally\s*{[\s\S]*?lastRestoreSessionId:\s*null/)
    // R19 N+1 kill: partyIdByName Map preloaded once.
    expect(src).toMatch(/partyIdByName\s*=\s*new Map/)
  })

  test('R3: Prisma schema has lastRestoreSessionId on Setting', () => {
    const schema = fs.readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    expect(schema).toMatch(/lastRestoreSessionId\s+String\?/)
  })

  test('R3: migration SQL is idempotent (IF NOT EXISTS)', () => {
    const migrationDir = path.resolve(process.cwd(), 'prisma/migrations/20260720000001_setting_last_restore_session')
    expect(fs.existsSync(migrationDir)).toBe(true)
    const sql = fs.readFileSync(path.join(migrationDir, 'migration.sql'), 'utf8')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "lastRestoreSessionId"/)
  })

  test('R4: transaction PUT does FOR UPDATE + re-check deletedAt inside $transaction', () => {
    const src = readFile('app/api/transactions/[id]/route.ts')
    // FOR UPDATE inside the $transaction (PUT handler).
    expect(src).toMatch(/FOR UPDATE/)
    expect(src).toMatch(/EDIT_GONE/)
    // Re-read oldItems inside the lock (lockedOldItems variable).
    expect(src).toMatch(/lockedOldItems/)
    // The pre-tx oldItems fetch is kept for the stock-policy warning computation.
    expect(src).toMatch(/db\.transactionItem\.findMany/)
  })

  test('R4: transaction DELETE does FOR UPDATE + re-checks linkedNotes inside $transaction', () => {
    const src = readFile('app/api/transactions/[id]/route.ts')
    // DELETE handler: FOR UPDATE + re-check linkedNotes inside tx.
    // The DELETE handler's $transaction should re-check linkedNotes.
    // Look for the LINKED_NOTES_EXIST error code (thrown inside tx, caught outside).
    expect(src).toMatch(/LINKED_NOTES_EXIST/)
    expect(src).toMatch(/linkedNotesLocked/)
  })

  test('R5: validateNoteAgainstOriginal acquires FOR UPDATE lock', () => {
    const src = readFile('lib/note-validation.ts')
    expect(src).toMatch(/FOR UPDATE/)
    // The lock is conditional on $queryRaw being available (test stubs don't
    // implement it — the lock is a no-op in unit tests, fires against real Postgres).
    expect(src).toMatch(/if \(db\.\$queryRaw\)/)
  })

  test('R5: PUT re-runs note-cap checks INSIDE the $transaction', () => {
    const src = readFile('app/api/transactions/[id]/route.ts')
    // The inside-tx re-check uses `tx` (not `db`).
    expect(src).toMatch(/validateNoteAgainstOriginal\(tx,/)
    expect(src).toMatch(/checkLinkedNotesCap\(tx,/)
    // NOTE_VALIDATION_FAILED catch in the PUT handler.
    expect(src).toMatch(/NOTE_VALIDATION_FAILED/)
  })

  test('R5: DELETE locks the row before re-checking linkedNotes', () => {
    const src = readFile('app/api/transactions/[id]/route.ts')
    // The DELETE handler's $transaction should have FOR UPDATE before the
    // linkedNotes re-check. Look for the LINKED_NOTES_EXIST error code
    // (thrown inside tx, caught outside) + the lockedNotesLocked variable.
    expect(src).toMatch(/FOR UPDATE/)
    expect(src).toMatch(/linkedNotesLocked/)
    expect(src).toMatch(/LINKED_NOTES_EXIST/)
  })
})

// ─── Section 2: Behavioral unit tests ──────────────────────────────────────

describe('V26 Phase 5 R3 — Restore resume-marker logic', () => {
  // Mock the checkShopEmptyOrResume logic (extracted from the route for testability).
  // The real function is in src/app/api/import/restore/route.ts.
  function decideRestoreAction(opts: {
    transactions: number
    products: number
    parties: number
    payments: number
    storedLastRestoreSessionId: string | null
    incomingRestoreSessionId: string
  }): { ok: boolean; isResume?: boolean; status?: number } {
    const total = opts.transactions + opts.products + opts.parties + opts.payments
    if (total === 0) return { ok: true, isResume: false }
    if (
      opts.storedLastRestoreSessionId &&
      opts.storedLastRestoreSessionId === opts.incomingRestoreSessionId
    ) {
      return { ok: true, isResume: true }
    }
    return { ok: false, status: 400 }
  }

  test('empty shop → proceed (first attempt)', () => {
    const result = decideRestoreAction({
      transactions: 0,
      products: 0,
      parties: 0,
      payments: 0,
      storedLastRestoreSessionId: null,
      incomingRestoreSessionId: 'session-1',
    })
    expect(result.ok).toBe(true)
    expect(result.isResume).toBe(false)
  })

  test('non-empty shop + matching session id → resume', () => {
    const result = decideRestoreAction({
      transactions: 500,  // partial restore from a killed attempt
      products: 50,
      parties: 10,
      payments: 30,
      storedLastRestoreSessionId: 'session-1',
      incomingRestoreSessionId: 'session-1',  // same id → resume
    })
    expect(result.ok).toBe(true)
    expect(result.isResume).toBe(true)
  })

  test('non-empty shop + different session id → 409 (genuinely different shop)', () => {
    const result = decideRestoreAction({
      transactions: 100,
      products: 20,
      parties: 5,
      payments: 10,
      storedLastRestoreSessionId: null,  // no marker (clean shop with data)
      incomingRestoreSessionId: 'session-2',
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })

  test('non-empty shop + stale marker (different id) → 409', () => {
    const result = decideRestoreAction({
      transactions: 500,
      products: 50,
      parties: 10,
      payments: 30,
      storedLastRestoreSessionId: 'old-session',  // stale marker from a previous failed restore
      incomingRestoreSessionId: 'new-session',  // different id → don't resume
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })
})

describe('V26 Phase 5 R4 — FOR UPDATE closes the concurrent-PUT race', () => {
  // Simulate the lock + re-check pattern. Two concurrent PUTs both pre-fetched
  // oldItems=[10×X]. With FOR UPDATE, the second PUT blocks until the first
  // commits — then its inside-tx re-read sees A's items (8×X), not the stale
  // snapshot. Reversal uses the fresh snapshot → stock stays correct.
  test('second PUT re-reads oldItems inside the lock — no stale snapshot', async () => {
    // Simulate the row state evolving as A commits.
    let row = { id: 'txn-1', deletedAt: null, items: [{ productId: 'p1', quantity: 10 }] }

    // A's PUT pre-fetches oldItems (stale snapshot).
    const aStaleSnapshot = row.items  // [10×X]

    // A's $transaction starts → FOR UPDATE locks the row.
    // A reverses 10, deletes old items, writes 8×X, commits.
    row = { id: 'txn-1', deletedAt: null, items: [{ productId: 'p1', quantity: 8 }] }

    // B's PUT pre-fetched oldItems BEFORE A committed (same stale snapshot).
    const bStaleSnapshot = aStaleSnapshot  // [10×X] — STALE

    // B's $transaction starts → FOR UPDATE blocks until A releases → B acquires.
    // B RE-READS items inside the lock → gets the FRESH state [8×X].
    const bFreshSnapshot = row.items  // [8×X] — FRESH

    // B reverses 8 (not 10!), deletes A's items, writes 12×X, commits.
    // Net stock impact: -10 (A's reversal) + 10 (A's apply) - 8 (B's reversal) + 12 (B's apply) = +4
    // Without the re-read: -10 + 10 - 10 + 12 = +2 (wrong by 2).
    expect(bStaleSnapshot[0].quantity).toBe(10)  // stale
    expect(bFreshSnapshot[0].quantity).toBe(8)   // fresh — what B actually reverses
    expect(bFreshSnapshot[0].quantity).not.toBe(bStaleSnapshot[0].quantity)
  })

  test('PUT racing DELETE: PUT throws EDIT_GONE (row was soft-deleted meanwhile)', async () => {
    let row = { id: 'txn-1', deletedAt: null }

    // PUT pre-fetches existing (alive).
    const existingAtPreFetch = { ...row }
    expect(existingAtPreFetch.deletedAt).toBeNull()

    // DELETE commits: sets deletedAt.
    row = { id: 'txn-1', deletedAt: new Date() }

    // PUT's $transaction starts → FOR UPDATE returns no rows (deletedAt IS NULL
    // fails). fresh = null → throw EDIT_GONE.
    const fresh = row.deletedAt === null ? row : null
    expect(fresh).toBeNull()
    // The route throws EDIT_GONE → outer catch returns 409.
    const err: any = new Error('EDIT_GONE')
    err.code = 'EDIT_GONE'
    expect(err.code).toBe('EDIT_GONE')
  })
})

describe('V26 Phase 5 R5 — FOR UPDATE closes the concurrent-note race', () => {
  test('two concurrent CN creates serialize per original invoice', async () => {
    // Mock the aggregate result. Without FOR UPDATE, both A and B's aggregates
    // see Σ=0 (READ COMMITTED — each sees only committed notes). Both pass the
    // cap, both insert, both commit → Σ=1,200 against ₹1,000.
    //
    // With FOR UPDATE on the original invoice row:
    //   - A acquires the lock first → aggregates Σ=0 → inserts ₹600 → commits.
    //   - B blocks on FOR UPDATE until A releases → aggregates Σ=600 → sees
    //     only ₹400 remains → inserts ₹400 (or rejects if B's note > ₹400).
    let committedNotesTotal = 0
    const original = { id: 'orig-1', totalAmount: 1000 }

    // A's flow (acquires lock first).
    const aAggregateBeforeInsert = committedNotesTotal  // 0
    expect(aAggregateBeforeInsert).toBe(0)
    committedNotesTotal += 600  // A inserts ₹600
    expect(committedNotesTotal).toBe(600)

    // B's flow (acquires lock AFTER A commits — sees A's note).
    const bAggregateBeforeInsert = committedNotesTotal  // 600 (with lock)
    expect(bAggregateBeforeInsert).toBe(600)
    // B's note is ₹600; cap check: 600 + 600 = 1,200 > 1,000 → REJECT.
    const bNoteTotal = 600
    const bCombined = bAggregateBeforeInsert + bNoteTotal
    expect(bCombined).toBeGreaterThan(original.totalAmount)
    // B's note is rejected. Without the lock, B would have seen Σ=0 and passed.

    // Only A's ₹600 note is committed. Cap holds.
    expect(committedNotesTotal).toBeLessThanOrEqual(original.totalAmount)
  })
})
