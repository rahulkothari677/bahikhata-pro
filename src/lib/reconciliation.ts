/**
 * 🔒 V17-Ext §5.1: Reconciliation health check.
 *
 * A one-tap "does everything tie out?" check. Surfaces the internal balance
 * tests as a user-facing feature so shopkeepers (and their CAs) can verify
 * the numbers are correct at any time.
 *
 * Three checks:
 *   1. Party balances tie out — sum of positive balances == totalReceivable,
 *      sum of negative balances == totalPayable. Catches aggregation bugs
 *      or float drift between the SQL path and the Prisma path.
 *   2. GST ties out — sum of per-item CGST/SGST/IGST (from TransactionItem)
 *      equals sum of header-level CGST/SGST/IGST (from Transaction). Catches
 *      drift between the "single source of truth" (per-item) and the
 *      header-level columns.
 *   3. No orphaned data — every TransactionItem belongs to a non-deleted
 *      Transaction, every Payment belongs to a non-deleted Party. Catches
 *      referential integrity issues.
 *
 * Each check returns a { name, passed, details } object. The API route
 * returns an array of these. The UI shows a green check or red x for each.
 *
 * Performance: all checks use SQL aggregates (no row fetching), so they're
 * O(1) memory regardless of data volume. Each check is 1-3 DB round-trips.
 */

import { db } from '@/lib/db'
import { getReceivablePayable } from '@/lib/party-balance'
import { roundMoney } from '@/lib/money'

export interface ReconciliationCheck {
  name: string
  description: string
  passed: boolean
  details: string
  /** Optional: the expected vs actual values, for debugging */
  expected?: number
  actual?: number
}

export interface ReconciliationResult {
  checks: ReconciliationCheck[]
  allPassed: boolean
  runAt: string
}

/**
 * Check 1: Party balances tie out.
 *
 * Compares:
 *   - totalReceivable from getReceivablePayable() (the SQL aggregate path)
 *   - vs. sum of positive per-party balances (from the same function's
 *     partyBalances map — but computed independently in JS)
 *
 * And same for totalPayable.
 *
 * These use the same underlying data, so they should always agree. The check
 * catches float drift or a bug in the aggregation logic.
 */
export async function checkPartyBalances(userId: string): Promise<ReconciliationCheck> {
  const { totalReceivable, totalPayable, partyBalances } = await getReceivablePayable(userId)

  // Independently sum the per-party balances
  let jsReceivable = 0
  let jsPayable = 0
  for (const [, info] of partyBalances) {
    if (info.balance > 0) {
      jsReceivable = roundMoney(jsReceivable + info.balance)
    } else if (info.balance < 0) {
      jsPayable = roundMoney(jsPayable + (-info.balance))
    }
  }

  const receivableMatches = Math.abs(totalReceivable - jsReceivable) < 0.01
  const payableMatches = Math.abs(totalPayable - jsPayable) < 0.01
  const passed = receivableMatches && payableMatches

  return {
    name: 'Party Balances',
    description: 'Sum of party balances matches dashboard totals',
    passed,
    details: passed
      ? `Receivable ₹${totalReceivable.toFixed(2)} and Payable ₹${totalPayable.toFixed(2)} both match across ${partyBalances.size} parties.`
      : `Mismatch detected. Receivable: SQL=₹${totalReceivable.toFixed(2)} vs JS=₹${jsReceivable.toFixed(2)}. Payable: SQL=₹${totalPayable.toFixed(2)} vs JS=₹${jsPayable.toFixed(2)}.`,
    expected: roundMoney(totalReceivable + totalPayable),
    actual: roundMoney(jsReceivable + jsPayable),
  }
}

/**
 * Check 2: GST ties out (per-item vs header).
 *
 * The V10 fix made per-item CGST/SGST/IGST the "single source of truth."
 * The header-level columns (Transaction.cgst/sgst/igst) should equal the sum
 * of the per-item values. If they drift, GST reports (which use per-item)
 * won't match the invoice headers.
 *
 * Compares:
 *   - SUM of TransactionItem.cgst (non-deleted items, non-deleted transactions)
 *   - vs. SUM of Transaction.cgst (non-deleted)
 * And same for sgst and igst.
 */
export async function checkGstReconciliation(userId: string): Promise<ReconciliationCheck> {
  // Per-item GST totals (the "single source of truth" from V10)
  const [itemGst, headerGst] = await Promise.all([
    db.transactionItem.aggregate({
      where: { transaction: { userId, deletedAt: null } },
      _sum: { cgst: true, sgst: true, igst: true },
    }),
    db.transaction.aggregate({
      where: { userId, deletedAt: null, type: { in: ['sale', 'purchase'] } },
      _sum: { cgst: true, sgst: true, igst: true },
    }),
  ])

  const itemCgst = roundMoney(itemGst._sum.cgst || 0)
  const itemSgst = roundMoney(itemGst._sum.sgst || 0)
  const itemIgst = roundMoney(itemGst._sum.igst || 0)
  const headerCgst = roundMoney(headerGst._sum.cgst || 0)
  const headerSgst = roundMoney(headerGst._sum.sgst || 0)
  const headerIgst = roundMoney(headerGst._sum.igst || 0)

  const cgstMatches = Math.abs(itemCgst - headerCgst) < 0.01
  const sgstMatches = Math.abs(itemSgst - headerSgst) < 0.01
  const igstMatches = Math.abs(itemIgst - headerIgst) < 0.01
  const passed = cgstMatches && sgstMatches && igstMatches

  return {
    name: 'GST Reconciliation',
    description: 'Per-item GST totals match invoice header totals',
    passed,
    details: passed
      ? `CGST ₹${itemCgst.toFixed(2)}, SGST ₹${itemSgst.toFixed(2)}, IGST ₹${itemIgst.toFixed(2)} all match between line items and invoice headers.`
      : `Mismatch. CGST: items=₹${itemCgst.toFixed(2)} vs headers=₹${headerCgst.toFixed(2)}. SGST: items=₹${itemSgst.toFixed(2)} vs headers=₹${headerSgst.toFixed(2)}. IGST: items=₹${itemIgst.toFixed(2)} vs headers=₹${headerIgst.toFixed(2)}.`,
    expected: roundMoney(itemCgst + itemSgst + itemIgst),
    actual: roundMoney(headerCgst + headerSgst + headerIgst),
  }
}

/**
 * Check 3: No orphaned data.
 *
 * Every TransactionItem should belong to a non-deleted Transaction.
 * Every Payment should belong to a non-deleted Party.
 *
 * Catches referential integrity issues (e.g. a transaction was soft-deleted
 * but its items are still counted somewhere, or a party was soft-deleted but
 * its payments are still active).
 */
export async function checkOrphanedData(userId: string): Promise<ReconciliationCheck> {
  // Count items whose parent transaction is soft-deleted
  const orphanedItems = await db.transactionItem.count({
    where: {
      transaction: { userId, deletedAt: { not: null } },
    },
  })

  // Count payments whose parent party is soft-deleted
  const orphanedPayments = await db.payment.count({
    where: {
      userId,
      deletedAt: null,
      party: { deletedAt: { not: null } },
    },
  })

  const passed = orphanedItems === 0 && orphanedPayments === 0

  return {
    name: 'Data Integrity',
    description: 'No orphaned items or payments from deleted records',
    passed,
    details: passed
      ? 'All transaction items belong to active transactions, and all payments belong to active parties.'
      : `Found ${orphanedItems} item(s) attached to deleted transactions and ${orphanedPayments} payment(s) attached to deleted parties.`,
    expected: 0,
    actual: orphanedItems + orphanedPayments,
  }
}

/**
 * Run all reconciliation checks and return the combined result.
 */
export async function runReconciliationChecks(userId: string): Promise<ReconciliationResult> {
  const [partyCheck, gstCheck, orphanCheck] = await Promise.all([
    checkPartyBalances(userId),
    checkGstReconciliation(userId),
    checkOrphanedData(userId),
  ])

  const checks = [partyCheck, gstCheck, orphanCheck]
  const allPassed = checks.every(c => c.passed)

  return {
    checks,
    allPassed,
    runAt: new Date().toISOString(),
  }
}
