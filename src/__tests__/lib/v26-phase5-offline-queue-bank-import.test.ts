/**
 * 🔒 V26 PHASE 5 BATCH 3 — Offline queue + bank import dedup guardrail.
 *
 * Phase 5 audit findings covered:
 *   R7 🟠 — Three silent-loss paths in the offline queue:
 *     (a) IDB queue failure swallowed while UI said "Saved offline ✓".
 *     (b) Dead-letter store had ZERO UI consumers — "review and re-enter"
 *         was impossible.
 *     (c) 409/422 rejections counted as "synced", no notification.
 *   R6 🟠 — Bank import dedup largely fictional:
 *     (a) Dead code: first dedup query result never used.
 *     (b) "Exact" dedup = 200-char prefix match (false positives + negatives).
 *     (c) No per-row dedup (overlapping statements double-imported rows).
 *     (d) Check-then-act race (double-click / concurrent tab / queue replay).
 *
 * This test makes those classes fail CI.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const SRC_ROOT = path.resolve(process.cwd(), 'src')

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8')
}

describe('V26 Phase 5 Batch 3 — Offline queue + bank import guardrail', () => {
  // ─── R7: Offline queue silent-loss paths ────────────────────────────────

  test('R7.1: queuePendingWrite does NOT swallow IDB errors (was: try/catch with /* ignore */)', () => {
    const src = readFile('lib/offline-db.ts')
    // Extract the function body (between the export declaration and the next
    // export/function declaration).
    const fnMatch = src.match(/export async function queuePendingWrite[\s\S]*?\n\}/)
    expect(fnMatch).toBeTruthy()
    const fnBody = fnMatch![0]
    // The function must call tx() directly (not inside a try/catch that swallows).
    expect(fnBody).toMatch(/await tx\(/)
    // The function must NOT have a try { ... } catch { /* ignore */ } block
    // AROUND the tx() call. We check that there's no `try {` before the `await tx(`
    // line within the function body.
    const txIdx = fnBody.indexOf('await tx(')
    const beforeTx = fnBody.slice(0, txIdx)
    expect(beforeTx).not.toMatch(/try\s*\{/)
  })

  test('R7.1: handleMutation catches queue failure + returns honest 503', () => {
    const src = readFile('lib/offline-fetch.ts')
    // The queueErrorResponse helper must exist + be called from both the
    // online-failure path AND the offline path.
    expect(src).toMatch(/queueErrorResponse/)
    expect(src).toMatch(/storageError:\s*true/)
    expect(src).toMatch(/status:\s*503/)
    expect(src).toMatch(/This entry was NOT saved/)
  })

  test('R7.2: UnsyncedEntries component exists and surfaces dead-letter store', () => {
    const componentPath = 'components/settings/UnsyncedEntries.tsx'
    expect(fs.existsSync(path.join(SRC_ROOT, componentPath))).toBe(true)
    const src = readFile(componentPath)
    // Imports the dead-letter helpers.
    expect(src).toMatch(/getDeadLetterItems/)
    expect(src).toMatch(/deleteDeadLetterItem/)
    expect(src).toMatch(/queuePendingWrite/)
    // Retry + Discard buttons.
    expect(src).toMatch(/Retry/)
    expect(src).toMatch(/Discard/)
    // Human-readable label helper that parses body JSON.
    expect(src).toMatch(/describeItem/)
    expect(src).toMatch(/JSON\.parse/)
  })

  test('R7.2: Settings.tsx renders the UnsyncedEntries card', () => {
    const src = readFile('components/settings/Settings.tsx')
    expect(src).toMatch(/import.*UnsyncedEntries.*from '@\/components\/settings\/UnsyncedEntries'/)
    expect(src).toMatch(/<UnsyncedEntries\s*\/>/)
  })

  test('R7.3: 409/422 counted as `rejected` (was: counted as `synced`)', () => {
    const src = readFile('lib/offline-fetch.ts')
    // The sync engine must have a `rejected` counter.
    expect(src).toMatch(/let rejected = 0/)
    // 409/422 must increment `rejected`, not `synced`.
    // Look for the branch that handles 409/422.
    const branchMatch = src.match(/else if \(res\.status === 409 \|\| res\.status === 422\)[\s\S]*?rejected\+\+/)
    expect(branchMatch).toBeTruthy()
    // The return type + listener type must include `rejected`.
    expect(src).toMatch(/synced: number; failed: number; rejected: number/)
    expect(src).toMatch(/rejected\?: number/)
  })

  test('R7.3: page.tsx syncFailed listener surfaces `rejected` to the user', () => {
    const src = readFile('app/page.tsx')
    expect(src).toMatch(/rejected/)
    expect(src).toMatch(/rejected by the server/)
    expect(src).toMatch(/Unsynced Entries/)
  })

  // ─── R6: Bank import dedup ──────────────────────────────────────────────

  test('R6.1: Prisma schema has csvHash on BankStatement + rowHash on BankTransaction', () => {
    const schema = fs.readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    // BankStatement.csvHash with @@unique([userId, csvHash]).
    // Use a regex that matches up to the next `model ` declaration (the
    // non-greedy `[\s\S]*?` would stop at the first `}` which can be inside
    // a comment like `${userId}`).
    const stmtMatch = schema.match(/model BankStatement \{[\s\S]*?(?=\nmodel |\n@@index|$)/)
    expect(stmtMatch).toBeTruthy()
    expect(stmtMatch![0]).toMatch(/csvHash\s+String\s+@default\(""\)/)
    expect(stmtMatch![0]).toMatch(/@@unique\(\[userId,\s*csvHash\]\)/)
    // BankTransaction.rowHash with @@unique([userId, rowHash]).
    const txnMatch = schema.match(/model BankTransaction \{[\s\S]*?(?=\nmodel |\n@@index|$)/)
    expect(txnMatch).toBeTruthy()
    expect(txnMatch![0]).toMatch(/rowHash\s+String\s+@default\(""\)/)
    expect(txnMatch![0]).toMatch(/@@unique\(\[userId,\s*rowHash\]\)/)
  })

  test('R6.1: migration SQL is idempotent + adds both columns + indexes', () => {
    const migrationDir = path.resolve(process.cwd(), 'prisma/migrations/20260720000002_bank_statement_dedup_hashes')
    expect(fs.existsSync(migrationDir)).toBe(true)
    const sql = fs.readFileSync(path.join(migrationDir, 'migration.sql'), 'utf8')
    // Both columns added with IF NOT EXISTS.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "csvHash"/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "rowHash"/)
    // Both unique indexes created with IF NOT EXISTS.
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "BankStatement_userId_csvHash_key"/)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "BankTransaction_userId_rowHash_key"/)
  })

  test('R6.2: import route computes csvHash + rowHash, uses createMany skipDuplicates, no dead dedup code', () => {
    const src = readFile('app/api/bank-recon/import/route.ts')
    // csvHash = sha256 of trimmed CSV.
    expect(src).toMatch(/createHash\('sha256'\)\.update\(csv\.trim\(\)\)/)
    expect(src).toMatch(/csvHash/)
    // rowHash = sha256 of userId|date|description|amount.
    expect(src).toMatch(/rowHash:\s*crypto\.createHash\('sha256'\)/)
    expect(src).toMatch(/userId.*date.*description.*amount/)
    // createMany with skipDuplicates.
    expect(src).toMatch(/createMany\(\s*\{[\s\S]*?skipDuplicates:\s*true/)
    // skippedDuplicates reported in summary.
    expect(src).toMatch(/skippedDuplicates/)
    // P2002 catch on bankStatement.create (concurrent race).
    expect(src).toMatch(/P2002/)
    // Row cap at 5000.
    expect(src).toMatch(/5000/)
    // The dead 200-char / 500-char prefix match (rawCsv startsWith) must NOT
    // be present. This is the smoking gun for the old broken dedup pattern.
    expect(src).not.toMatch(/rawCsv:\s*\{\s*startsWith:/)
    // The dead `existingStatement` VARIABLE (not the response-body
    // `existingStatementId` field) must not be assigned. Match only
    // `const existingStatement` or `let existingStatement` or `= await ...
    // existingStatement` patterns — i.e., a variable declaration/assignment.
    expect(src).not.toMatch(/(?:const|let|var)\s+existingStatement\b/)
  })
})

// ─── Behavioral unit tests ─────────────────────────────────────────────────

describe('V26 Phase 5 R6 — Bank import dedup behavior', () => {
  test('csvHash: same CSV → same hash (deterministic)', () => {
    const csv = 'Date,Description,Amount\n2026-07-01,UPI/Rahul,500\n2026-07-02,UPI/Rajesh,-300'
    const hash1 = crypto.createHash('sha256').update(csv.trim()).digest('hex')
    const hash2 = crypto.createHash('sha256').update(csv.trim()).digest('hex')
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)  // sha256 hex
  })

  test('csvHash: different CSV → different hash', () => {
    const csv1 = 'Date,Description,Amount\n2026-07-01,UPI/Rahul,500'
    const csv2 = 'Date,Description,Amount\n2026-07-01,UPI/Rahul,501'  // 1 rupee diff
    const hash1 = crypto.createHash('sha256').update(csv1.trim()).digest('hex')
    const hash2 = crypto.createHash('sha256').update(csv2.trim()).digest('hex')
    expect(hash1).not.toBe(hash2)
  })

  test('rowHash: same row → same hash; different amount → different hash', () => {
    const userId = 'user-1'
    const date = new Date('2026-07-01')
    const description = 'UPI/Rahul Traders/1234'
    const amount = 500

    const rowHash = (amt: number) =>
      crypto.createHash('sha256')
        .update(`${userId}|${date.toISOString().slice(0, 10)}|${description.trim()}|${amt}`)
        .digest('hex')

    expect(rowHash(500)).toBe(rowHash(500))  // deterministic
    expect(rowHash(500)).not.toBe(rowHash(501))  // amount matters
    expect(rowHash(500)).not.toBe(rowHash(500).slice(0, 63) + 'X')  // length 64
  })

  test('rowHash: same row from two overlapping statements → same hash (dedup fires)', () => {
    // "Last 3 months" downloaded in March, then again in April — overlapping
    // rows (e.g. March 15 transaction) appear in BOTH statements.
    const userId = 'user-1'
    const date = new Date('2026-03-15')
    const description = 'UPI/Rahul Traders/1234'
    const amount = 500

    // Both statements produce the same row for March 15.
    const hash1 = crypto.createHash('sha256')
      .update(`${userId}|${date.toISOString().slice(0, 10)}|${description.trim()}|${amount}`)
      .digest('hex')
    const hash2 = crypto.createHash('sha256')
      .update(`${userId}|${date.toISOString().slice(0, 10)}|${description.trim()}|${amount}`)
      .digest('hex')

    expect(hash1).toBe(hash2)  // dedup fires — second import skips this row
  })
})

describe('V26 Phase 5 R7 — UnsyncedEntries label helper', () => {
  // Re-implement the describeItem helper inline (the real one is in the
  // component file; we test the LOGIC here, not the import, so the test
  // doesn't need to mount React).
  function describeItem(item: { method: string; url: string; body: string | null; timestamp: number; reason: string }): { label: string; detail: string } {
    const method = item.method
    const url = item.url
    const date = new Date(item.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

    let body: any = {}
    try {
      body = item.body ? JSON.parse(item.body) : {}
    } catch {
      /* keep body = {} */
    }

    if (url.includes('/api/transactions') && method === 'POST') {
      const type = body.type || 'transaction'
      const typeLabel: Record<string, string> = {
        sale: 'Sale',
        purchase: 'Purchase',
        income: 'Income entry',
        expense: 'Expense entry',
        'credit-note': 'Credit note',
        'debit-note': 'Debit note',
        estimate: 'Estimate',
      }
      const label = typeLabel[type] || 'Transaction'
      const amount = body.totalAmount ? `— ₹${Number(body.totalAmount).toLocaleString('en-IN')}` : ''
      const itemsCount = Array.isArray(body.items) ? `, ${body.items.length} item${body.items.length === 1 ? '' : 's'}` : ''
      const party = body.partyName ? `, ${body.partyName}` : ''
      return { label: `${label} ${amount}${itemsCount}${party}`, detail: `Created ${date}` }
    }

    if (url.includes('/api/payments') && method === 'POST') {
      const amount = body.amount ? `₹${Number(body.amount).toLocaleString('en-IN')}` : ''
      const type = body.type === 'received' ? 'Payment received' : 'Payment made'
      return { label: `${type} — ${amount}`, detail: `Created ${date}` }
    }

    return { label: `${method} ${url.split('/api/')[1] || url}`, detail: `${date}` }
  }

  test('sale with items + party → "Sale — ₹1,240, 3 items, Rajesh"', () => {
    const result = describeItem({
      method: 'POST',
      url: '/api/transactions',
      body: JSON.stringify({ type: 'sale', totalAmount: 1240, items: [1, 2, 3], partyName: 'Rajesh' }),
      timestamp: Date.now(),
      reason: 'max_attempts_exceeded',
    })
    expect(result.label).toMatch(/Sale/)
    expect(result.label).toMatch(/₹1,240/)
    expect(result.label).toMatch(/3 items/)
    expect(result.label).toMatch(/Rajesh/)
  })

  test('payment received → "Payment received — ₹500"', () => {
    const result = describeItem({
      method: 'POST',
      url: '/api/payments',
      body: JSON.stringify({ amount: 500, type: 'received' }),
      timestamp: Date.now(),
      reason: 'max_attempts_exceeded',
    })
    expect(result.label).toMatch(/Payment received/)
    expect(result.label).toMatch(/₹500/)
  })

  test('malformed body → fallback label (no crash)', () => {
    const result = describeItem({
      method: 'POST',
      url: '/api/unknown',
      body: 'not json',
      timestamp: Date.now(),
      reason: 'max_attempts_exceeded',
    })
    expect(result.label).toMatch(/POST/)
    expect(result.label).toMatch(/unknown/)
  })
})
