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
import { roundMoney, fromPaise } from '@/lib/money'

/**
 * Compute the balance for a single party (customer/supplier).
 *
 * 🔒 FIX H3: Now includes standalone payments (receive/pay against udhaar).
 * 🔒 V17-Ext Tier 3: Now includes credit notes (reduce receivable) and
 *   debit notes (reduce payable).
 *
 * Balance = openingBalance
 *         + Σ(sale.totalAmount - sale.paidAmount) for non-deleted sales
 *         - Σ(purchase.totalAmount - purchase.paidAmount) for non-deleted purchases
 *         - Σ(credit-note.totalAmount - credit-note.paidAmount)  // reduces receivable
 *         + Σ(debit-note.totalAmount - debit-note.paidAmount)    // reduces payable
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
  creditNoteOutstanding: number
  debitNoteOutstanding: number
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
      creditNoteOutstanding: 0,
      debitNoteOutstanding: 0,
      totalSales: 0,
      totalPurchases: 0,
      totalReceived: 0,
      totalPaid: 0,
      paymentsReceived: 0,
      paymentsPaid: 0,
    }
  }

  // Aggregate sales + purchases + credit-notes + debit-notes + payments in parallel
  const [salesAgg, purchaseAgg, creditNoteAgg, debitNoteAgg, paymentsAgg] = await Promise.all([
    db.transaction.aggregate({
      where: { userId, partyId, type: 'sale', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    db.transaction.aggregate({
      where: { userId, partyId, type: 'purchase', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    // V17-Ext Tier 3: Credit notes reduce receivable (like a received payment)
    db.transaction.aggregate({
      where: { userId, partyId, type: 'credit-note', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    // V17-Ext Tier 3: Debit notes reduce payable (like a paid payment)
    db.transaction.aggregate({
      where: { userId, partyId, type: 'debit-note', deletedAt: null },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    // 🔒 FIX H3: Include standalone payments in the balance calculation.
    // 🔒 V15 M-3: Filter deletedAt: null
    db.payment.aggregate({
      where: { userId, partyId, deletedAt: null },
      _sum: { amount: true },
    }),
  ])

  // Also get per-type payment totals
  const [receivedAgg, paidAgg] = await Promise.all([
    db.payment.aggregate({
      where: { userId, partyId, type: 'received', deletedAt: null },
      _sum: { amount: true },
    }),
    db.payment.aggregate({
      where: { userId, partyId, type: 'paid', deletedAt: null },
      _sum: { amount: true },
    }),
  ])

  const totalSales = roundMoney(salesAgg._sum.totalAmount || 0)
  const totalPurchases = roundMoney(purchaseAgg._sum.totalAmount || 0)
  const totalReceived = roundMoney(salesAgg._sum.paidAmount || 0)
  const totalPaid = roundMoney(purchaseAgg._sum.paidAmount || 0)
  const salesOutstanding = roundMoney(totalSales - totalReceived)
  const purchaseOutstanding = roundMoney(totalPurchases - totalPaid)

  // V17-Ext Tier 3: Credit/debit note outstanding
  const creditNoteOutstanding = roundMoney(
    (creditNoteAgg._sum.totalAmount || 0) - (creditNoteAgg._sum.paidAmount || 0)
  )
  const debitNoteOutstanding = roundMoney(
    (debitNoteAgg._sum.totalAmount || 0) - (debitNoteAgg._sum.paidAmount || 0)
  )

  // 🔒 FIX H3: Payments reduce the outstanding balance
  const paymentsReceived = roundMoney(receivedAgg._sum.amount || 0)
  const paymentsPaid = roundMoney(paidAgg._sum.amount || 0)

  const balance = roundMoney(
    party.openingBalance
    + salesOutstanding
    - purchaseOutstanding
    - creditNoteOutstanding   // V17-Ext Tier 3: reduces receivable
    + debitNoteOutstanding    // V17-Ext Tier 3: reduces payable
    - paymentsReceived
    + paymentsPaid
  )

  return {
    balance,
    salesOutstanding,
    purchaseOutstanding,
    creditNoteOutstanding,
    debitNoteOutstanding,
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
 * 🔒 FIX C-NEW-1 (V14): The H3 fix added a LEFT JOIN on Payment at the same
 * level as the Transaction LEFT JOIN. This caused a Cartesian product
 * (fan-out): a party with T transactions and P payments produced T×P rows,
 * multiplying the SUM values. The dashboard and party-list balances were
 * wrong the moment a party had both invoices AND payments.
 *
 * Fix: pre-aggregate each one-to-many table in a subquery (GROUP BY partyId),
 * then LEFT JOIN one row per party. No fan-out possible.
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
  // Pre-aggregated subqueries: one row per party from each table, then join.
  // This avoids the T×P Cartesian product that the old multi-JOIN caused.
  //
  // 🔒 V17 PAISE MIGRATION Phase 2B: SQL now returns paise (integer) instead
  // of rupees (Float). The transformation for each money column:
  //   Old: SUM(...) AS "X"                    → Float rupees (numeric string)
  //   New: ROUND(SUM(...) * 100 + nudge) AS "XPaise"  → Int paise (numeric string)
  //
  // The nudge (0.0000001 = 1e-7 paise = 1e-9 rupees) mirrors the roundMoney()
  // helper's float-correction nudge. It bridges the gap between:
  //   - Postgres numeric ROUND (exact decimal arithmetic, no nudge needed for
  //     exact values, but float-cast values like 1.005→1.00499999... round DOWN)
  //   - JS roundMoney (adds 1e-9 to abs value before toFixed(2), so
  //     1.00499999... → 1.0050000009... → "1.01" → 1.01)
  //
  // For openingBalance (can be negative — supplier we owe), the nudge is
  // sign-aware: `+ nudge * SIGN(x)`. This matches roundMoney's symmetric
  // rounding (sign applied separately to abs value).
  //
  // For SUM columns (always >= 0: totalAmount >= paidAmount by definition),
  // a positive nudge is sufficient.
  //
  // WHY: This preserves EXACT behavioral parity with the pre-migration code
  // (which applied roundMoney in JS). Without the nudge, values with float
  // representation errors (e.g., 1.005 stored as 1.00499999...) would round
  // DOWN to 1.00 in SQL but UP to 1.01 in the old JS path — a 1-paisa
  // discrepancy that would fail the behavioral reconciliation test.
  //
  // The nudge is a TRANSITIONAL WORKAROUND. It will be removed in Phase 5
  // (delete workarounds) after Phase 4 migrates columns from Float to Int
  // (paise), eliminating float representation errors entirely.
  //
  // JS reads paise strings, converts via Number() + fromPaise() to get back
  // the same rupee Float the caller expects. The function's return type is
  // UNCHANGED (still rupees) — callers don't need to change.
  const rows = await db.$queryRaw<Array<{
    partyId: string
    openingBalancePaise: string
    salesOutstandingPaise: string
    purchaseOutstandingPaise: string
    creditNoteOutstandingPaise: string
    debitNoteOutstandingPaise: string
    paymentsReceivedPaise: string
    paymentsPaidPaise: string
    transactionCount: bigint
  }>>`
    SELECT
      p."id" AS "partyId",
      ROUND(p."openingBalance"::numeric * 100 + 0.0000001 * SIGN(p."openingBalance"::numeric)) AS "openingBalancePaise",
      COALESCE(t."salesOutstandingPaise", 0) AS "salesOutstandingPaise",
      COALESCE(t."purchaseOutstandingPaise", 0) AS "purchaseOutstandingPaise",
      COALESCE(t."creditNoteOutstandingPaise", 0) AS "creditNoteOutstandingPaise",
      COALESCE(t."debitNoteOutstandingPaise", 0) AS "debitNoteOutstandingPaise",
      COALESCE(pay."paymentsReceivedPaise", 0) AS "paymentsReceivedPaise",
      COALESCE(pay."paymentsPaidPaise", 0) AS "paymentsPaidPaise",
      COALESCE(t."txnCount", 0) AS "transactionCount"
    FROM "Party" p
    LEFT JOIN (
      SELECT
        "partyId",
        ROUND(SUM(CASE WHEN "type" = 'sale' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END) * 100 + 0.0000001) AS "salesOutstandingPaise",
        ROUND(SUM(CASE WHEN "type" = 'purchase' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END) * 100 + 0.0000001) AS "purchaseOutstandingPaise",
        ROUND(SUM(CASE WHEN "type" = 'credit-note' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END) * 100 + 0.0000001) AS "creditNoteOutstandingPaise",
        ROUND(SUM(CASE WHEN "type" = 'debit-note' THEN ("totalAmount" - "paidAmount")::numeric ELSE 0 END) * 100 + 0.0000001) AS "debitNoteOutstandingPaise",
        COUNT(CASE WHEN "type" IN ('sale', 'purchase', 'credit-note', 'debit-note') THEN 1 END) AS "txnCount"
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
      GROUP BY "partyId"
    ) t ON t."partyId" = p."id"
    LEFT JOIN (
      SELECT
        "partyId",
        ROUND(SUM(CASE WHEN "type" = 'received' THEN "amount"::numeric ELSE 0 END) * 100 + 0.0000001) AS "paymentsReceivedPaise",
        ROUND(SUM(CASE WHEN "type" = 'paid' THEN "amount"::numeric ELSE 0 END) * 100 + 0.0000001) AS "paymentsPaidPaise"
      FROM "Payment"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
      GROUP BY "partyId"
    ) pay ON pay."partyId" = p."id"
    WHERE p."userId" = ${userId}
      AND p."deletedAt" IS NULL
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
    // 🔒 V17 PAISE MIGRATION Phase 2B: SQL returns paise (numeric strings).
    // Convert to rupees via fromPaise() for the existing return type.
    // Number() parses the numeric string to a JS number (safe up to 2^53
    // paise ≈ ₹90 trillion — well beyond any party balance).
    // roundMoney is NOT needed here because the SQL already applied ROUND
    // with the 1e-7 paise nudge (matching roundMoney's 1e-9 rupee nudge).
    const openingBalance = fromPaise(Number(row.openingBalancePaise))
    const salesOutstanding = fromPaise(Number(row.salesOutstandingPaise))
    const purchaseOutstanding = fromPaise(Number(row.purchaseOutstandingPaise))
    const creditNoteOutstanding = fromPaise(Number(row.creditNoteOutstandingPaise))
    const debitNoteOutstanding = fromPaise(Number(row.debitNoteOutstandingPaise))
    const paymentsReceived = fromPaise(Number(row.paymentsReceivedPaise))
    const paymentsPaid = fromPaise(Number(row.paymentsPaidPaise))
    // V17-Ext Tier 3: Credit notes reduce receivable, debit notes reduce payable
    const balance = roundMoney(
      openingBalance
      + salesOutstanding
      - purchaseOutstanding
      - creditNoteOutstanding
      + debitNoteOutstanding
      - paymentsReceived
      + paymentsPaid
    )

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
