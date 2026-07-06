/**
 * 🔒 AUDIT FIX V7 (root cause for H1 + H2): Centralized party balance computation.
 *
 * Was: "receivable" and "payable" were computed in 3 different places, and the
 * copies drifted:
 *   - dashboard/route.ts: only summed openingBalance (WRONG — ignored all credit sales/purchases)
 *   - parties/route.ts: summed openingBalance + sales - purchases but didn't filter deletedAt
 *   - parties/[id]/route.ts: correct (openingBalance + sales - purchases, filtered deletedAt)
 *
 * Result: dashboard showed ₹0 receivable for shops with unpaid credit sales,
 * party list showed stale balances after deletes, and detail showed the right
 * number. Three screens, three different "balances" for the same customer.
 *
 * Now: ONE helper used by all three screens. The balance is ALWAYS:
 *   openingBalance + (sale.totalAmount - sale.paidAmount) - (purchase.totalAmount - purchase.paidAmount)
 * filtered to deletedAt IS NULL.
 *
 * The auditor's recommendation (V7 §5): "Centralize party-balance computation
 * into a shared helper so there's exactly one definition of 'what a customer
 * owes.'"
 */

import { db } from '@/lib/db'
import { roundMoney } from '@/lib/money'

/**
 * Compute the balance for a single party (customer/supplier).
 *
 * Balance = openingBalance
 *         + Σ(sale.totalAmount - sale.paidAmount) for non-deleted sales
 *         - Σ(purchase.totalAmount - purchase.paidAmount) for non-deleted purchases
 *
 * Positive balance = they owe us (receivable).
 * Negative balance = we owe them (payable).
 *
 * This is the SAME formula used by parties/[id]/route.ts (verified correct
 * in V5 HA). Centralizing it here means dashboard, party list, and party
 * detail all compute the same number.
 */
export async function computePartyBalance(
  userId: string,
  partyId: string,
): Promise<{
  balance: number
  salesOutstanding: number
  purchaseOutstanding: number
  totalSales: number
  totalPurchases: number
  totalReceived: number
  totalPaid: number
}> {
  // Fetch the party record (for openingBalance)
  const party = await db.party.findFirst({
    where: { id: partyId, userId, deletedAt: null },
    select: { openingBalance: true },
  })

  if (!party) {
    return {
      balance: 0,
      salesOutstanding: 0,
      purchaseOutstanding: 0,
      totalSales: 0,
      totalPurchases: 0,
      totalReceived: 0,
      totalPaid: 0,
    }
  }

  // Aggregate sales + purchases in parallel (both filtered deletedAt: null)
  const [salesAgg, purchaseAgg] = await Promise.all([
    db.transaction.aggregate({
      where: { userId, partyId, type: 'sale', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    db.transaction.aggregate({
      where: { userId, partyId, type: 'purchase', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
  ])

  const totalSales = roundMoney(salesAgg._sum.totalAmount || 0)
  const totalPurchases = roundMoney(purchaseAgg._sum.totalAmount || 0)
  const totalReceived = roundMoney(salesAgg._sum.paidAmount || 0)
  const totalPaid = roundMoney(purchaseAgg._sum.paidAmount || 0)
  const salesOutstanding = roundMoney(totalSales - totalReceived)
  const purchaseOutstanding = roundMoney(totalPurchases - totalPaid)
  const balance = roundMoney(party.openingBalance + salesOutstanding - purchaseOutstanding)

  return {
    balance,
    salesOutstanding,
    purchaseOutstanding,
    totalSales,
    totalPurchases,
    totalReceived,
    totalPaid,
  }
}

/**
 * Compute receivable + payable totals for ALL parties of a user.
 *
 * This is the helper the dashboard should use (instead of summing only
 * openingBalance). It:
 *   1. Fetches all parties (id + openingBalance, filtered deletedAt: null)
 *   2. Runs ONE groupBy for sales outstanding per party (filtered deletedAt: null)
 *   3. Runs ONE groupBy for purchases outstanding per party (filtered deletedAt: null)
 *   4. Computes balance per party = openingBalance + salesOut - purchaseOut
 *   5. Sums positive balances → totalReceivable, negative balances → totalPayable
 *
 * Returns both the totals AND the per-party balances (so the party list can
 * reuse this instead of doing its own aggregates).
 *
 * This is O(parties) memory + 3 DB round-trips — same cost as the old
 * dashboard approach but now CORRECT.
 */
export async function getReceivablePayable(
  userId: string,
): Promise<{
  totalReceivable: number
  totalPayable: number
  partyBalances: Map<string, {
    balance: number
    salesOutstanding: number
    purchaseOutstanding: number
    transactionCount: number
  }>
}> {
  // 🔒 V7.5 PERFORMANCE: Was running 4 sequential queries (1 findMany + 3
  // groupBy). Now uses ONE raw SQL query that joins Party + Transaction and
  // computes everything in a single pass. This is 1 round-trip instead of 4.

  const rows = await db.$queryRaw<Array<{
    partyId: string
    openingBalance: string
    salesOutstanding: string
    purchaseOutstanding: string
    transactionCount: bigint
  }>>`
    SELECT
      p."id" AS "partyId",
      p."openingBalance"::numeric AS "openingBalance",
      COALESCE(SUM(CASE WHEN t."type" = 'sale' THEN (t."totalAmount" - t."paidAmount")::numeric ELSE 0 END), 0) AS "salesOutstanding",
      COALESCE(SUM(CASE WHEN t."type" = 'purchase' THEN (t."totalAmount" - t."paidAmount")::numeric ELSE 0 END), 0) AS "purchaseOutstanding",
      COUNT(CASE WHEN t."type" IN ('sale', 'purchase') THEN 1 END) AS "transactionCount"
    FROM "Party" p
    LEFT JOIN "Transaction" t
      ON t."partyId" = p."id"
      AND t."deletedAt" IS NULL
      AND t."userId" = ${userId}
    WHERE p."userId" = ${userId}
      AND p."deletedAt" IS NULL
    GROUP BY p."id", p."openingBalance"
  `

  if (rows.length === 0) {
    return {
      totalReceivable: 0,
      totalPayable: 0,
      partyBalances: new Map(),
    }
  }

  const partyBalances = new Map<string, {
    balance: number
    salesOutstanding: number
    purchaseOutstanding: number
    transactionCount: number
  }>()

  let totalReceivable = 0
  let totalPayable = 0

  for (const row of rows) {
    const openingBalance = roundMoney(Number(row.openingBalance))
    const salesOutstanding = roundMoney(Number(row.salesOutstanding))
    const purchaseOutstanding = roundMoney(Number(row.purchaseOutstanding))
    const balance = roundMoney(openingBalance + salesOutstanding - purchaseOutstanding)

    partyBalances.set(row.partyId, {
      balance,
      salesOutstanding,
      purchaseOutstanding,
      transactionCount: Number(row.transactionCount),
    })

    if (balance > 0) {
      totalReceivable = roundMoney(totalReceivable + balance)
    } else if (balance < 0) {
      totalPayable = roundMoney(totalPayable + (-balance))
    }
  }

  return {
    totalReceivable,
    totalPayable,
    partyBalances,
  }
}
