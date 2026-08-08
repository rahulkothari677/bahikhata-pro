import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney, fromPaise } from '@/lib/money'
import { apiError } from '@/lib/api-error'

/**
 * "Can I file this month, and if not, what do I fix?"
 *
 * WHY THIS EXISTS (2026-08-08). The GST screens had grown four separate warning
 * boxes in two days — missing HSN, unverified ITC, deferred credit, blocked
 * credit — each correct, each added beside the last. Stacked, they read as an
 * app in trouble rather than a shop with three small things to check, and a
 * shopkeeper cannot tell which of them stops them filing and which is merely
 * information.
 *
 * A pile of warnings is not a design. It is what happens when findings are
 * appended instead of composed.
 *
 * So this answers the question a shopkeeper actually has, once, in one call:
 * am I ready? Each check knows its own severity, so the screen can be calm when
 * things are fine and specific when they are not.
 *
 * SEVERITY IS THE POINT and is deliberately three-valued:
 *
 *   blocker — the return would be wrong or unfileable. Fix before filing.
 *   warn    — the return can be filed but something is unverified, so the
 *             shopkeeper is taking a risk they should be aware of.
 *   info    — correct and worth knowing. Credit held back under Rule 36(4) is
 *             not a problem; it is the law working. Presenting it in amber
 *             beside a real error taught the wrong thing.
 */

export interface ReadinessCheck {
  id: string
  severity: 'blocker' | 'warn' | 'info' | 'ok'
  title: string
  detail: string
  /** Rupees, when the check is about an amount. */
  amount?: number
  /** Where the shopkeeper goes to deal with it. */
  action?: { label: string; view: string }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUserId()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = auth.userId

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
    const periodStart = new Date(from)
    const periodEnd = new Date(to)

    const checks: ReadinessCheck[] = []

    /*
     * 1. Sales the HSN table cannot cover.
     *
     * A blocker, not a warning: GSTR-1 Table 12 is mandatory, and a table that
     * totals less than the turnover in the same return is the contradiction the
     * department picks up.
     */
    const [missingHsn] = await db.$queryRaw<Array<{ lineCount: bigint; taxableValue: bigint; names: string | null }>>`
      SELECT COUNT(*) AS "lineCount",
             COALESCE(SUM(ti."unitPrice" * ti."quantity" - ti."discountAmount"), 0) AS "taxableValue",
             STRING_AGG(DISTINCT ti."productName", ', ') AS "names"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t."id"
      WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL
        AND t."type" IN ('sale', 'credit-note')
        AND t."date" >= ${periodStart} AND t."date" <= ${periodEnd}
        AND (ti."hsn" IS NULL OR ti."hsn" = '')
    `
    const missingCount = Number(missingHsn?.lineCount || 0)
    if (missingCount > 0) {
      const names = (missingHsn?.names || '').split(', ').filter(Boolean).slice(0, 3)
      checks.push({
        id: 'hsn-missing',
        severity: 'blocker',
        title: `${missingCount} ${missingCount === 1 ? 'sale is' : 'sales are'} missing an HSN code`,
        detail: names.length
          ? `Add the code on ${names.join(', ')}${names.length < 3 ? '' : ' and others'}, then future sales carry it automatically.`
          : 'Add HSN codes on these products so they appear in your GST return.',
        amount: roundMoney(fromPaise(Number(missingHsn?.taxableValue || 0))),
        action: { label: 'Open Inventory', view: 'inventory' },
      })
    } else {
      checks.push({
        id: 'hsn-missing',
        severity: 'ok',
        title: 'Every sale has an HSN code',
        detail: 'Your HSN summary covers the whole month.',
      })
    }

    /*
     * 2. Has input credit been checked against GSTR-2B?
     *
     * A warning rather than a blocker: the return CAN be filed on book figures.
     * But under Rule 36(4) the claim may be too high, and an over-claim is
     * repaid later with interest — so the shopkeeper should know they are
     * taking that risk, not be stopped.
     */
    const monthYear = (() => {
      const ist = new Date(periodStart.getTime() + 5.5 * 60 * 60 * 1000)
      return String(ist.getUTCMonth() + 1).padStart(2, '0') + String(ist.getUTCFullYear())
    })()
    const twoB = await db.gstr2bImport.findFirst({ where: { userId, monthYear }, select: { id: true, invoiceCount: true } })
    const purchaseCount = await db.transaction.count({
      where: { userId, type: 'purchase', deletedAt: null, date: { gte: periodStart, lte: periodEnd } },
    })
    if (!twoB && purchaseCount > 0) {
      checks.push({
        id: 'itc-unverified',
        severity: 'warn',
        title: 'Input credit has not been checked against GSTR-2B',
        detail: 'You can only claim credit on bills your suppliers have actually filed. Import this month’s GSTR-2B and the claim is worked out for you.',
        action: { label: 'Import GSTR-2B', view: 'reports' },
      })
    } else if (twoB) {
      checks.push({
        id: 'itc-unverified',
        severity: 'ok',
        title: 'Input credit checked against GSTR-2B',
        detail: `Matched against ${twoB.invoiceCount} ${twoB.invoiceCount === 1 ? 'bill' : 'bills'} from the portal.`,
      })
    }

    /*
     * 3. Credit blocked under Section 17(5).
     *
     * INFO, deliberately. The shopkeeper marked these themselves and the law
     * agrees. Showing it in amber next to a real problem taught them to
     * distrust a correct figure.
     */
    const blocked = await db.transaction.aggregate({
      where: {
        userId, type: 'purchase', deletedAt: null,
        date: { gte: periodStart, lte: periodEnd },
        itcBlockedReason: { not: null },
      },
      _sum: { cgst: true, sgst: true, igst: true },
      _count: { _all: true },
    })
    const blockedCount = blocked._count._all
    if (blockedCount > 0) {
      checks.push({
        id: 'itc-blocked',
        severity: 'info',
        title: 'Some GST cannot be claimed back',
        detail: `You marked ${blockedCount} ${blockedCount === 1 ? 'purchase' : 'purchases'} as not eligible — things like personal use, staff food or a vehicle. That is correct; the law does not allow credit on these.`,
        amount: roundMoney((blocked._sum.cgst || 0) + (blocked._sum.sgst || 0) + (blocked._sum.igst || 0)),
      })
    }

    const blockers = checks.filter((c) => c.severity === 'blocker').length
    const warnings = checks.filter((c) => c.severity === 'warn').length

    return NextResponse.json({
      period: { from: periodStart.toISOString(), to: periodEnd.toISOString() },
      ready: blockers === 0,
      blockers,
      warnings,
      checks,
    })
  } catch (err) {
    return apiError(err, 'Failed to check filing readiness', 500)
  }
}
