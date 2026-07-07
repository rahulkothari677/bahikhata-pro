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
 * 🔒 FIX H3: Now includes standalone payments (receive/pay against udhaar).
 *
 * Balance = openingBalance
 *         + Σ(sale.totalAmount - sale.paidAmount) for non-deleted sales
 *         - Σ(purchase.totalAmount - purchase.paidAmount) for non-deleted purchases
 *         - Σ(payment.amount WHERE type='received')   // customer paid us
 *         + Σ(payment.amount WHERE type='paid')        // we paid supplier
 *
 * Positive balance = they owe us (receivable).
 * Negative balance = we owe them (payable).
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
  paymentsReceived: number
  paymentsPaid: number
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
      paymentsReceived: 0,
      paymentsPaid: 0,
    }
  }

  // Aggregate sales + purchases + payments in parallel
  const [salesAgg, purchaseAgg, paymentsAgg] = await Promise.all([
    db.transaction.aggregate({
      where: { userId, partyId, type: 'sale', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    db.transaction.aggregate({
      where: { userId, partyId, type: 'purchase', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    // 🔒 FIX H3: Include standalone payments in the balance calculation.
    // type='received' = customer paid us (reduces what they owe)
    // type='paid' = we paid supplier (reduces what we owe them)
    db.payment.aggregate({
      where: { userId, partyId },
      _sum: { amount: true },
    }),
  ])

  // Also get per-type payment totals
  const [receivedAgg, paidAgg] = await Promise.all([
    db.payment.aggregate({
      where: { userId, partyId, type: 'received' },
      _sum: { amount: true },
    }),
    db.payment.aggregate({
      where: { userId, partyId, type: 'paid' },
      _sum: { amount: true },
    }),
  ])

  const totalSales = roundMoney(salesAgg._sum.totalAmount || 0)
  const totalPurchases = roundMoney(purchaseAgg._sum.totalAmount || 0)
  const totalReceived = roundMoney(salesAgg._sum.paidAmount || 0)
  const totalPaid = roundMoney(purchaseAgg._sum.paidAmount || 0)
  const salesOutstanding = roundMoney(totalSales - totalReceived)
  const purchaseOutstanding = roundMoney(totalPurchases - totalPaid)

  // 🔒 FIX H3: Payments reduce the outstanding balance
  const paymentsReceived = roundMoney(receivedAgg._sum.amount || 0)
  const paymentsPaid = roundMoney(paidAgg._sum.amount || 0)

  const balance = roundMoney(
    party.openingBalance + salesOutstanding - purchaseOutstanding - paymentsReceived + paymentsPaid
  )

  return {
    balance,
    salesOutstanding,
    purchaseOutstanding,
    totalSales,
    totalPurchases,
    totalReceived,
    totalPaid,
    paymentsReceived,
    paymentsPaid,
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
  // 🔒 FIX H3: Added LEFT JOIN on Payment to include standalone payments.

  const rows = await db.$queryRaw<Array<{
    partyId: string
    openingBalance: string
    salesOutstanding: string
    purchaseOutstanding: string
    paymentsReceived: string
    paymentsPaid: string
    transactionCount: bigint
  }>>`
    SELECT
      p."id" AS "partyId",
      p."openingBalance"::numeric AS "openingBalance",
      COALESCE(SUM(CASE WHEN t."type" = 'sale' THEN (t."totalAmount" - t."paidAmount")::numeric ELSE 0 END), 0) AS "salesOutstanding",
      COALESCE(SUM(CASE WHEN t."type" = 'purchase' THEN (t."totalAmount" - t."paidAmount")::numeric ELSE 0 END), 0) AS "purchaseOutstanding",
      COALESCE(SUM(CASE WHEN pay."type" = 'received' THEN pay."amount"::numeric ELSE 0 END), 0) AS "paymentsReceived",
      COALESCE(SUM(CASE WHEN pay."type" = 'paid' THEN pay."amount"::numeric ELSE 0 END), 0) AS "paymentsPaid",
      COUNT(CASE WHEN t."type" IN ('sale', 'purchase') THEN 1 END) AS "transactionCount"
    FROM "Party" p
    LEFT JOIN "Transaction" t
      ON t."partyId" = p."id"
      AND t."deletedAt" IS NULL
      AND t."userId" = ${userId}
    LEFT JOIN "Payment" pay
      ON pay."partyId" = p."id"
      AND pay."userId" = ${userId}
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
    // 🔒 FIX H3: Include payments in the balance
    const paymentsReceived = roundMoney(Number(row.paymentsReceived))
    const paymentsPaid = roundMoney(Number(row.paymentsPaid))
    const balance = roundMoney(openingBalance + salesOutstanding - purchaseOutstanding - paymentsReceived + paymentsPaid)

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
