import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireFounder, isRepairAllowed } from '@/lib/debug-auth'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/debug/repair-null-paidamount
 *
 * V26 M11 repair: finds all transactions with NULL paidAmount and sets them
 * to 0 (the schema default). This repairs the root cause of the Anita Singh
 * ₹990 divergence — a transaction with NULL paidAmount made the raw SQL path
 * (getReceivablePayable) skip the row while the Prisma path
 * (computePartyBalance) counted it.
 *
 * The V26 M11 SQL fix (COALESCE(paidAmount, 0)) makes both paths agree going
 * forward, but existing NULL values in the DB should still be cleaned up so
 * the data is consistent at rest (not just at read time).
 *
 * Uses raw SQL for the scan because Prisma's TypeScript types don't allow
 * querying NULL on a required Int column (paidAmount has @default(0) but
 * legacy data can still have NULL from before the default was added).
 *
 * Auth: owner only.
 */
export const maxDuration = 60

export async function POST() {
  try {
    const founderCheck = await requireFounder()
    if ('error' in founderCheck) return founderCheck.error
    const userId = founderCheck.userId

    // 🔒 V26 S2: In production, repair endpoints must be explicitly enabled
    // via ALLOW_REPAIR_ENDPOINTS=true. This prevents accidental data mutation
    // in production unless deliberately enabled.
    if (!isRepairAllowed()) {
      return NextResponse.json({
        error: 'Repair endpoints disabled in production',
        message: 'Set ALLOW_REPAIR_ENDPOINTS=true in production to enable this endpoint.',
      }, { status: 403 })
    }

    // ─── Scan: find NULL paidAmount transactions BEFORE repair ─────────
    // Raw SQL because Prisma's TS types reject `paidAmount: null` on a
    // required Int field.
    const nullBeforeRows = await db.$queryRaw<Array<{
      id: string
      type: string
      invoiceNo: string | null
      date: Date
      totalAmountPaise: bigint
      partyId: string | null
      partyName: string | null
      createdAt: Date
    }>>`
      SELECT t."id", t."type", t."invoiceNo", t."date",
             t."totalAmount" AS "totalAmountPaise",
             t."partyId",
             p."name" AS "partyName",
             t."createdAt"
      FROM "Transaction" t
      LEFT JOIN "Party" p ON p."id" = t."partyId"
      WHERE t."userId" = ${userId}
        AND t."paidAmount" IS NULL
      ORDER BY t."date" ASC
    `
    const nullBefore = nullBeforeRows.length

    // Count total transactions for scope context
    const scanned = await db.transaction.count({ where: { userId } })

    // Collect affected parties
    const affectedPartiesSet = new Set<string>()
    for (const row of nullBeforeRows) {
      if (row.partyId) affectedPartiesSet.add(row.partyId)
    }

    // ─── Repair: set NULL paidAmount → 0 ────────────────────────────────
    // Raw SQL updateMany (Prisma's updateMany has the same type issue).
    const repairResult = await db.$executeRaw`
      UPDATE "Transaction"
      SET "paidAmount" = 0
      WHERE "userId" = ${userId}
        AND "paidAmount" IS NULL
    `
    const repaired = repairResult

    // ─── Verify: count NULL paidAmount AFTER repair ─────────────────────
    const nullAfterRows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND "paidAmount" IS NULL
    `
    const nullAfter = Number(nullAfterRows[0]?.count ?? 0)

    return NextResponse.json({
      scanned,
      nullBefore,
      repaired,
      affectedParties: Array.from(affectedPartiesSet),
      affectedPartyCount: affectedPartiesSet.size,
      nullAfter,
      sampleRepairedRows: nullBeforeRows.slice(0, 10).map(r => ({
        id: r.id,
        type: r.type,
        invoiceNo: r.invoiceNo,
        date: r.date,
        totalAmountPaise: Number(r.totalAmountPaise),
        paidAmountBefore: null,
        paidAmountAfter: 0,
        partyId: r.partyId,
        partyName: r.partyName,
        createdAt: r.createdAt,
      })),
      interpretation:
        nullBefore === 0
          ? `✅ No NULL paidAmount transactions found — data is already clean. The ₹990 divergence (if still present) is NOT caused by NULL paidAmount. Hit /api/debug/party-balance-detail?partyId=<id> for the diverged party to investigate further.`
          : `✅ Repaired ${repaired} transaction(s) with NULL paidAmount (set to 0). ${affectedPartiesSet.size} party(es) affected. After repair, hit /api/debug/party-balance-recon again — the divergence should now be gone (or reduced). If the divergence was ₹990 and a NULL-paidAmount sale of ₹990 was found above, this was the root cause.`,
    })
  } catch (err) {
    return apiError(err, 'Failed to repair NULL paidAmount', 500)
  }
}
