/**
 * "How much is still due on this bill" in SQL — the SQL twin of
 * computeInvoiceDue (lib/invoice-due.ts), for queries that must stay in the
 * database (oldest unpaid bill per customer, at any number of bills).
 *
 *     due = totalAmount − paidAmount − Σ(allocations of payments not deleted)
 *
 * Found 19 Oct (Phase 5c): the oldest-unpaid query behind Debt Aging used
 * `totalAmount > paidAmount`, ignoring payments settled against a bill later,
 * so a bill cleared by a later payment still counted as unpaid and a
 * customer's udhaar looked older than it was. Payments are soft-deleted while
 * their allocation rows remain, so only allocations of live payments count.
 *
 * Usage: `FROM "Transaction" t ${ALLOCATED_JOIN} WHERE ... AND ${DUE_SQL} > 0`.
 * Values are PAISE (raw columns).
 */
import { Prisma } from '@prisma/client'

export const ALLOCATED_JOIN = Prisma.sql`LEFT JOIN (
    SELECT pa."transactionId", SUM(pa."amount") AS alloc
    FROM "PaymentAllocation" pa
    JOIN "Payment" py ON py."id" = pa."paymentId" AND py."deletedAt" IS NULL
    GROUP BY pa."transactionId"
  ) a ON a."transactionId" = t."id"`

export const DUE_SQL = Prisma.sql`(t."totalAmount" - t."paidAmount" - COALESCE(a.alloc, 0))`

/**
 * The same allocations as ALLOCATED_JOIN, read per bill through the
 * (userId, transactionId) index — for queries over ONE customer's bills, where
 * grouping every allocation in the database first would read all shops' rows.
 * Same rule: only allocations of payments not deleted. Gives `a.alloc`.
 */
export function allocatedLateral(userId: string): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT SUM(pa."amount") AS alloc
    FROM "PaymentAllocation" pa
    JOIN "Payment" py ON py."id" = pa."paymentId" AND py."deletedAt" IS NULL
    WHERE pa."userId" = ${userId} AND pa."transactionId" = t."id"
  ) a ON TRUE`
}

/** Each customer's oldest sale bill that still has something due (alias t / a inside). */
export function oldestDueSaleSql(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT t."partyId" AS "partyId", MIN(t."date") AS "oldest"
    FROM "Transaction" t
    ${ALLOCATED_JOIN}
    WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'sale'
      AND t."partyId" IS NOT NULL AND ${DUE_SQL} > 0
    GROUP BY t."partyId"`
}
