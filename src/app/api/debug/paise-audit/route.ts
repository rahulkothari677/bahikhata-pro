import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireFounder } from '@/lib/debug-auth'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/debug/paise-audit
 *
 * 🔒 M11 ROOT CAUSE DIAGNOSTIC (read-only, founder-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The ₹100 → ₹10,000 payment bug is NOT a code defect. Every step of the
 * write path is correct (client → zod → route → money extension → toPaise).
 * The defect is in STORED DATA: the paise migration
 * (20260712000001_paise_migration) contains 73 statements of the form
 *
 *     ALTER TABLE X ALTER COLUMN c TYPE INTEGER USING ROUND(c * 100);
 *
 * Postgres re-executes the USING expression every time the statement runs,
 * even when the column is already INTEGER. Applied twice, a value becomes
 * rupees × 10,000 instead of rupees × 100 — and every read (fromPaise)
 * divides by 100 once, displaying exactly 100× the true amount.
 *
 * scripts/migrate-with-retry.sh auto-retries failed migrations on P3009/P3018
 * on the (false) assumption that all migrations are idempotent, which is how
 * a second application can occur.
 *
 * WHY A DEBUG LOG COULDN'T FIND IT
 * --------------------------------
 * Reading the value back through Prisma passes it through the money
 * extension's read converter, so a corrupted row still round-trips as the
 * "correct" rupee value in application code. The corruption is ONLY visible
 * by reading the raw column with $queryRaw, which is what this endpoint does.
 *
 * WHAT IT REPORTS
 * ---------------
 * For every money column touched by that migration, in the order the
 * migration touches them (order matters — a partial re-run corrupts the
 * earlier tables only), this returns raw min/max/sample values plus a
 * heuristic verdict.
 *
 * It NEVER writes. Repair is a separate, explicit-ID endpoint
 * (/api/debug/repair-payment-amount).
 *
 * Usage:  GET /api/debug/paise-audit
 *         GET /api/debug/paise-audit?partyId=<id>   (adds per-party payment rows)
 */

export const maxDuration = 60

/**
 * Money columns in the exact order the paise migration alters them.
 * A partially-applied re-run corrupts the columns listed EARLIEST, so this
 * ordering is diagnostic information, not decoration.
 */
const MONEY_COLUMNS: Array<{ table: string; column: string; migrationLine: number }> = [
  { table: 'Product', column: 'purchasePrice', migrationLine: 13 },
  { table: 'Product', column: 'salePrice', migrationLine: 14 },
  { table: 'Product', column: 'mrp', migrationLine: 15 },
  { table: 'Party', column: 'openingBalance', migrationLine: 18 },
  { table: 'Transaction', column: 'subtotal', migrationLine: 21 },
  { table: 'Transaction', column: 'totalAmount', migrationLine: 26 },
  { table: 'Transaction', column: 'paidAmount', migrationLine: 28 },
  { table: 'TransactionItem', column: 'unitPrice', migrationLine: 32 },
  { table: 'TransactionItem', column: 'total', migrationLine: 39 },
  { table: 'Payment', column: 'amount', migrationLine: 42 },
]

/**
 * Plausibility bounds for a KIRANA/SMB ledger, expressed in PAISE.
 * A single line item or payment above ₹10,00,000 (100,000,000 paise) is
 * possible but rare; above ₹1,00,00,000 it is almost certainly a 100×
 * artifact. We report, we never auto-correct.
 */
const SUSPICIOUS_PAISE = 100_000_000      // ₹10,00,000
const ALMOST_CERTAIN_PAISE = 1_000_000_000 // ₹1,00,00,000

export async function GET(req: NextRequest) {
  const gate = await requireFounder()
  if ('error' in gate) return gate.error
  const { userId } = gate

  try {
    const url = new URL(req.url)
    const partyId = url.searchParams.get('partyId')

    // ─── Per-column raw statistics (bypasses the money extension) ────────
    const columns: any[] = []
    for (const { table, column, migrationLine } of MONEY_COLUMNS) {
      // Identifiers cannot be parameterised, so they are interpolated — they
      // come from the hardcoded MONEY_COLUMNS list above, never from input.
      const rows = await db.$queryRawUnsafe<Array<{
        n: bigint
        minv: bigint | null
        maxv: bigint | null
        suspicious: bigint
        almost_certain: bigint
      }>>(
        `SELECT COUNT(*)::bigint AS n,
                MIN("${column}")::bigint AS minv,
                MAX("${column}")::bigint AS maxv,
                COUNT(*) FILTER (WHERE "${column}" > $2)::bigint AS suspicious,
                COUNT(*) FILTER (WHERE "${column}" > $3)::bigint AS almost_certain
         FROM "${table}"
         WHERE "userId" = $1`,
        userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
      ).catch(async () => {
        // TransactionItem has no userId column — scope it via its parent.
        return db.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::bigint AS n,
                  MIN(ti."${column}")::bigint AS minv,
                  MAX(ti."${column}")::bigint AS maxv,
                  COUNT(*) FILTER (WHERE ti."${column}" > $2)::bigint AS suspicious,
                  COUNT(*) FILTER (WHERE ti."${column}" > $3)::bigint AS almost_certain
           FROM "TransactionItem" ti
           JOIN "Transaction" t ON t."id" = ti."transactionId"
           WHERE t."userId" = $1`,
          userId, SUSPICIOUS_PAISE, ALMOST_CERTAIN_PAISE,
        )
      })

      const r = rows?.[0]
      const maxPaise = r?.maxv != null ? Number(r.maxv) : 0
      const suspicious = Number(r?.suspicious ?? 0)
      const almostCertain = Number(r?.almost_certain ?? 0)

      columns.push({
        table,
        column,
        migrationLine,
        rowCount: Number(r?.n ?? 0),
        rawMinPaise: r?.minv != null ? Number(r.minv) : null,
        rawMaxPaise: maxPaise,
        // Human-readable interpretation of the raw value under BOTH hypotheses
        maxAsRupees_ifHealthy: maxPaise / 100,
        maxAsRupees_ifDoubleConverted: maxPaise / 10000,
        suspiciousRows: suspicious,
        almostCertainlyCorruptRows: almostCertain,
        verdict:
          almostCertain > 0 ? 'LIKELY_CORRUPT_100X'
            : suspicious > 0 ? 'REVIEW_MANUALLY'
              : 'LOOKS_HEALTHY',
      })
    }

    // ─── Payment rows over time: reveals the corrupt/healthy boundary ────
    // Corrupted rows cluster BEFORE the migration; rows written after it go
    // through the (correct) money extension exactly once.
    const paymentsByDay = await db.$queryRaw<Array<{
      day: Date; n: bigint; minv: bigint; maxv: bigint
    }>>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::bigint AS n,
             MIN("amount")::bigint AS minv,
             MAX("amount")::bigint AS maxv
      FROM "Payment"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL
      GROUP BY 1
      ORDER BY 1 ASC
    `

    // ─── Newest payments, raw — the fastest human confirmation ──────────
    // A ₹100 payment MUST read 10000 here. If it reads 1000000, the row is
    // double-converted.
    const recentPayments = await db.$queryRaw<Array<{
      id: string; amountPaise: bigint; type: string; createdAt: Date; partyName: string | null
    }>>`
      SELECT p."id", p."amount"::bigint AS "amountPaise", p."type", p."createdAt",
             party."name" AS "partyName"
      FROM "Payment" p
      LEFT JOIN "Party" party ON party."id" = p."partyId"
      WHERE p."userId" = ${userId} AND p."deletedAt" IS NULL
      ORDER BY p."createdAt" DESC
      LIMIT 30
    `

    // ─── Optional: one party's full payment history, raw ────────────────
    let partyPayments: any[] | undefined
    if (partyId) {
      const rows = await db.$queryRaw<Array<{
        id: string; amountPaise: bigint; type: string; date: Date; createdAt: Date
      }>>`
        SELECT "id", "amount"::bigint AS "amountPaise", "type", "date", "createdAt"
        FROM "Payment"
        WHERE "userId" = ${userId} AND "partyId" = ${partyId} AND "deletedAt" IS NULL
        ORDER BY "createdAt" ASC
      `
      partyPayments = rows.map(r => ({
        id: r.id,
        rawPaise: Number(r.amountPaise),
        readsAsRupees: Number(r.amountPaise) / 100,
        wouldBeAfterRepair: Number(r.amountPaise) / 10000,
        type: r.type,
        date: r.date,
        createdAt: r.createdAt,
      }))
    }

    const corruptColumns = columns.filter(c => c.verdict === 'LIKELY_CORRUPT_100X')

    return NextResponse.json({
      explanation:
        'Raw column values, read with $queryRaw so the money extension does NOT convert them. ' +
        'All values are PAISE: a healthy ₹100 payment reads 10000. If it reads 1000000, that row ' +
        'was multiplied by 100 twice by a re-applied migration.',
      summary: {
        columnsChecked: columns.length,
        columnsLikelyCorrupt: corruptColumns.length,
        corruptColumns: corruptColumns.map(c => `${c.table}.${c.column}`),
        verdict: corruptColumns.length > 0
          ? 'CORRUPTION DETECTED — see columns[] and repairGuidance'
          : 'No 100× signature found in the sampled bounds. Confirm against recentPayments[] by hand.',
      },
      columns,
      paymentsByDay: paymentsByDay.map(d => ({
        day: d.day,
        payments: Number(d.n),
        minPaise: Number(d.minv),
        maxPaise: Number(d.maxv),
        minReadsAsRupees: Number(d.minv) / 100,
        maxReadsAsRupees: Number(d.maxv) / 100,
      })),
      recentPayments: recentPayments.map(p => ({
        id: p.id,
        rawPaise: Number(p.amountPaise),
        readsAsRupees: Number(p.amountPaise) / 100,
        wouldBeAfterRepair: Number(p.amountPaise) / 10000,
        type: p.type,
        party: p.partyName,
        createdAt: p.createdAt,
      })),
      partyPayments,
      repairGuidance: {
        step1: 'Find rows where readsAsRupees is 100× the amount you actually entered.',
        step2: 'Back up first:  CREATE TABLE "Payment_backup_20260721" AS SELECT * FROM "Payment";',
        step3: 'Repair ONLY those rows by explicit id: GET /api/debug/repair-payment-amount?partyId=<id>&paymentIds=<id1,id2>',
        warning: 'Never repair by a rule like "divisible by 100" — that destroys legitimate ₹500 and ₹1,000 payments.',
      },
    })
  } catch (error) {
    return apiError(error, 'Paise audit failed', 500)
  }
}
