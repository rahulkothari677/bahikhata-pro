import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireFounder, isRepairAllowed } from '@/lib/debug-auth'
import { fromPaise } from '@/lib/money'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/debug/repair-payment-amount?partyId=<id>
 * GET /api/debug/repair-payment-amount?paymentIds=id1,id2,id3
 *
 * V26 M11 repair tool for 100× inflated Payment.amount values.
 *
 * 🔒 V26 AUDITOR HARDENING: This endpoint was originally a blanket heuristic
 * that flagged every payment > ₹100 divisible by 100 and divided them all by
 * 100 in live mode. That's DANGEROUS — it would corrupt every legitimate
 * ₹200/₹500/₹1,000 cash payment in a kirana shop. The auditor caught this.
 *
 * NOW: Live mode REQUIRES explicit payment IDs. The endpoint:
 *   - Without paymentIds: runs in SCAN mode (dry-run only, reports all
 *     payments + flags suspicious ones for manual review).
 *   - With paymentIds: runs in REPAIR mode — divides ONLY the specified
 *     payment IDs by 100. No blanket heuristic. The user must review the
 *     scan output and manually pass the IDs they want repaired.
 *
 * Query params:
 *   partyId     — optional, restrict scan to one party (scan mode only)
 *   paymentIds  — comma-separated list of payment IDs to repair (repair mode)
 *                 REQUIRED for any actual repair. If omitted, always dry-run.
 *
 * Auth: owner only.
 */
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const founderCheck = await requireFounder()
    if ('error' in founderCheck) return founderCheck.error
    const userId = founderCheck.userId

    // 🔒 V26 S2: In production, repair endpoints must be explicitly enabled.
    if (!isRepairAllowed()) {
      return NextResponse.json({
        error: 'Repair endpoints disabled in production',
        message: 'Set ALLOW_REPAIR_ENDPOINTS=true in production to enable this endpoint.',
      }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')
    const paymentIdsParam = searchParams.get('paymentIds')

    // ─── Determine mode ──────────────────────────────────────────────────
    // REPAIR mode requires explicit paymentIds. Without them, it's always
    // a scan (dry-run) — no blanket repairs.
    const isRepairMode = !!paymentIdsParam
    const targetPaymentIds = paymentIdsParam
      ? paymentIdsParam.split(',').map(s => s.trim()).filter(Boolean)
      : []

    if (isRepairMode && targetPaymentIds.length === 0) {
      return NextResponse.json({
        error: 'paymentIds parameter is empty',
        message: 'To repair payments, pass explicit payment IDs: ?paymentIds=id1,id2,id3. Without paymentIds, the endpoint runs in scan-only mode (no repairs).',
      }, { status: 400 })
    }

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

    // ─── Flag suspicious payments for MANUAL REVIEW (not auto-repair) ───
    // A payment is "suspicious" if amount is divisible by 100 AND > 10000
    // paise (₹100). This is a HINT for the user, NOT a repair trigger.
    // Many legitimate payments match this pattern (₹200, ₹500, ₹1,000 cash).
    // The user must manually verify and pass explicit IDs to repair.
    const suspicious = payments.filter(p => {
      const amt = Number(p.amountPaise)
      return amt > 10000 && amt % 100 === 0
    })

    // ─── Repair mode: divide ONLY explicitly-specified payment IDs ──────
    let repaired = 0
    const repairedRows: Array<{
      id: string; partyName: string | null; type: string
      amountBeforePaise: number; amountAfterPaise: number
      amountBeforeRupees: number; amountAfterRupees: number
    }> = []
    const notFoundIds: string[] = []

    if (isRepairMode) {
      for (const paymentId of targetPaymentIds) {
        // Find the payment in our scan results (verify ownership + get current value)
        const payment = payments.find(p => p.id === paymentId)
        if (!payment) {
          notFoundIds.push(paymentId)
          continue
        }

        const oldAmount = Number(payment.amountPaise)
        const newAmount = Math.round(oldAmount / 100)
        await db.$executeRaw`
          UPDATE "Payment" SET "amount" = ${newAmount} WHERE "id" = ${paymentId}
        `
        repaired++
        repairedRows.push({
          id: paymentId, partyName: payment.partyName, type: payment.type,
          amountBeforePaise: oldAmount, amountAfterPaise: newAmount,
          amountBeforeRupees: fromPaise(oldAmount),
          amountAfterRupees: fromPaise(newAmount),
        })
      }
    }

    return NextResponse.json({
      mode: isRepairMode ? 'repair' : 'scan',
      scanned: payments.length,
      suspicious: suspicious.length,
      repaired: isRepairMode ? repaired : 0,
      notFoundIds,
      targetPaymentIds,
      suspiciousPayments: suspicious.map(p => {
        const amt = Number(p.amountPaise)
        return {
          id: p.id, partyId: p.partyId, partyName: p.partyName, type: p.type,
          amountPaise: amt,
          amountRupees: fromPaise(amt),
          proposedAmountPaise: Math.round(amt / 100),
          proposedAmountRupees: fromPaise(Math.round(amt / 100)),
          date: p.date, createdAt: p.createdAt, deletedAt: p.deletedAt,
          // ⚠️ IMPORTANT: "suspicious" does NOT mean "definitely wrong."
          // ₹500 cash payment is suspicious by this heuristic but is probably
          // legitimate. The user MUST review each one before passing its ID
          // to repair mode.
          warning: 'This payment matches the 100x heuristic but may be legitimate. Only repair if you have independent confirmation it was 100x inflated (e.g. detail-vs-list balance divergence for this party).',
        }
      }),
      allPayments: payments.map(p => ({
        id: p.id, partyName: p.partyName, type: p.type,
        amountPaise: Number(p.amountPaise),
        amountRupees: fromPaise(Number(p.amountPaise)),
        date: p.date, deletedAt: p.deletedAt,
      })),
      interpretation:
        isRepairMode
          ? notFoundIds.length > 0
            ? `⚠️ Repaired ${repaired} payment(s). ${notFoundIds.length} payment ID(s) not found (they may belong to another user or not exist): ${notFoundIds.join(', ')}. Hit /api/debug/party-balance-recon to verify.`
            : `✅ Repaired ${repaired} payment(s) — divided each specified ID by 100. Hit /api/debug/party-balance-recon to verify.`
          : suspicious.length === 0
            ? `✅ No suspicious payments found. Review the allPayments list to see every payment's raw stored value.`
            : `📋 SCAN MODE (no repairs performed). Found ${suspicious.length} suspicious payment(s) — these match the 100x heuristic (amount > ₹100 AND divisible by 100) but MAY be legitimate (e.g. ₹500 cash payment). Review the suspiciousPayments list carefully. To repair specific payments, re-run with ?paymentIds=id1,id2 (comma-separated). DO NOT repair all suspicious payments blindly — most are probably legitimate.`,
    })
  } catch (err) {
    return apiError(err, 'Failed to scan/repair payment amounts', 500)
  }
}
