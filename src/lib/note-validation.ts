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
import { findWalkInPartyId } from './walk-in-party'

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
  // 🔒 V26 R5 (Phase 5): $queryRaw is needed for the FOR UPDATE lock.
  // Optional on the interface so test stubs don't need to implement it
  // (the lock is a no-op in unit tests; it only fires against real Postgres).
  $queryRaw?(sql: TemplateStringsArray, ...values: any[]): Promise<any>
  /** #276: to find the shop's walk-in party (optional, like $queryRaw, for test stubs). */
  party?: { findFirst(args: any): Promise<any> }
}

/**
 * #276 (Phase 6b): rule 3's "same party", counting the counter customer.
 *
 * A walk-in sale has no party. Its return is filed under the shop's reserved
 * "Walk-in Customer" (lib/walk-in-party.ts, the CA's #2 issue): the routes turn
 * a party-less note into it BEFORE this check. Comparing the two ids — null vs
 * the walk-in's id — refused every counter return, the very case the walk-in
 * party exists for, so the shop paid output tax on goods that came back. The
 * walk-in bill and the walk-in khata are one customer; any other pair must
 * match exactly (a return against Ramesh's bill is never Sunita's).
 */
export function notePartiesMatch(originalPartyId: string | null, notePartyId: string | null, walkInPartyId: string | null): boolean {
  const asCounter = (id: string | null) => (id && id === walkInPartyId ? null : id)
  return asCounter(originalPartyId) === asCounter(notePartyId)
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

  // 🔒 V26 R5 (Phase 5): Lock the original invoice row INSIDE the caller's
  // $transaction (db here is the tx handle when called from a $transaction
  // callback). This serializes note-writers + original-editers + original-
  // deleters per invoice. Without the lock, READ COMMITTED means two
  // concurrent note-creates each aggregate the committed notes (Σ=0), both
  // pass the cap, both insert, both commit → Σ = 1,200 against a ₹1,000
  // invoice. Being inside a $transaction changes nothing about what the
  // aggregate can see — only a row lock does.
  //
  // The lock is a no-op in unit tests (test stubs don't implement $queryRaw);
  // it only fires against real Postgres. Skipped if $queryRaw is unavailable.
  if (db.$queryRaw) {
    await db.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${originalTransactionId} AND "deletedAt" IS NULL FOR UPDATE`
  }

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

  // Rule 3: same party — the walk-in bill and the shop's Walk-in Customer being one (#276).
  const walkInPartyId = (original.partyId || null) !== (partyId || null) && db.party
    ? await findWalkInPartyId({ party: db.party }, userId)
    : null
  if (!notePartiesMatch(original.partyId || null, partyId || null, walkInPartyId)) {
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
