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
  // 1. Fetch all active parties (id + openingBalance)
  const parties = await db.party.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, openingBalance: true },
  })

  if (parties.length === 0) {
    return {
      totalReceivable: 0,
      totalPayable: 0,
      partyBalances: new Map(),
    }
  }

  const partyIds = parties.map(p => p.id)
  const partyOpeningMap = new Map(parties.map(p => [p.id, p.openingBalance]))

  // 2. Aggregate sales + purchases + counts in parallel (ALL filtered deletedAt: null)
  const [salesAgg, purchaseAgg, countAgg] = await Promise.all([
    db.transaction.groupBy({
      by: ['partyId'],
      where: { userId, partyId: { in: partyIds }, type: 'sale', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    db.transaction.groupBy({
      by: ['partyId'],
      where: { userId, partyId: { in: partyIds }, type: 'purchase', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    db.transaction.groupBy({
      by: ['partyId'],
      where: {
        userId,
        partyId: { in: partyIds },
        OR: [{ type: 'sale' }, { type: 'purchase' }],
        deletedAt: null,
      },
      _count: { id: true },
    }),
  ])

  // Build lookup maps
  const salesMap = new Map(salesAgg.map(s => [s.partyId, s._sum]))
  const purchaseMap = new Map(purchaseAgg.map(p => [p.partyId, p._sum]))
  const countMap = new Map(countAgg.map(c => [c.partyId, c._count.id]))

  // 3. Compute balance per party
  const partyBalances = new Map<string, {
    balance: number
    salesOutstanding: number
    purchaseOutstanding: number
    transactionCount: number
  }>()

  let totalReceivable = 0
  let totalPayable = 0

  for (const party of parties) {
    const salesSum = salesMap.get(party.id)
    const purchaseSum = purchaseMap.get(party.id)
    const salesOutstanding = roundMoney((salesSum?.totalAmount || 0) - (salesSum?.paidAmount || 0))
    const purchaseOutstanding = roundMoney((purchaseSum?.totalAmount || 0) - (purchaseSum?.paidAmount || 0))
    const balance = roundMoney(party.openingBalance + salesOutstanding - purchaseOutstanding)

    partyBalances.set(party.id, {
      balance,
      salesOutstanding,
      purchaseOutstanding,
      transactionCount: countMap.get(party.id) || 0,
    })

    // 4. Split into receivable (positive) vs payable (negative)
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
