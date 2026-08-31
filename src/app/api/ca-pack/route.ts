import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { roundMoney } from '@/lib/money'
import { buildCaPack, type CaPackWarning } from '@/lib/ca-pack'
import { assessItcReversal, needsAttention, RULE_37_DAYS, WARN_WITHIN_DAYS } from '@/lib/itc-180-day'
import { reviewProduct } from '@/lib/exempt-reclassification'
import { imsWindow } from '@/lib/ims-deadline'

/**
 * #33 — the month's pack, for a CA who will not create an account.
 *
 * READS THE STORED SNAPSHOTS, and computes nothing about money.
 *
 * That is the whole constraint. Every figure in the pack must be the one
 * already shown on screen, or the pack becomes a second opinion about the same
 * month — the drift class behind four bugs in this codebase, and worst here:
 * a pack that disagrees with the screen it came from destroys the trust the
 * feature exists for.
 *
 * The WARNINGS are assembled from the same pure rules the screens use —
 * itc-180-day, exempt-reclassification, ims-deadline — rather than re-derived,
 * for the same reason.
 */
export const maxDuration = 60

/* Enough to notice a problem; a CA reading on a phone will not scroll past it. */
const MAX_WARNINGS = 8

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId

    const monthParam = new URL(req.url).searchParams.get('month')
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 })
    }
    const [year, month] = monthParam.split('-').map(Number)
    const monthYear = String(month).padStart(2, '0') + String(year)

    const [setting, snap1, snap3b] = await Promise.all([
      db.setting.findUnique({ where: { userId }, select: { shopName: true, gstin: true } }),
      db.gstr1Snapshot.findUnique({ where: { userId_monthYear: { userId, monthYear } } }),
      db.gstReturn.findUnique({ where: { userId_monthYear: { userId, monthYear } } }),
    ])

    const warnings: CaPackWarning[] = []
    const today = new Date()

    /*
     * 1. Do the two returns agree? Rule 88C, the most expensive thing on the
     *    list, so it is gathered first and appears first.
     *
     * Compared from the two STORED snapshots — the figures actually filed —
     * not recomputed from transactions, which could legitimately differ if the
     * books moved after filing and would make the pack disagree with itself.
     */
    let returnsAgree: { agree: boolean; difference: number } | null = null
    if (snap1 && snap3b) {
      const g1Tax = roundMoney(snap1.totalOutputTax)
      const g3Tax = roundMoney(snap3b.outwardCgst + snap3b.outwardSgst + snap3b.outwardIgst)
      const difference = roundMoney(Math.abs(g1Tax - g3Tax))
      returnsAgree = { agree: difference < 1, difference }
      if (difference >= 1) {
        warnings.push({
          title: 'GSTR-1 and GSTR-3B do not agree',
          amount: `₹${difference.toLocaleString('en-IN')}`,
          detail: 'Rule 88C: the portal issues an intimation on its own and blocks the next GSTR-1 until it is answered.',
        })
      }
    }

    /*
     * 2. Input credit lapsing at 180 days. Same date band the warning screen
     *    uses, so the pack cannot list something the app does not show.
     */
    const horizon = new Date(today); horizon.setDate(horizon.getDate() - (RULE_37_DAYS - WARN_WITHIN_DAYS))
    const floor = new Date(today); floor.setDate(floor.getDate() - 730)
    const purchases = await db.transaction.findMany({
      where: { userId, type: 'purchase', deletedAt: null, isReverseCharge: false, date: { gte: floor, lte: horizon } },
      select: {
        date: true, totalAmount: true, paidAmount: true, cgst: true, sgst: true, igst: true,
        itcBlockedReason: true, isReverseCharge: true,
        paymentAllocations: { select: { amount: true, payment: { select: { date: true, deletedAt: true } } } },
      },
      take: 1000,
    })
    let itcAtRisk = 0
    let itcCount = 0
    for (const t of purchases) {
      const a = assessItcReversal({
        invoiceDate: t.date,
        totalAmount: roundMoney(t.totalAmount),
        paidAmount: roundMoney(t.paidAmount),
        allocations: t.paymentAllocations.filter(x => !x.payment.deletedAt)
          .map(x => ({ amount: roundMoney(x.amount), date: x.payment.date })),
        taxAmount: roundMoney(t.cgst) + roundMoney(t.sgst) + roundMoney(t.igst),
        isReverseCharge: t.isReverseCharge,
        itcBlockedReason: t.itcBlockedReason,
      }, today)
      if (needsAttention(a)) { itcAtRisk = roundMoney(itcAtRisk + a.itcAtRisk); itcCount++ }
    }
    if (itcCount > 0) {
      warnings.push({
        title: `Input credit at risk on ${itcCount} purchase${itcCount === 1 ? '' : 's'}`,
        amount: `₹${itcAtRisk.toLocaleString('en-IN')}`,
        detail: 'Suppliers unpaid at or past 180 days. Section 16(2) second proviso and Rule 37 — reversal with interest until they are paid.',
      })
    }

    /*
     * 3. Items still classified under the cancelled exemption notification.
     *    Only zero-rated products can disagree, filtered in the database.
     */
    const zeroRated = await db.product.findMany({
      where: { userId, gstRate: 0 },
      select: { hsn: true, gstRate: true, gstTreatment: true, gstTreatmentConfirmedAt: true },
      take: 2000,
    })
    const stale = zeroRated.filter(p => reviewProduct(p).verdict !== 'ok').length
    if (stale > 0) {
      warnings.push({
        title: `${stale} item${stale === 1 ? '' : 's'} classified under the cancelled notification`,
        amount: '',
        detail: 'Sorted against 02/2017-CT(R), superseded by 10/2025. Exempt and nil-rated go in different GSTR-1 boxes.',
      })
    }

    /*
     * 4. The IMS deadline — only while it can still be acted on. After the
     *    14th the shopkeeper cannot change what was deemed accepted from here,
     *    so listing it would be noise on a pack about a closed month.
     */
    const ims = imsWindow(monthYear, snap3b?.filingStatus === 'filed', today)
    if (ims.state === 'closing' || ims.state === 'open') {
      const twoB = await db.gstr2bImport.findUnique({
        where: { userId_monthYear: { userId, monthYear } },
        select: { invoiceCount: true },
      })
      if (twoB) {
        warnings.push({
          title: `IMS: ${ims.daysLeft} day${ims.daysLeft === 1 ? '' : 's'} before invoices are accepted automatically`,
          amount: '',
          detail: 'Anything not acted on is deemed accepted when GSTR-2B generates, along with the supplier’s tax treatment.',
        })
      }
    }

    const monthLabel = new Date(year, month - 1, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

    const text = buildCaPack({
      shopName: setting?.shopName || 'My Shop',
      gstin: setting?.gstin || null,
      monthLabel,
      gstr1: snap1 ? {
        filingStatus: snap1.filingStatus,
        taxableValue: roundMoney(snap1.totalTaxableValue),
        outputTax: roundMoney(snap1.totalOutputTax),
        invoiceCount: snap1.totalInvoiceCount,
      } : null,
      gstr3b: snap3b ? {
        filingStatus: snap3b.filingStatus,
        outputTax: roundMoney(snap3b.outwardCgst + snap3b.outwardSgst + snap3b.outwardIgst),
        itcClaimed: roundMoney(snap3b.itcCgst + snap3b.itcSgst + snap3b.itcIgst),
        netPayable: roundMoney(snap3b.netTaxPayable),
      } : null,
      returnsAgree,
      warnings: warnings.slice(0, MAX_WARNINGS),
    })

    return NextResponse.json({
      month: monthParam,
      text,
      warningCount: warnings.length,
      truncated: warnings.length > MAX_WARNINGS,
    })
  } catch (error) {
    return apiError(error, 'Failed to build the CA pack', 500)
  }
}
