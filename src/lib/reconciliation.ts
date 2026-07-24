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

  // 🔒 V20-023: Switched from < 0.005 to roundMoney(diff) === 0.
  //
  // The auditor's §3 [VERIFY] note recommended === 0 with integer paise storage.
  // This is correct: the DB SUM of integer paise columns is always an integer,
  // so two queries that compute the same sum will return the same paise value.
  // fromPaise(samePaise) produces the same float, roundMoney(sameFloat) produces
  // the same canonical float, and sameFloat - sameFloat === 0 exactly.
  //
  // The ONLY case where the values differ is a real data discrepancy (≥ 1 paise
  // = ≥ 0.01 rupees), which should fail. The old < 0.005 tolerance could mask
  // a 1-paisa rounding difference (0.01 >= 0.005 fails, but 0.004 would pass
  // — and 0.004 can't happen with integer paise, so the tolerance was safe but
  // unnecessarily loose).
  //
  // The roundMoney() on the difference eliminates any IEEE 754 float drift from
  // the subtraction itself (e.g., 12.35 - 12.35 might = 0.0000000001 in float).
  // roundMoney(0.0000000001) = 0, so === 0 is safe.
  const receivableDiff = roundMoney(totalReceivable - jsReceivable)
  const payableDiff = roundMoney(totalPayable - jsPayable)
  const receivableMatches = receivableDiff === 0
  const payableMatches = payableDiff === 0
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
 *
 * 🔒 V17 PAISE MIGRATION Phase 2C — Phase 4 dependency note:
 *   This function uses Prisma `aggregate()` (not raw SQL), so it's NOT part
 *   of Phase 2 (read-path SQL migration). However, when Phase 4 changes the
 *   column types from Float (rupees) to Int (paise), the Prisma `_sum` will
 *   return paise instead of rupees. At that point, the `roundMoney()` calls
 *   below must change to `fromPaise()`:
 *     itemCgst = fromPaise(itemGst._sum.cgst || 0)
 *     headerCgst = fromPaise(headerGst._sum.cgst || 0)
 *   And the comparison tolerance `< 0.01` can become `=== 0` (exact equality
 *   for integers). Catalog this as a Phase 4 task.
 */
export async function checkGstReconciliation(userId: string): Promise<ReconciliationCheck> {
  // Per-item GST totals (the "single source of truth" from V10)
  // 🔒 V19-003 FIX: Added type filter to item-level query. Previously, the
  // item aggregate included ALL transaction types (sale, purchase, credit-note,
  // debit-note), while the header aggregate only included sale + purchase.
  // This caused a false "GST mismatch" whenever credit notes or debit notes
  // had GST. Now both queries use the same type filter for an apples-to-apples
  // comparison.
  //
  // 🔒 V26 M11 FIX: Was: type filter ['sale', 'purchase'] only — credit notes
  // and debit notes were excluded, so the reconciliation check couldn't detect
  // header-vs-item GST drift on notes. Now: include all four transaction types
  // that carry GST, matching what the GST reports actually file.
  const TXN_TYPES = ['sale', 'purchase', 'credit-note', 'debit-note']
  const [itemGst, headerGst] = await Promise.all([
    db.transactionItem.aggregate({
      where: { transaction: { userId, deletedAt: null, type: { in: TXN_TYPES } } },
      _sum: { cgst: true, sgst: true, igst: true },
    }),
    db.transaction.aggregate({
      where: { userId, deletedAt: null, type: { in: TXN_TYPES } },
      _sum: { cgst: true, sgst: true, igst: true },
    }),
  ])

  const itemCgst = roundMoney(itemGst._sum.cgst || 0)
  const itemSgst = roundMoney(itemGst._sum.sgst || 0)
  const itemIgst = roundMoney(itemGst._sum.igst || 0)
  const headerCgst = roundMoney(headerGst._sum.cgst || 0)
  const headerSgst = roundMoney(headerGst._sum.sgst || 0)
  const headerIgst = roundMoney(headerGst._sum.igst || 0)

  // 🔒 V20-023: Switched from < 0.005 to roundMoney(diff) === 0.
  // Same rationale as checkPartyBalances above — with integer paise storage,
  // exact equality is correct and stricter. The roundMoney() on the difference
  // eliminates IEEE 754 float drift from the subtraction.
  const cgstDiff = roundMoney(itemCgst - headerCgst)
  const sgstDiff = roundMoney(itemSgst - headerSgst)
  const igstDiff = roundMoney(itemIgst - headerIgst)
  const cgstMatches = cgstDiff === 0
  const sgstMatches = sgstDiff === 0
  const igstMatches = igstDiff === 0
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
 * A TRUE orphan is a TransactionItem whose parent Transaction was HARD-deleted
 * (doesn't exist at all), or a Payment whose parent Party was HARD-deleted.
 * With Prisma's FK constraints, this should always be 0.
 *
 * Was: counted items on soft-deleted (voided) transactions as "orphaned."
 * That was WRONG — voided invoices SHOULD keep their line items for audit
 * trail. Items on voided transactions are NOT orphaned; they still have a
 * valid parent (the voided transaction row).
 *
 * Now: uses LEFT JOIN IS NULL to find only TRULY orphaned records (parent
 * hard-deleted). This will always be 0 in a well-maintained DB with FK
 * constraints. If it's ever non-zero, it indicates a serious referential
 * integrity issue (e.g. someone manually deleted rows from the DB bypassing
 * Prisma's FK protection).
 */
export async function checkOrphanedData(userId: string): Promise<ReconciliationCheck> {
  // Count items whose parent transaction doesn't exist AT ALL (hard-deleted).
  // Uses raw SQL because Prisma's relation filters can't express "parent IS NULL"
  // on a required relation — they only support filtering on parent properties.
  //
  // 🔒 BUG-006 FIX (V17 Phase 2C): Removed the contradictory EXISTS clause that
  // checked `EXISTS (SELECT 1 FROM Transaction t2 WHERE t2.userId = userId AND
  // t2.id = ti.transactionId)`. That clause made the query ALWAYS return 0
  // because: if the parent Transaction was hard-deleted (t.id IS NULL), then
  // t2.id = ti.transactionId can't match any row either → EXISTS is false →
  // the row is filtered out → count is always 0. The check could never detect
  // the exact orphans it was designed to catch.
  //
  // TransactionItem has no userId field (unlike Payment), so user-scoping is
  // impossible without a schema change. The check is now GLOBAL (not user-
  // scoped). This is appropriate because orphans indicate a DB integrity
  // issue (FK bypass), not a user data issue. The orphaned-payments check
  // below correctly uses p.userId because Payment HAS its own userId field.
  //
  // With Prisma's onDelete: Cascade on Transaction→TransactionItem, this
  // count should always be 0. A non-zero count means someone manually deleted
  // Transaction rows via SQL, bypassing the cascade.
  const orphanedItemsResult = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM "TransactionItem" ti
    LEFT JOIN "Transaction" t ON ti."transactionId" = t.id
    WHERE t.id IS NULL
  `
  const orphanedItems = Number(orphanedItemsResult[0]?.count || 0)

  // Count payments whose parent party doesn't exist AT ALL (hard-deleted).
  // This check IS correctly user-scoped because Payment has its own userId
  // field (schema line 347), so we can filter by p."userId" without needing
  // the parent Party to exist.
  const orphanedPaymentsResult = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM "Payment" p
    LEFT JOIN "Party" pty ON p."partyId" = pty.id
    WHERE pty.id IS NULL
      AND p."userId" = ${userId}
  `
  const orphanedPayments = Number(orphanedPaymentsResult[0]?.count || 0)

  const passed = orphanedItems === 0 && orphanedPayments === 0

  return {
    name: 'Data Integrity',
    description: 'No orphaned items or payments from hard-deleted records',
    passed,
    details: passed
      ? 'All transaction items have valid parent transactions, and all payments have valid parent parties.'
      : `Found ${orphanedItems} item(s) with no parent transaction (hard-deleted) and ${orphanedPayments} payment(s) with no parent party. This indicates a serious referential integrity issue — contact support.`,
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

/**
 * Check 4: Paise sanity — flag any money column with values that look like the
 * 100× corruption artifact from the non-idempotent paise migration
 * (20260712000001_paise_migration / M11 / CRITICAL Payment 100× bug).
 *
 * 🔒 Critical #3 from the EkBook-CRITICAL-Payment-100x-RootCause.md report:
 * "Add a paise sanity check to the nightly reconciliation cron: flag any
 * Payment.amount > 10_000_000 (₹100,000) or any product price > ₹1,000,000 as
 * a probable 100× artifact, and alert."
 *
 * The root cause: that migration's USING ROUND(x * 100) clauses re-execute on
 * every replay, multiplying money by 100 each time. The migrate-with-retry.sh
 * self-heal used to auto-replay failed migrations on the (false) assumption
 * that all were idempotent — so a connection drop on Neon could silently
 * 100×-corrupt every Payment/Transaction/Product row.
 *
 * That bug is now closed at the source (migrate-with-retry.sh refuses to
 * auto-replay data-transforming migrations + migration-idempotency-guard.test.ts
 * CI-checks every new migration). But rows written BEFORE the fix can still be
 * corrupt. This nightly check is the early-warning system: if a NEW 100×
 * corruption ever happens (a future non-idempotent migration slips through,
 * a backup-restore from a bad snapshot, etc.), this fires a Sentry alert
 * the next morning instead of waiting for a user to notice "₹100 settled as
 * ₹10,000".
 *
 * Thresholds (in PAISE):
 *   - SUSPICIOUS_PAISE = 100,000,000 = ₹10,00,000 (₹1M) — review manually
 *   - ALMOST_CERTAIN_PAISE = 1,000,000,000 = ₹1,00,00,000 (₹10M) — almost
 *     certainly a 100× artifact
 *
 * Why per-user (not global): the cron already iterates users, so this slots
 * into the existing loop. A global check would be faster but harder to alert
 * on (no userId context for Sentry).
 *
 * Why raw SQL: the money extension's read converter divides paise by 100, so
 * a corrupted row still round-trips as the "correct" rupee value through
 * Prisma. The corruption is ONLY visible by reading the raw column. This is
 * the exact mistake the original debug log made (per CRITICAL report §2).
 *
 * Performance: 1 SQL query per table (Payment, Transaction, Party,
 * TransactionItem-via-join, Product), all in parallel. O(1) memory.
 */
const SUSPICIOUS_PAISE = 100_000_000      // ₹10,00,000
const ALMOST_CERTAIN_PAISE = 1_000_000_000 // ₹1,00,00,000

export async function checkPaiseAnomalies(userId: string): Promise<ReconciliationCheck> {
  // Payment + Transaction + Party + Product: scoped by userId, single query each.
  // TransactionItem: scoped via parent Transaction (no userId on the item).
  // 🔒 P5-1 (Phase 5): Added Subscription, BankStatement, BankTransaction —
  // was: only 5 tables checked. A future 100× regression on Subscription.amount
  // or BankTransaction.amount would NOT have fired the nightly Sentry alert.
  const [paymentRow, txnRow, partyRow, productRow, itemRow, subRow, bankStmtRow, bankTxnRow] = await Promise.all([
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT MAX(amount)::bigint AS max,
              COUNT(*) FILTER (WHERE amount > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE amount > $3)::bigint AS certain
       FROM "Payment"
       WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT MAX("totalAmount")::bigint AS max,
              COUNT(*) FILTER (WHERE "totalAmount" > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE "totalAmount" > $3)::bigint AS certain
       FROM "Transaction"
       WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT MAX("openingBalance")::bigint AS max,
              COUNT(*) FILTER (WHERE "openingBalance" > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE "openingBalance" > $3)::bigint AS certain
       FROM "Party"
       WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT MAX("salePrice")::bigint AS max,
              COUNT(*) FILTER (WHERE "salePrice" > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE "salePrice" > $3)::bigint AS certain
       FROM "Product"
       WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT MAX(ti."total")::bigint AS max,
              COUNT(*) FILTER (WHERE ti."total" > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE ti."total" > $3)::bigint AS certain
       FROM "TransactionItem" ti
       JOIN "Transaction" t ON t."id" = ti."transactionId"
       WHERE t."userId" = $1 AND t."deletedAt" IS NULL`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
    // 🔒 P5-1: Subscription.amount (Razorpay payment amounts)
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT MAX(amount)::bigint AS max,
              COUNT(*) FILTER (WHERE amount > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE amount > $3)::bigint AS certain
       FROM "Subscription"
       WHERE "userId" = $1`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
    // 🔒 P5-1: BankStatement.totalCredits + totalDebits (use GREATEST of both)
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT GREATEST(MAX("totalCredits"), MAX("totalDebits"))::bigint AS max,
              COUNT(*) FILTER (WHERE "totalCredits" > $2 OR "totalDebits" > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE "totalCredits" > $3 OR "totalDebits" > $3)::bigint AS certain
       FROM "BankStatement"
       WHERE "userId" = $1`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
    // 🔒 P5-1: BankTransaction.amount + balance (use GREATEST of both)
    db.$queryRawUnsafe<Array<{ max: bigint | null; susp: bigint; certain: bigint }>>(
      `SELECT GREATEST(MAX(amount), MAX(balance))::bigint AS max,
              COUNT(*) FILTER (WHERE amount > $2 OR balance > $2)::bigint AS susp,
              COUNT(*) FILTER (WHERE amount > $3 OR balance > $3)::bigint AS certain
       FROM "BankTransaction"
       WHERE "userId" = $1`,
      userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
    ),
  ])

  const sumUp = (r: { max: bigint | null; susp: bigint; certain: bigint } | undefined) => ({
    maxPaise: r?.max != null ? Number(r.max) : 0,
    suspicious: Number(r?.susp ?? 0),
    almostCertain: Number(r?.certain ?? 0),
  })

  const payment = sumUp(paymentRow?.[0])
  const txn = sumUp(txnRow?.[0])
  const party = sumUp(partyRow?.[0])
  const product = sumUp(productRow?.[0])
  const item = sumUp(itemRow?.[0])
  const subscription = sumUp(subRow?.[0])
  const bankStmt = sumUp(bankStmtRow?.[0])
  const bankTxn = sumUp(bankTxnRow?.[0])

  const totalSuspicious = payment.suspicious + txn.suspicious + party.suspicious + product.suspicious + item.suspicious
    + subscription.suspicious + bankStmt.suspicious + bankTxn.suspicious
  const totalAlmostCertain = payment.almostCertain + txn.almostCertain + party.almostCertain + product.almostCertain + item.almostCertain
    + subscription.almostCertain + bankStmt.almostCertain + bankTxn.almostCertain

  // Fail if ANY column has an "almost certain" corruption (above ₹10M paise).
  // Suspicious-only rows don't fail — a single legitimate ₹15L B2B sale is
  // plausible for some shops. The cron will still log them for review.
  const passed = totalAlmostCertain === 0

  const fmtPaise = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`

  return {
    name: 'Paise Sanity',
    description: 'No money column shows the 100× corruption signature',
    passed,
    details: passed
      ? totalSuspicious === 0
        ? 'All money columns within plausible bounds. No 100× corruption signature detected.'
        : `${totalSuspicious} row(s) above the suspicious threshold (₹10L) but below the almost-certain threshold (₹1Cr). Review via /api/debug/paise-audit. Max: Payment ${fmtPaise(payment.maxPaise)}, Transaction ${fmtPaise(txn.maxPaise)}, Party ${fmtPaise(party.maxPaise)}, Product ${fmtPaise(product.maxPaise)}, Item ${fmtPaise(item.maxPaise)}, Subscription ${fmtPaise(subscription.maxPaise)}, BankStmt ${fmtPaise(bankStmt.maxPaise)}, BankTxn ${fmtPaise(bankTxn.maxPaise)}.`
      : `${totalAlmostCertain} row(s) almost certainly 100×-corrupted (above ₹1Cr paise). Payment: ${payment.almostCertain}, Transaction: ${txn.almostCertain}, Party: ${party.almostCertain}, Product: ${product.almostCertain}, Item: ${item.almostCertain}, Subscription: ${subscription.almostCertain}, BankStmt: ${bankStmt.almostCertain}, BankTxn: ${bankTxn.almostCertain}. Investigate via /api/debug/paise-audit + /api/debug/repair-payment-amount (with explicit IDs only).`,
    expected: 0,
    actual: totalAlmostCertain,
  }
}

/**
 * Run all reconciliation checks INCLUDING the paise sanity check (Critical #3).
 *
 * The nightly cron uses this extended function. The on-demand /api/reconcile
 * endpoint (user-triggered) uses the basic runReconciliationChecks above so
 * the paise check (which uses raw SQL across 5 tables) doesn't slow down the
 * one-tap UI check.
 */
export async function runReconciliationChecksNightly(userId: string): Promise<ReconciliationResult> {
  const [partyCheck, gstCheck, orphanCheck, paiseCheck] = await Promise.all([
    checkPartyBalances(userId),
    checkGstReconciliation(userId),
    checkOrphanedData(userId),
    checkPaiseAnomalies(userId),
  ])

  const checks = [partyCheck, gstCheck, orphanCheck, paiseCheck]
  const allPassed = checks.every(c => c.passed)

  return {
    checks,
    allPassed,
    runAt: new Date().toISOString(),
  }
}
