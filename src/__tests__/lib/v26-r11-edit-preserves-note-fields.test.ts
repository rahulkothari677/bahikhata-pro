/**
 * 🔒 R11-4 (Round 11) behavioral test — EditTransactionDialog must not
 * silently reset credit/debit note fields.
 *
 * The bug: the EditTransactionDialog doesn't show affectsStock / noteReason /
 * noteType / originalTransactionId fields (they're set at creation time). So
 * the PUT body omits them. The OLD zod schema had `.default(false)` on
 * affectsStock, which meant undefined → false. The server then wrote
 * `affectsStock: false` to the DB, and the stock-reversal logic computed the
 * wrong net change (existing increments stock, new doesn't → stock decreases
 * by the note amount → corrupted stock).
 *
 * The fix has two parts:
 *   1. The UPDATE zod schema no longer has `.default(false)` on affectsStock.
 *      Undefined stays undefined.
 *   2. The server falls back to the EXISTING value when the field is undefined.
 *
 * This test locks both:
 *   - The schema doesn't apply a default (undefined stays undefined).
 *   - The server-side merge preserves existing values when undefined.
 */

import { updateTransactionSchema, createTransactionSchema } from '@/lib/validation'

describe('🔒 R11-4 — Edit must not reset credit/debit note fields', () => {
  describe('UPDATE schema (zod)', () => {
    test('affectsStock has NO default — undefined stays undefined', () => {
      // Minimal valid update body (no affectsStock field).
      const body = {
        type: 'credit-note' as const,
        items: [],
      }
      const parsed = updateTransactionSchema.parse(body)
      // Before the fix: parsed.affectsStock was `false` (from .default(false)).
      // After the fix: parsed.affectsStock is `undefined` (no default).
      expect(parsed.affectsStock).toBeUndefined()
    })

    test('noteReason has NO default — undefined stays undefined', () => {
      const body = {
        type: 'credit-note' as const,
        items: [],
      }
      const parsed = updateTransactionSchema.parse(body)
      expect(parsed.noteReason).toBeUndefined()
    })

    test('noteType has NO default — undefined stays undefined', () => {
      const body = {
        type: 'credit-note' as const,
        items: [],
      }
      const parsed = updateTransactionSchema.parse(body)
      expect(parsed.noteType).toBeUndefined()
    })

    test('originalTransactionId has NO default — undefined stays undefined', () => {
      const body = {
        type: 'credit-note' as const,
        items: [],
      }
      const parsed = updateTransactionSchema.parse(body)
      expect(parsed.originalTransactionId).toBeUndefined()
    })

    test('affectsStock is still parsed correctly when provided', () => {
      const body = {
        type: 'credit-note' as const,
        items: [],
        affectsStock: true,
      }
      const parsed = updateTransactionSchema.parse(body)
      expect(parsed.affectsStock).toBe(true)
    })

    test('affectsStock: false is preserved when explicitly sent', () => {
      const body = {
        type: 'credit-note' as const,
        items: [],
        affectsStock: false,
      }
      const parsed = updateTransactionSchema.parse(body)
      expect(parsed.affectsStock).toBe(false)
    })
  })

  describe('CREATE schema (zod) — keeps the default for new transactions', () => {
    test('affectsStock still defaults to false on CREATE (no regression)', () => {
      // The CREATE schema MUST keep .default(false) — new transactions need a
      // concrete value. Only the UPDATE schema drops the default.
      const body = {
        type: 'credit-note' as const,
        items: [],
      }
      const parsed = createTransactionSchema.parse(body)
      expect(parsed.affectsStock).toBe(false)
    })
  })

  describe('Server-side merge logic (the data-shape the route uses)', () => {
    // This is a pure-function test of the merge logic the route uses.
    // The route code is:
    //   affectsStock: affectsStock !== undefined ? affectsStock : (existing.affectsStock ?? false)
    // We replicate that logic here and verify it preserves existing values.

    function mergeNoteFields(
      parsed: {
        originalTransactionId?: string | null
        noteType?: 'C' | 'D'
        noteReason?: string | null
        affectsStock?: boolean
      },
      existing: {
        originalTransactionId?: string | null
        noteType?: 'C' | 'D' | null
        noteReason?: string | null
        affectsStock?: boolean | null
      },
    ) {
      return {
        originalTransactionId:
          parsed.originalTransactionId !== undefined
            ? (parsed.originalTransactionId || null)
            : existing.originalTransactionId,
        noteType:
          parsed.noteType !== undefined ? parsed.noteType : existing.noteType,
        noteReason:
          parsed.noteReason !== undefined
            ? (parsed.noteReason || null)
            : existing.noteReason,
        affectsStock:
          parsed.affectsStock !== undefined
            ? parsed.affectsStock
            : (existing.affectsStock ?? false),
      }
    }

    test('preserves existing affectsStock=true when client omits the field', () => {
      // The exact bug scenario: a credit note with affectsStock=true is edited.
      // The edit dialog omits affectsStock → parsed value is undefined.
      // The merge must keep affectsStock=true.
      const parsed = updateTransactionSchema.parse({
        type: 'credit-note' as const,
        items: [],
        notes: 'updated notes',
      })
      const existing = { affectsStock: true, noteReason: 'return' as const, noteType: 'C' as const, originalTransactionId: 'txn-123' }
      const merged = mergeNoteFields(parsed, existing)
      expect(merged.affectsStock).toBe(true)
      expect(merged.noteReason).toBe('return')
      expect(merged.noteType).toBe('C')
      expect(merged.originalTransactionId).toBe('txn-123')
    })

    test('overwrites when client explicitly sends a value', () => {
      const parsed = updateTransactionSchema.parse({
        type: 'credit-note' as const,
        items: [],
        affectsStock: false,
        noteReason: 'deficiency',
      })
      const existing = { affectsStock: true, noteReason: 'return' as const, noteType: 'C' as const, originalTransactionId: 'txn-123' }
      const merged = mergeNoteFields(parsed, existing)
      // Client explicitly turned off stock adjustment — respect it.
      expect(merged.affectsStock).toBe(false)
      expect(merged.noteReason).toBe('deficiency')
      // noteType + originalTransactionId still preserved (client didn't send them).
      expect(merged.noteType).toBe('C')
      expect(merged.originalTransactionId).toBe('txn-123')
    })

    test('falls back to false when existing is null AND client omits', () => {
      // A brand-new credit note that somehow has affectsStock=null in DB
      // (shouldn't happen, but defensive). Client omits the field.
      const parsed = updateTransactionSchema.parse({
        type: 'credit-note' as const,
        items: [],
      })
      const existing = { affectsStock: null, noteReason: null, noteType: null, originalTransactionId: null }
      const merged = mergeNoteFields(parsed, existing)
      expect(merged.affectsStock).toBe(false)
    })
  })
})
