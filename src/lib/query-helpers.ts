/**
 * Shared query helpers for soft-delete-aware transaction queries.
 *
 * 🔒 AUDIT FIX N1 (v3 audit): Soft-deleted transactions must be excluded from
 * ALL aggregate/reporting paths. Was: only transactions list and parties list
 * filtered deletedAt. Dashboard, reports, GST export, insights all counted
 * deleted transactions → wrong numbers, wrong GST filings.
 *
 * This helper ensures every query that reads transactions for aggregation
 * includes the deletedAt: null filter. Use it everywhere instead of
 * building the `where` clause manually.
 */

import type { Prisma } from '@prisma/client'

/**
 * Build a Prisma `where` clause for transactions that excludes soft-deleted rows.
 * Pass any additional filters as the second argument.
 *
 * Usage:
 *   const where = activeTransactionWhere(userId, { type: 'sale', date: { gte: monthStart } })
 *   const sales = await db.transaction.findMany({ where })
 *
 * Or for aggregates:
 *   const agg = await db.transaction.aggregate({
 *     where: activeTransactionWhere(userId, { type: 'sale', date: { gte: startOfToday } }),
 *     _sum: { totalAmount: true }
 *   })
 */
export function activeTransactionWhere(
  userId: string,
  additional?: Prisma.TransactionWhereInput,
): Prisma.TransactionWhereInput {
  // 🔒 FIX M3: Spread order was { userId, deletedAt: null, ...additional } which
  // allowed `additional` to override userId or deletedAt — a latent IDOR if any
  // caller ever passes user-controlled data into `additional`. Now: security-
  // critical fields go LAST so they can never be overridden.
  return {
    ...additional,
    userId,
    deletedAt: null,
  }
}

/**
 * Build a Prisma `where` clause for parties that excludes soft-deleted rows.
 */
export function activePartyWhere(
  userId: string,
  additional?: Prisma.PartyWhereInput,
): Prisma.PartyWhereInput {
  // 🔒 FIX M3: Same fix — security-critical fields last.
  return {
    ...additional,
    userId,
    deletedAt: null,
  }
}
