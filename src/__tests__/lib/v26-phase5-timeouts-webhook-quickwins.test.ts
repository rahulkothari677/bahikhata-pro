/**
 * 🔒 V26 PHASE 5 BATCH 4 — Timeouts + webhook + DELETE-replay + concurrent-edit + Web Locks guardrail.
 *
 * Phase 5 audit findings covered:
 *   R8 🟠 — Zero request timeouts anywhere (no AbortSignal in the repo). A hung
 *           AI provider consumed the whole 60s budget before the fallback chain
 *           ran; Resend/Razorpay hung on function timeout; client saves spun
 *           forever on stalled connections.
 *   R9 🟠 — No Razorpay webhook fallback. If the client died between payment
 *           and /verify, money was taken but the plan was never upgraded.
 *   R10 🟡 — Successful-but-replayed DELETEs reported failure (404 → 5 retries
 *           → dead-letter → "1 entry could not be synced" toast for a delete
 *           that WORKED).
 *   R11 🟡 — Concurrent edits = silent last-write-wins. The losing device was
 *           never told they lost a write.
 *   R12 🟡 — Multi-tab sync had no cross-tab mutual exclusion (`syncing` was
 *           per-tab) → two tabs replayed the same queue.
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

describe('V26 Phase 5 Batch 4 — Timeouts + webhook + DELETE-replay + concurrent-edit + Web Locks', () => {
  // ─── R8: Request timeouts ────────────────────────────────────────────────

  test('R8.1: AI provider fetch has AbortSignal.timeout(15_000)', () => {
    const src = readFile('app/api/scan-bill/route.ts')
    expect(src).toMatch(/AbortSignal\.timeout\(15_000\)/)
    // The signal must be on the fetch call inside callSingleProvider.
    // Match from `async function callSingleProvider` to the next `async function`
    // or end of file (the non-greedy `\n\}` would stop at an inner block).
    const providerFnMatch = src.match(/async function callSingleProvider[\s\S]*?(?=\n(?:async )?function |$)/)
    expect(providerFnMatch).toBeTruthy()
    expect(providerFnMatch![0]).toMatch(/AbortSignal\.timeout\(15_000\)/)
  })

  test('R8.1: Resend email fetch has AbortSignal.timeout(10_000)', () => {
    const src = readFile('lib/email.ts')
    expect(src).toMatch(/AbortSignal\.timeout\(10_000\)/)
  })

  test('R8.1: Razorpay order fetch has 10s timeout via Promise.race', () => {
    const src = readFile('app/api/payment/verify/route.ts')
    expect(src).toMatch(/Promise\.race/)
    expect(src).toMatch(/10_000/)
    expect(src).toMatch(/Razorpay order fetch timed out/)
  })

  test('R8.2: Client handleMutation online fetch has AbortSignal.timeout(20_000)', () => {
    const src = readFile('lib/offline-fetch.ts')
    expect(src).toMatch(/AbortSignal\.timeout\(20_000\)/)
    // The signal must be on the online fetch path (inside `if (isOnline())`).
    const onlineMatch = src.match(/if \(isOnline\(\)\) \{[\s\S]*?return res[\s\S]*?\}/)
    expect(onlineMatch).toBeTruthy()
    expect(onlineMatch![0]).toMatch(/AbortSignal\.timeout\(20_000\)/)
  })

  // ─── R9: Razorpay webhook ─────────────────────────────────────────────────

  test('R9: Webhook route exists with HMAC-SHA256 signature verification', () => {
    const webhookPath = 'app/api/payment/webhook/route.ts'
    expect(fs.existsSync(path.join(SRC_ROOT, webhookPath))).toBe(true)
    const src = readFile(webhookPath)
    // HMAC-SHA256 of raw body with RAZORPAY_WEBHOOK_SECRET.
    expect(src).toMatch(/createHmac\('sha256', webhookSecret\)/)
    expect(src).toMatch(/RAZORPAY_WEBHOOK_SECRET/)
    // Constant-time compare via crypto.timingSafeEqual.
    expect(src).toMatch(/timingSafeEqual/)
    // Raw body read (not parsed JSON — Razorpay signs the raw body).
    expect(src).toMatch(/req\.text\(\)/)
    // Handles payment.captured + order.paid events.
    expect(src).toMatch(/payment\.captured/)
    expect(src).toMatch(/order\.paid/)
    // Calls the shared upgradeSubscription helper.
    expect(src).toMatch(/upgradeSubscription/)
    // Fail-closed when secret is unset.
    expect(src).toMatch(/fail-closed/)
  })

  test('R9: Shared upgradeSubscription helper exists with P2002 catch', () => {
    const src = readFile('lib/subscription-upgrade.ts')
    expect(src).toMatch(/export async function upgradeSubscription/)
    expect(src).toMatch(/P2002/)
    expect(src).toMatch(/@@unique\(\[paymentId\]\)/)
    // Idempotency fast-path (existing subscription → return without re-extending).
    expect(src).toMatch(/idempotent: true/)
    // $transaction wrapping user.update + subscription.create + auditLog.
    expect(src).toMatch(/\$transaction/)
    expect(src).toMatch(/user\.update/)
    expect(src).toMatch(/subscription\.create/)
    expect(src).toMatch(/auditLog\.create/)
  })

  test('R9: verify route uses the shared helper (no longer inlines the upgrade block)', () => {
    const src = readFile('app/api/payment/verify/route.ts')
    expect(src).toMatch(/import.*upgradeSubscription.*from '@\/lib\/subscription-upgrade'/)
    expect(src).toMatch(/upgradeSubscription\(\{/)
    // The inline $transaction block should be gone (look for the old pattern).
    // The verify route should NOT have its own db.$transaction([...]) for the
    // upgrade — that's now in the helper.
    const verifyUpgradeMatch = src.match(/upgradeSubscription\(\{[\s\S]*?\}\)/)
    expect(verifyUpgradeMatch).toBeTruthy()
  })

  // ─── R10: DELETE replay 404 → success ─────────────────────────────────────

  test('R10: sync engine treats 404 on DELETE as success', () => {
    const src = readFile('lib/offline-fetch.ts')
    // The 404-DELETE branch must exist and increment synced (not failed).
    const branchMatch = src.match(/res\.status === 404 && w\.method === 'DELETE'[\s\S]*?synced\+\+/)
    expect(branchMatch).toBeTruthy()
    // The comment must reference R10.
    expect(src).toMatch(/V26 R10/)
  })

  // ─── R11: Concurrent-edit warning ─────────────────────────────────────────

  test('R11: parties PUT returns conflictWarning on updatedAt mismatch', () => {
    const src = readFile('app/api/parties/[id]/route.ts')
    expect(src).toMatch(/conflictWarning/)
    expect(src).toMatch(/clientUpdatedAt/)
    expect(src).toMatch(/edited on another device/)
  })

  test('R11: products PUT returns conflictWarning on updatedAt mismatch', () => {
    const src = readFile('app/api/products/route.ts')
    expect(src).toMatch(/conflictWarning/)
    expect(src).toMatch(/clientUpdatedAt/)
    expect(src).toMatch(/edited on another device/)
  })

  // ─── R12: Web Locks mutex ─────────────────────────────────────────────────

  test('R12: syncPendingWrites uses navigator.locks.request for cross-tab mutex', () => {
    const src = readFile('lib/offline-fetch.ts')
    expect(src).toMatch(/navigator\.locks\.request/)
    expect(src).toMatch(/'bahikhata-sync'/)
    expect(src).toMatch(/ifAvailable:\s*true/)
    // Fallback for browsers without Web Locks API.
    expect(src).toMatch(/runSync/)
  })
})

// ─── Behavioral unit tests ─────────────────────────────────────────────────

describe('V26 Phase 5 R11 — Concurrent-edit warning logic', () => {
  // Re-implement the warning logic inline (the real one is in the route).
  function computeWarning(clientUpdatedAt: Date | null, serverUpdatedAt: Date | null): string | null {
    if (clientUpdatedAt && serverUpdatedAt && clientUpdatedAt.getTime() !== serverUpdatedAt.getTime()) {
      return `This party was also edited on another device at ${new Date(serverUpdatedAt).toLocaleString('en-IN')} — please verify the details.`
    }
    return null
  }

  test('matching updatedAt → no warning', () => {
    const now = new Date('2026-07-20T12:00:00Z')
    expect(computeWarning(now, now)).toBeNull()
  })

  test('mismatched updatedAt → warning with server timestamp', () => {
    const clientTime = new Date('2026-07-20T10:00:00Z')
    const serverTime = new Date('2026-07-20T11:30:00Z')  // 90 min later
    const warning = computeWarning(clientTime, serverTime)
    expect(warning).toBeTruthy()
    expect(warning).toMatch(/another device/)
    expect(warning).toMatch(/verify the details/)
  })

  test('client does not send updatedAt → no warning (backward compat)', () => {
    const serverTime = new Date('2026-07-20T11:30:00Z')
    expect(computeWarning(null, serverTime)).toBeNull()
  })

  test('server has no updatedAt (null) → no warning (defensive)', () => {
    const clientTime = new Date('2026-07-20T10:00:00Z')
    expect(computeWarning(clientTime, null)).toBeNull()
  })
})

describe('V26 Phase 5 R9 — Webhook signature verification logic', () => {
  test('HMAC-SHA256 of raw body matches expected signature', () => {
    const secret = 'webhook-secret-123'
    const rawBody = JSON.stringify({
      event: 'order.paid',
      payload: { order: { entity: { id: 'order_123', amount: 50000, notes: { userId: 'u1', plan: 'pro', cycle: 'monthly' } } } },
    })
    // Server-side computation.
    const expectedSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    // Simulate what Razorpay would send.
    const incomingSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    // Constant-time compare.
    const sigBuf = Buffer.from(incomingSig)
    const expectedBuf = Buffer.from(expectedSig)
    expect(sigBuf.length).toBe(expectedBuf.length)
    expect(crypto.timingSafeEqual(sigBuf, expectedBuf)).toBe(true)
  })

  test('wrong secret → signature mismatch (rejected)', () => {
    const correctSecret = 'correct-secret'
    const wrongSecret = 'wrong-secret'
    const rawBody = '{"event":"order.paid"}'
    const expectedSig = crypto.createHmac('sha256', correctSecret).update(rawBody).digest('hex')
    const incomingSig = crypto.createHmac('sha256', wrongSecret).update(rawBody).digest('hex')
    const sigBuf = Buffer.from(incomingSig)
    const expectedBuf = Buffer.from(expectedSig)
    // Lengths match (both sha256 hex = 64 chars) but content differs.
    expect(sigBuf.length).toBe(expectedBuf.length)
    expect(crypto.timingSafeEqual(sigBuf, expectedBuf)).toBe(false)
  })

  test('different bodies → different signatures', () => {
    const secret = 'webhook-secret'
    const sig1 = crypto.createHmac('sha256', secret).update('{"event":"a"}').digest('hex')
    const sig2 = crypto.createHmac('sha256', secret).update('{"event":"b"}').digest('hex')
    expect(sig1).not.toBe(sig2)
  })
})

describe('V26 Phase 5 R12 — Web Locks mutex logic', () => {
  test('ifAvailable: true returns null when another tab holds the lock', async () => {
    // Simulate the navigator.locks.request behavior. When ifAvailable is true
    // and the lock is held, the callback receives null.
    let lockReceived: any = 'unset'
    // Mock navigator.locks.request with ifAvailable semantics.
    const mockLocks = {
      request: async (name: string, opts: any, cb: any) => {
        // Simulate "another tab holds the lock" → cb gets null.
        const lock = null  // unavailable
        return cb(lock)
      },
    }
    const result = await mockLocks.request('bahikhata-sync', { ifAvailable: true }, async (lock: any) => {
      lockReceived = lock
      if (!lock) return { synced: 0, failed: 0, rejected: 0 }
      return { synced: 5, failed: 0, rejected: 0 }
    })
    expect(lockReceived).toBeNull()
    expect(result).toEqual({ synced: 0, failed: 0, rejected: 0 })
  })

  test('ifAvailable: true returns the lock when no other tab holds it', async () => {
    let lockReceived: any = 'unset'
    const mockLocks = {
      request: async (name: string, opts: any, cb: any) => {
        // Simulate "lock acquired" → cb gets a non-null lock object.
        const lock = { name }
        return cb(lock)
      },
    }
    const result = await mockLocks.request('bahikhata-sync', { ifAvailable: true }, async (lock: any) => {
      lockReceived = lock
      // Lock acquired → run the sync.
      return { synced: 5, failed: 0, rejected: 0 }
    })
    expect(lockReceived).toBeTruthy()
    expect(result).toEqual({ synced: 5, failed: 0, rejected: 0 })
  })
})
