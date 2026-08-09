import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { roundMoney } from '@/lib/money'
import { compositionTaxFor, COMPOSITION_RATES, type CompositionCategory } from '@/lib/composition-scheme'

/**
 * GSTR-4 — a composition dealer's ANNUAL return.
 *
 * CMP-08 is the quarterly payment; this is the yearly declaration that squares
 * it. Due 30 June following the financial year (Notification 12/2024).
 *
 * THE TRAP THIS EXISTS TO AVOID. Table 6 is where the whole year's outward
 * supplies are declared. Leaving it blank is the single most common GSTR-4
 * mistake, and it is a natural one — the dealer has already PAID every quarter
 * through CMP-08, so declaring it again feels redundant.
 *
 * It is not. The portal reads an empty Table 6 as "no liability arose this
 * year", and then treats everything paid through CMP-08 as EXCESS. That excess
 * lands in the Negative Liability Statement, gets adjusted against later
 * quarters, and eventually produces a demand notice for tax the dealer already
 * paid on time. Thousands of dealers were caught by exactly this.
 *
 * So Table 6 is filled from the books here, always, and the screen says why.
 *
 *   Net payable = tax on Table 6 (outward) + RCM inward − Table 5 (CMP-08 paid)
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

    const fy = new URL(req.url).searchParams.get('fy')       // e.g. 2026-27
    if (!fy || !/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json({ error: 'fy is required (YYYY-YY, e.g. 2026-27)' }, { status: 400 })
    }
    const startYear = Number(fy.slice(0, 4))
    // Indian financial year: 1 April to 31 March.
    const fyStart = new Date(startYear, 3, 1)
    const fyEnd = new Date(startYear + 1, 3, 1)

    const setting = await db.setting.findUnique({
      where: { userId },
      select: { compositionCategory: true },
    })
    const category = (setting?.compositionCategory || null) as CompositionCategory | null
    if (!category) {
      return NextResponse.json({
        error: 'Not registered under the composition scheme',
        message: 'GSTR-4 is the composition dealer’s annual return. Your shop is on the regular scheme.',
      }, { status: 400 })
    }

    const [sales, creditNotes, rcm] = await Promise.all([
      db.transaction.aggregate({
        where: { userId, type: 'sale', deletedAt: null, date: { gte: fyStart, lt: fyEnd } },
        _sum: { totalAmount: true }, _count: { _all: true },
      }),
      db.transaction.aggregate({
        where: { userId, type: 'credit-note', deletedAt: null, date: { gte: fyStart, lt: fyEnd } },
        _sum: { totalAmount: true },
      }),
      /*
       * Table 4B/C/D — purchases on which the DEALER owes tax under reverse
       * charge. A composition dealer claims no credit, so this is a straight
       * cost to them and is the one place they pay at the normal rate rather
       * than the composition rate.
       */
      db.transaction.aggregate({
        where: { userId, type: 'purchase', deletedAt: null, isReverseCharge: true, date: { gte: fyStart, lt: fyEnd } },
        _sum: { subtotal: true, cgst: true, sgst: true, igst: true },
      }),
    ])

    // Table 6 — the whole year's outward supplies, net of credit notes.
    const turnover = roundMoney((sales._sum.totalAmount || 0) - (creditNotes._sum.totalAmount || 0))
    const outward = compositionTaxFor(turnover, category)

    const rcmTax = roundMoney((rcm._sum.cgst || 0) + (rcm._sum.sgst || 0) + (rcm._sum.igst || 0))

    /*
     * Table 5 — what was already paid, quarter by quarter.
     *
     * Computed from the same books the quarterly CMP-08 was, so the two agree
     * by construction. Four quarters, Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar.
     */
    const quarters = []
    let paidTotal = 0
    for (let q = 0; q < 4; q++) {
      const qStart = new Date(startYear, 3 + q * 3, 1)
      const qEnd = new Date(startYear, 3 + q * 3 + 3, 1)
      const [qs, qcn] = await Promise.all([
        db.transaction.aggregate({
          where: { userId, type: 'sale', deletedAt: null, date: { gte: qStart, lt: qEnd } },
          _sum: { totalAmount: true },
        }),
        db.transaction.aggregate({
          where: { userId, type: 'credit-note', deletedAt: null, date: { gte: qStart, lt: qEnd } },
          _sum: { totalAmount: true },
        }),
      ])
      const qTurnover = roundMoney((qs._sum.totalAmount || 0) - (qcn._sum.totalAmount || 0))
      const qTax = compositionTaxFor(qTurnover, category)
      paidTotal = roundMoney(paidTotal + qTax.total)
      quarters.push({ quarter: `Q${q + 1}`, turnover: qTax.turnover, tax: qTax.total })
    }

    const netPayable = roundMoney(outward.total + rcmTax - paidTotal)

    return NextResponse.json({
      fy,
      period: { from: fyStart.toISOString(), to: fyEnd.toISOString() },
      category,
      categoryLabel: COMPOSITION_RATES[category].label,
      dueDate: new Date(startYear + 1, 5, 30).toISOString(),   // 30 June following
      table6: { turnover: outward.turnover, rate: outward.rate, cgst: outward.cgst, sgst: outward.sgst, total: outward.total },
      table4RcmInward: { taxableValue: roundMoney(rcm._sum.subtotal || 0), tax: rcmTax },
      table5PaidViaCmp08: { quarters, total: paidTotal },
      netPayable,
      invoiceCount: sales._count._all,
      /*
       * Surfaced deliberately. A dealer who sees "already paid, nothing due"
       * may be tempted to leave Table 6 empty — which is precisely what creates
       * the negative liability. The screen has to say the opposite.
       */
      mustDeclareTable6: true,
    })
  } catch (err) {
    return apiError(err, 'Failed to compute GSTR-4', 500)
  }
}
