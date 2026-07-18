import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { fromPaise } from '@/lib/money'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/debug/repair-payment-amount?partyId=<id>&dryRun=true
 *
 * V26 M11 deep fix: Anita Singh's ₹990 divergence was traced to
 * `paymentsReceived` — the raw SQL path returns 100× the Prisma path for
 * the same payment. This means at least one Payment.amount value is stored
 * 100× too high (likely a double-conversion bug during create).
 *
 * This endpoint:
 *   1. Scans all payments for the user (or a specific party) using raw SQL
 *      (to bypass the money extension's read conversion and see the actual
 *      stored paise value).
 *   2. Flags payments where `amount` is divisible by 100 AND > 10000 paise
 *      (₹100) — these are suspicious (likely 100× inflated).
 *   3. In dry-run mode (default): reports what would be repaired.
 *   4. In live mode (dryRun=false): divides flagged amounts by 100.
 *
 * Auth: owner only.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authCtx.role !== 'owner') {
      return NextResponse.json({ error: 'Owner only' }, { status: 403 })
    }
    const userId = authCtx.userId

    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')
    const dryRun = searchParams.get('dryRun') !== 'false'  // default true

    // ─── Scan: find all payments via raw SQL (bypasses money extension) ─
    const payments = partyId
      ? await db.$queryRaw<Array<{
          id: string; partyId: string | null; partyName: string | null
          type: string; amountPaise: bigint; date: Date; createdAt: Date; deletedAt: Date | null
        }>>`
          SELECT p."id", p."partyId", party."name" AS "partyName",
                 p."type", p."amount" AS "amountPaise",
                 p."date", p."createdAt", p."deletedAt"
          FROM "Payment" p
          LEFT JOIN "Party" party ON party."id" = p."partyId"
          WHERE p."userId" = ${userId} AND p."partyId" = ${partyId}
          ORDER BY p."date" ASC
        `
      : await db.$queryRaw<Array<{
          id: string; partyId: string | null; partyName: string | null
          type: string; amountPaise: bigint; date: Date; createdAt: Date; deletedAt: Date | null
        }>>`
          SELECT p."id", p."partyId", party."name" AS "partyName",
                 p."type", p."amount" AS "amountPaise",
                 p."date", p."createdAt", p."deletedAt"
          FROM "Payment" p
          LEFT JOIN "Party" party ON party."id" = p."partyId"
          WHERE p."userId" = ${userId}
          ORDER BY p."date" ASC
        `

    // ─── Flag suspicious payments ────────────────────────────────────────
    // A payment is "suspicious" if amount is divisible by 100 AND > 10000
    // paise (₹100). These MAY be 100× inflated (double-conversion bug).
    // The user must review before repairing — this is a heuristic.
    const suspicious = payments.filter(p => {
      const amt = Number(p.amountPaise)
      return amt > 10000 && amt % 100 === 0
    })

    // ─── Repair (if not dry-run) ─────────────────────────────────────────
    let repaired = 0
    const repairedRows: Array<{
      id: string; partyName: string | null; type: string
      amountBeforePaise: number; amountAfterPaise: number
      amountBeforeRupees: number; amountAfterRupees: number
    }> = []

    if (!dryRun && suspicious.length > 0) {
      for (const p of suspicious) {
        const oldAmount = Number(p.amountPaise)
        const newAmount = Math.round(oldAmount / 100)
        await db.$executeRaw`
          UPDATE "Payment" SET "amount" = ${newAmount} WHERE "id" = ${p.id}
        `
        repaired++
        repairedRows.push({
          id: p.id, partyName: p.partyName, type: p.type,
          amountBeforePaise: oldAmount, amountAfterPaise: newAmount,
          amountBeforeRupees: fromPaise(oldAmount),
          amountAfterRupees: fromPaise(newAmount),
        })
      }
    }

    return NextResponse.json({
      mode: dryRun ? 'dry-run' : 'live',
      scanned: payments.length,
      suspicious: suspicious.length,
      repaired: dryRun ? 0 : repaired,
      suspiciousPayments: suspicious.map(p => {
        const amt = Number(p.amountPaise)
        return {
          id: p.id, partyId: p.partyId, partyName: p.partyName, type: p.type,
          amountPaise: amt,
          amountRupees: fromPaise(amt),
          proposedAmountPaise: Math.round(amt / 100),
          proposedAmountRupees: fromPaise(Math.round(amt / 100)),
          date: p.date, createdAt: p.createdAt, deletedAt: p.deletedAt,
        }
      }),
      allPayments: payments.map(p => ({
        id: p.id, partyName: p.partyName, type: p.type,
        amountPaise: Number(p.amountPaise),
        amountRupees: fromPaise(Number(p.amountPaise)),
        date: p.date, deletedAt: p.deletedAt,
      })),
      interpretation:
        suspicious.length === 0
          ? `✅ No suspicious payments found. The ₹990 divergence is NOT caused by a 100x payment-amount bug. Review the allPayments list to see every payment's raw stored value. If the stored amount looks correct but the balance still diverges, the issue is in how getReceivablePayable's SQL computes the sum vs how computePartyBalance's Prisma aggregate computes it.`
          : dryRun
            ? `⚠️ Found ${suspicious.length} suspicious payment(s) where amount is divisible by 100 and > ₹100. These MAY be 100x inflated (double-conversion bug). Review the suspiciousPayments list. If they look wrong, re-run with dryRun=false to repair (divides each by 100). After repair, hit /api/debug/party-balance-recon again.`
            : `✅ Repaired ${repaired} payment(s) — divided each suspicious amount by 100. Hit /api/debug/party-balance-recon again to verify.`,
    })
  } catch (err) {
    return apiError(err, 'Failed to scan/repair payment amounts', 500)
  }
}
