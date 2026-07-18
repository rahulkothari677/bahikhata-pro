/**
 * 🔒 V26 N3 — Linked-notes guard for original-invoice PUT edits.
 *
 * Pure helper extracted from the route handler so it's unit-testable without
 * spinning up the full Next.js request pipeline.
 *
 * The cap Σ(linked notes) ≤ original.totalAmount is enforced on note
 * create/edit (validateNoteAgainstOriginal) and on original DELETE. N3 closes
 * the missing PUT path: editing an original invoice down below its linked
 * notes total would otherwise produce a phantom negative party balance and
 * over-reversed GST liability.
 *
 * Worked example: sale ₹1000, CN ₹800 (valid against the original). Edit the
 * sale down to ₹300 → balance = 300 − 800 = −₹500 (the app says "you owe the
 * customer ₹500"). GSTR-1 CDNR has reversed ₹800 of tax against a ₹300 sale,
 * understating output liability by ₹500. N3 blocks the edit with a clear
 * message telling the user to edit/delete the notes first.
 */

export interface LinkedNotesGuardDb {
  transaction: {
    aggregate: (args: {
      where: {
        originalTransactionId: string
        deletedAt: null
        type: { in: ['credit-note', 'debit-note'] }
      }
      _sum: { totalAmount: true }
    }) => Promise<{ _sum: { totalAmount: number | null } }>
  }
}

export interface GuardResult {
  ok: boolean
  status?: number
  error?: string
  message?: string
}

/**
 * Returns ok:true if the edit is allowed, or ok:false with a 400-ready error
 * body if the new total would drop below the sum of linked notes.
 *
 * Only applies to 'sale' and 'purchase' (original supply types). Notes,
 * income, and expense are skipped — they don't have notes against them.
 */
export async function checkLinkedNotesCap(
  db: LinkedNotesGuardDb,
  transactionId: string,
  newTotalAmount: number,
  type: string,
): Promise<GuardResult> {
  // Only original-supply types carry linked notes.
  if (type !== 'sale' && type !== 'purchase') {
    return { ok: true }
  }

  const linkedNotesSum = await db.transaction.aggregate({
    where: {
      originalTransactionId: transactionId,
      deletedAt: null,
      type: { in: ['credit-note', 'debit-note'] },
    },
    _sum: { totalAmount: true },
  })
  const linkedNotesTotal = linkedNotesSum._sum.totalAmount || 0

  if (linkedNotesTotal > newTotalAmount) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot reduce below linked credit/debit notes',
      message: `This invoice has ₹${linkedNotesTotal.toFixed(2)} of credit/debit notes against it; its total can't be reduced below that. Edit or delete the notes first.`,
    }
  }

  return { ok: true }
}
