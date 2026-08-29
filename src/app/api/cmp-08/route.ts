import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { compositionWindow, sliceForComposition } from '@/lib/composition-window'
import { roundMoney } from '@/lib/money'
import {
  compositionTaxFor, compositionLimitFor, cmp08DueDate,
  COMPOSITION_RATES, type CompositionCategory,
} from '@/lib/composition-scheme'
import { deriveStateCode } from '@/lib/gst'

/**
 * CMP-08 — the quarterly statement a composition dealer files.
 *
 * WHY IT IS NOT A VARIANT OF GSTR-3B. A composition dealer collects no tax, so
 * there is no output tax to declare and no input credit to net off. The whole
 * return is one number — turnover for the quarter — and a flat percentage of
 * it, paid from their own margin. Reusing the 3B machinery would drag in the
 * concepts the scheme exists to remove.
 *
 * Quarterly, not monthly, and due on the 18th of the month after the quarter.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId

    const q = new URL(req.url).searchParams.get('quarter')   // e.g. 2026-Q2
    if (!q || !/^\d{4}-Q[1-4]$/.test(q)) {
      return NextResponse.json({ error: 'quarter is required (YYYY-Qn, e.g. 2026-Q2)' }, { status: 400 })
    }
    const [yStr, qStr] = q.split('-Q')
    const year = Number(yStr)
    const qtr = Number(qStr)

    /*
     * Indian financial-year quarters: Q1 is Apr-Jun, not Jan-Mar. Using
     * calendar quarters would file the wrong three months and the shopkeeper
     * would not notice until a notice arrived.
     */
    const startMonth = [3, 6, 9, 0][qtr - 1]          // Apr, Jul, Oct, Jan
    const startYear = qtr === 4 ? year + 1 : year
    const periodStart = new Date(startYear, startMonth, 1)
    const periodEnd = new Date(startYear, startMonth + 3, 1)

    const setting = await db.setting.findUnique({
      where: { userId },
      select: { compositionCategory: true, gstin: true, state: true, compositionFrom: true, compositionTo: true },
    })
    const category = (setting?.compositionCategory || null) as CompositionCategory | null

    if (!category) {
      return NextResponse.json({
        error: 'Not registered under the composition scheme',
        message: 'CMP-08 is only for composition dealers. Your shop is on the regular scheme, which files GSTR-1 and GSTR-3B.',
      }, { status: 400 })
    }

    /*
     * THE QUARTER SPLITS AT THE EXIT DATE.
     *
     * Crossing ₹1.5 crore ends composition on the crossing date itself, with
     * no grace period — from then the shop issues tax invoices and charges
     * regular GST. Charging composition tax on the whole quarter regardless
     * put 1% on top of turnover the shop had ALREADY paid regular GST on.
     * Real double taxation, and only for shops that are growing.
     *
     * One shared function decides the window, because GSTR-4 needs the same
     * answer and two date filters written separately would drift.
     */
    const slice = sliceForComposition(
      compositionWindow(setting as never),
      periodStart,
      periodEnd,
    )
    if (!slice) {
      return NextResponse.json({
        error: 'Not on the composition scheme for this quarter',
        message: 'Your shop was not a composition dealer during this quarter, so there is no CMP-08 to file for it. Check the dates in Settings.',
      }, { status: 400 })
    }
    const from = slice.compositionStart
    const to = slice.compositionEnd

    /*
     * Turnover, not taxable value. There is no per-invoice tax to strip out —
     * a composition dealer's bills carry none — so the total of what was sold
     * IS the base the rate applies to.
     */
    const sales = await db.transaction.aggregate({
      where: { userId, type: 'sale', deletedAt: null, date: { gte: from, lt: to } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    })
    const creditNotes = await db.transaction.aggregate({
      where: { userId, type: 'credit-note', deletedAt: null, date: { gte: from, lt: to } },
      _sum: { totalAmount: true },
    })

    // Returns reduce turnover; the dealer does not pay on money given back.
    const turnover = roundMoney(
      (sales._sum.totalAmount || 0) - (creditNotes._sum.totalAmount || 0),
    )
    const tax = compositionTaxFor(turnover, category)
    const stateCode = deriveStateCode(null, null, setting?.gstin || null, setting?.state || null)
    const limit = compositionLimitFor(category, stateCode)

    return NextResponse.json({
      quarter: q,
      /*
       * The period ACTUALLY charged, which is not always the quarter. A shop
       * that left mid-quarter is charged to its exit date only — reporting the
       * full quarter here would show a range the figures do not cover.
       */
      period: { from: from.toISOString(), to: to.toISOString() },
      quarterPeriod: { from: periodStart.toISOString(), to: periodEnd.toISOString() },
      /*
       * Said on screen, not buried. A shopkeeper looking at a CMP-08 that
       * covers six weeks of a thirteen-week quarter needs to know why, and
       * needs telling that the rest belongs in GSTR-1/3B — otherwise the
       * missing turnover looks like our arithmetic failing.
       */
      leftMidQuarter: slice.splitsMidPeriod,
      splitNote: slice.note,
      regularPeriod: slice.splitsMidPeriod
        ? { from: slice.regularStart!.toISOString(), to: slice.regularEnd!.toISOString() }
        : null,
      category,
      categoryLabel: COMPOSITION_RATES[category].label,
      ...tax,
      invoiceCount: sales._count._all,
      dueDate: cmp08DueDate(startYear, ((startMonth + 3) % 12) || 12).toISOString(),
      /*
       * Surfaced, not enforced. Crossing the ceiling means leaving the scheme,
       * which is a decision with consequences the app cannot make for anyone —
       * but a dealer who does not notice keeps filing the wrong return.
       */
      turnoverLimit: limit,
      overLimit: turnover > limit,
    })
  } catch (err) {
    return apiError(err, 'Failed to compute CMP-08', 500)
  }
}
