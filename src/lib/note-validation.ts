/**
 * 🔒 AUDIT V24 §2: Credit/debit note validation against the original invoice.
 *
 * THE BUG THIS FIXES: `originalTransactionId` was stored exactly as the client
 * sent it — no ownership check, no type check, no party check, and no cap. You
 * could issue a ₹5,000 credit note against a ₹1,000 sale (or credit the same
 * sale five times), driving the customer's balance negative and silently
 * reversing more revenue/GST than was ever booked — which understates the
 * filed GSTR-1/3B by the excess. A cross-tenant id also passed the FK check
 * and leaked the other tenant's invoice header via the detail view's
 * `include: originalTransaction`.
 *
 * RULES ENFORCED (only when originalTransactionId is provided — standalone
 * notes without a linked original remain allowed):
 *   1. The original exists, belongs to this user, and is not voided.
 *   2. Type pairing: credit-note → sale, debit-note → purchase.
 *   3. Same party (a note against invoice X must credit/debit X's party).
 *   4. Cumulative cap: Σ(existing non-voided notes of this type against the
 *      original) + this note ≤ original.totalAmount (+₹0.01 float tolerance).
 *
 * The `db` handle is injected so the rules are behaviorally testable with a
 * stub (per the "no text-grep tests" audit protocol).
 */

import { roundMoney } from './money'

export interface NoteValidationInput {
  userId: string
  type: string                       // 'credit-note' | 'debit-note'
  partyId: string | null
  originalTransactionId: string
  noteTotal: number                  // this note's computed totalAmount (₹)
  excludeNoteId?: string             // on PUT: exclude the note being edited
}

export type NoteValidationResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string }

/** Minimal shape of the Prisma client this module needs (test-injectable). */
export interface NoteValidationDb {
  transaction: {
    findFirst(args: any): Promise<any>
    aggregate(args: any): Promise<any>
  }
}

const EXPECTED_ORIGINAL_TYPE: Record<string, string> = {
  'credit-note': 'sale',
  'debit-note': 'purchase',
}

export async function validateNoteAgainstOriginal(
  db: NoteValidationDb,
  input: NoteValidationInput,
): Promise<NoteValidationResult> {
  const { userId, type, partyId, originalTransactionId, noteTotal, excludeNoteId } = input

  const expectedType = EXPECTED_ORIGINAL_TYPE[type]
  if (!expectedType) return { ok: true }  // not a note — nothing to validate

  // Rule 1: exists + owned by this user + not voided.
  const original = await db.transaction.findFirst({
    where: { id: originalTransactionId, userId, deletedAt: null },
    select: { id: true, type: true, partyId: true, totalAmount: true, invoiceNo: true },
  })
  if (!original) {
    return {
      ok: false,
      status: 404,
      error: 'Original invoice not found',
      message: 'The invoice this note refers to does not exist (or was voided). Refresh and try again.',
    }
  }

  // Rule 2: type pairing.
  if (original.type !== expectedType) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid original transaction type',
      message: `A ${type === 'credit-note' ? 'credit note' : 'debit note'} can only be issued against a ${expectedType} invoice — ${original.invoiceNo || 'this document'} is a ${original.type}.`,
    }
  }

  // Rule 3: same party (null === null is fine for walk-in against walk-in).
  if ((original.partyId || null) !== (partyId || null)) {
    return {
      ok: false,
      status: 400,
      error: 'Party mismatch',
      message: `This note's party does not match the original invoice's party. A return against ${original.invoiceNo || 'an invoice'} must be recorded for the same customer/supplier.`,
    }
  }

  // Rule 4: cumulative cap. Existing non-voided notes of the SAME type against
  // this original (excluding the one being edited, on PUT).
  const existingAgg = await db.transaction.aggregate({
    where: {
      userId,
      type,
      originalTransactionId,
      deletedAt: null,
      ...(excludeNoteId ? { id: { not: excludeNoteId } } : {}),
    },
    _sum: { totalAmount: true },
  })
  const alreadyNoted = existingAgg._sum.totalAmount || 0
  const combined = roundMoney(alreadyNoted + noteTotal)
  const cap = roundMoney(original.totalAmount)

  if (combined > cap + 0.01) {
    const remaining = roundMoney(Math.max(0, cap - alreadyNoted))
    return {
      ok: false,
      status: 400,
      error: 'Note exceeds original invoice',
      message:
        `This note (₹${roundMoney(noteTotal).toFixed(2)}) would exceed the original invoice ` +
        `${original.invoiceNo || ''} (₹${cap.toFixed(2)}). ` +
        (alreadyNoted > 0
          ? `₹${roundMoney(alreadyNoted).toFixed(2)} has already been noted against it — at most ₹${remaining.toFixed(2)} remains.`
          : `A return cannot be larger than the invoice it reverses.`),
    }
  }

  return { ok: true }
}
