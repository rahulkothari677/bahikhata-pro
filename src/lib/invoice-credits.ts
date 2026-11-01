/**
 * 8f-2 — credit (and debit) notes against a bill, for computeInvoiceDue's
 * `creditedAmount`. Server only (reads the database).
 *
 * WHY. A credit note against a sale lowers what the customer owes ON THAT
 * BILL. The khata already netted it (Home said ₹1,485 to collect), but the
 * bill kept saying "Due ₹1,650" and offered "Settle ₹1,650" — so taking that
 * money would have left the shop owing the customer ₹165. Found on the local
 * copy on 1 Nov, giving the first discount after sale (8f). Returns had the
 * same gap all along.
 *
 * WHAT COUNTS. Every note not deleted, pointing at the bill
 * (originalTransactionId): its total less what was paid out in cash when it
 * was made (a refund already given does not lower what is still owed).
 * Debit notes do the same for a purchase. SQL twin: CREDITED_JOIN in
 * invoice-due-sql.ts — the same rule, for queries that stay in the database.
 */
import { roundMoney } from './money'

interface NotesDb {
  transaction: { findMany(args: any): Promise<Array<{ originalTransactionId: string | null; totalAmount: number; paidAmount: number | null }>> }
}

interface NoteRow { type?: string; originalTransactionId?: string | null; totalAmount: number; paidAmount?: number | null; deletedAt?: Date | string | null }

/**
 * The rule, on rows already in hand: bill id → ₹ credited by the notes among
 * them (credit/debit notes, not deleted, with an original; total less cash refunded).
 */
export function creditsFromNotes(rows: NoteRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const n of rows) {
    if (n.type && n.type !== 'credit-note' && n.type !== 'debit-note') continue
    if (n.deletedAt || !n.originalTransactionId) continue
    const credit = roundMoney((n.totalAmount || 0) - (n.paidAmount || 0))
    if (credit <= 0) continue
    out.set(n.originalTransactionId, roundMoney((out.get(n.originalTransactionId) || 0) + credit))
  }
  return out
}

/** Bill id → ₹ credited by notes against it (rupees, through the money extension). */
export async function creditedByBill(db: NotesDb, userId: string, billIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(billIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const notes = await db.transaction.findMany({
    where: { userId, deletedAt: null, type: { in: ['credit-note', 'debit-note'] }, originalTransactionId: { in: ids } },
    select: { originalTransactionId: true, totalAmount: true, paidAmount: true },
  })
  return creditsFromNotes(notes)
}
