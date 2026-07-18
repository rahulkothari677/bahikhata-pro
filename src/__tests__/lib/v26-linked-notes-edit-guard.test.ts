/**
 * 🔒 V26 N3 — Behavioral test for the original-invoice edit guard.
 *
 * The route handler at src/app/api/transactions/[id]/route.ts PUT must reject
 * edits that reduce an original sale/purchase's totalAmount below the sum of
 * its linked credit/debit notes. This prevents:
 *   - Phantom negative party balances (₹1000 sale, ₹800 CN, edit sale to ₹300
 *     → balance becomes −₹500; the app says "you owe the customer ₹500").
 *   - Over-reversed GST liability (CN reversed ₹800 of tax against a ₹300 sale).
 *
 * The cap is enforced on note create/edit (validateNoteAgainstOriginal) and
 * on original DELETE (linked-notes guard). N3 closes the missing PUT path.
 *
 * This is a behavioral test of the guard logic itself — not a full HTTP
 * integration test. The route handler delegates the check to a pure helper
 * which we exercise here with a stub DB.
 */

import { describe, test, expect } from '@jest/globals'
import { checkLinkedNotesCap } from '@/lib/linked-notes-guard'

function stubDb(linkedNotesTotal: number) {
  return {
    transaction: {
      async aggregate() {
        return { _sum: { totalAmount: linkedNotesTotal } }
      },
    },
  }
}

describe('🔒 V26 N3 — Original-invoice edit guard (PUT)', () => {
  test('rejects edit when linked notes total exceeds new invoice total', async () => {
    // Worked example from the audit: ₹1000 sale, ₹800 CN, edit sale to ₹300.
    const res = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 300, 'sale')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(400)
      expect(res.message).toContain('800.00')
      expect(res.message).toContain("can't be reduced")
    }
  })

  test('allows edit when new total equals linked notes total (exactly at cap)', async () => {
    // ₹1000 sale, ₹800 CN, edit sale to ₹800 → exactly at cap, allowed.
    const res = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 800, 'sale')
    expect(res.ok).toBe(true)
  })

  test('allows edit when new total is above the linked notes total', async () => {
    // ₹1000 sale, ₹800 CN, edit sale to ₹900 → still has headroom, allowed.
    const res = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 900, 'sale')
    expect(res.ok).toBe(true)
  })

  test('allows edit when there are NO linked notes', async () => {
    // ₹1000 sale, no notes, edit to any value → allowed.
    const res = await checkLinkedNotesCap(stubDb(0) as any, 'txn1', 100, 'sale')
    expect(res.ok).toBe(true)
  })

  test('allows edit when new total is unchanged (no spurious block)', async () => {
    // ₹1000 sale, ₹800 CN, edit sale to ₹1000 (same total) → allowed.
    const res = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 1000, 'sale')
    expect(res.ok).toBe(true)
  })

  test('guard applies to purchases too (debit notes)', async () => {
    // ₹1000 purchase, ₹800 DN, edit purchase to ₹300 → blocked.
    const res = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 300, 'purchase')
    expect(res.ok).toBe(false)
  })

  test('guard is skipped for credit notes and debit notes (notes have no notes against them)', async () => {
    // Editing a credit/debit note itself never triggers this guard.
    const res1 = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 100, 'credit-note')
    expect(res1.ok).toBe(true)
    const res2 = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 100, 'debit-note')
    expect(res2.ok).toBe(true)
  })

  test('guard is skipped for income/expense (not original-supply types)', async () => {
    const res1 = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 100, 'income')
    expect(res1.ok).toBe(true)
    const res2 = await checkLinkedNotesCap(stubDb(800) as any, 'txn1', 100, 'expense')
    expect(res2.ok).toBe(true)
  })

  test('aggregate excludes soft-deleted notes (deletedAt: null filter)', async () => {
    // The guard's `where` clause must include `deletedAt: null` so voided notes
    // don't count toward the cap. We verify this by inspecting the call args.
    let capturedWhere: any
    const stub = {
      transaction: {
        async aggregate(args: any) {
          capturedWhere = args.where
          return { _sum: { totalAmount: 0 } }
        },
      },
    }
    await checkLinkedNotesCap(stub as any, 'txn1', 500, 'sale')
    expect(capturedWhere.deletedAt).toBeNull()
    expect(capturedWhere.originalTransactionId).toBe('txn1')
    expect(capturedWhere.type).toEqual({ in: ['credit-note', 'debit-note'] })
  })
})
