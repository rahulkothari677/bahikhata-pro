import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { istMonthStartOffset } from '@/lib/timezone'
import { deriveStateCode } from '@/lib/gst'
import { apiError } from '@/lib/api-error'
import { reconcileReturns } from '@/lib/gst-reconciliation'
import { getAdvancesForPeriod } from '@/lib/advances-for-period'

/**
 * "Do my two returns agree?" — the question a CA asks first.
 *
 * WHY IT CALLS THE OTHER TWO ROUTES rather than recomputing: the whole point is
 * to check what will actually be FILED. A reconciliation built from its own
 * queries would be checking a third opinion, and could report agreement while
 * the returns themselves disagreed — the one failure that would make this
 * feature worse than not having it.
 *
 * So it asks /api/gstr-1 and /api/gstr-3b for their real output and compares
 * those. Slower than a direct query, and correct by construction.
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

    const month = new URL(req.url).searchParams.get('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 })
    }

    const origin = new URL(req.url).origin
    const cookie = req.headers.get('cookie') || ''
    const fetchReport = async (path: string) => {
      const r = await fetch(`${origin}${path}`, { headers: { cookie }, cache: 'no-store' })
      if (!r.ok) throw new Error(`${path} returned ${r.status}`)
      return r.json()
    }

    const [g1, g3] = await Promise.all([
      fetchReport(`/api/gstr-1?month=${month}`),
      fetchReport(`/api/gstr-3b?month=${month}`),
    ])

    // The advance figures come from the same helper both returns use, so the
    // reconciling line matches the tables exactly rather than approximating them.
    const [year, mon] = month.split('-').map(Number)
    const monthDate = new Date(Date.UTC(year, mon - 1, 15))
    const periodStart = istMonthStartOffset(monthDate, 0)
    const periodEnd = istMonthStartOffset(monthDate, 1)
    const setting = await db.setting.findUnique({ where: { userId }, select: { gstin: true, state: true } })
    const shopStateCode = deriveStateCode(null, null, setting?.gstin || null, setting?.state || null)
    const { totals } = await getAdvancesForPeriod(userId, periodStart, periodEnd, shopStateCode)

    const result = reconcileReturns({
      gstr1InvoiceTax: g1.summary?.totalOutputTax || 0,
      gstr1InvoiceTaxable: g1.summary?.totalTaxableValue || 0,
      gstr3bOutputTax: g3.totalOutputTax || 0,
      gstr3bTaxable:
        (g3.outwardTaxableValue || 0) + (g3.nilRatedValue || 0) + (g3.exemptValue || 0) + (g3.nonGstValue || 0),
      advanceTaxReceived: totals.received.cgst + totals.received.sgst + totals.received.igst,
      advanceTaxableReceived: totals.received.adAmt,
      advanceTaxReleased: totals.adjusted.cgst + totals.adjusted.sgst + totals.adjusted.igst,
      advanceTaxableReleased: totals.adjusted.adAmt,
      nilExemptNonGst: (g3.nilRatedValue || 0) + (g3.exemptValue || 0) + (g3.nonGstValue || 0),
    })

    return NextResponse.json({ month, ...result })
  } catch (err) {
    return apiError(err, 'Failed to reconcile the returns', 500)
  }
}
