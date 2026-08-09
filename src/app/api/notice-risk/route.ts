import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { assessNoticeRisk, assessRule88D } from '@/lib/notice-risk'

/**
 * "If I file this, will I get a notice?"
 *
 * WHY IT FETCHES THE REAL RETURNS rather than querying afresh: the answer is
 * only worth anything if it describes what will ACTUALLY be filed. A risk
 * panel built from its own queries would be a third opinion, and could report
 * "all clear" over returns that disagree — the one failure that makes this
 * worse than not having it. Same reasoning as /api/gst-reconciliation.
 *
 * THE 88D SUBTLETY. Our GSTR-3B already caps the input credit claim at what
 * the imported GSTR-2B contains (Rule 36(4)), so the claim we would file can
 * never exceed the 2B — Rule 88D cannot fire from a return this app produced.
 *
 * Reporting that as a bare "no risk" would be true and useless. What the
 * shopkeeper needs to know is the exposure they are being SPARED: the credit
 * sitting in their purchase bills that is not in the 2B, which is exactly what
 * they would have claimed in any app that does not do this. So the route
 * returns both — the filed position (clear) and the avoided position (what a
 * naive claim would have triggered).
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

    // The 2B is stored as MMYYYY, not YYYY-MM.
    const [year, mon] = month.split('-')
    const monthYear = `${mon}${year}`
    const imported = await db.gstr2bImport.findFirst({
      where: { userId, monthYear },
      select: { igstTotal: true, cgstTotal: true, sgstTotal: true, invoiceCount: true, importedAt: true },
      orderBy: { importedAt: 'desc' },
    })

    const gstr2bItc = imported
      ? (imported.igstTotal + imported.cgstTotal + imported.sgstTotal)
      : 0
    const claimedItc = g3.totalItc || 0

    const result = assessNoticeRisk({
      gstr1Tax: g1.summary?.totalOutputTax || 0,
      gstr3bTax: g3.totalOutputTax || 0,
      gstr3bItc: claimedItc,
      gstr2bItc,
      hasGstr2b: !!imported,
    })

    /*
     * What Rule 36(4) already saved them. The credit in their own purchase
     * bills that the 2B does not support — the figure they would have claimed
     * elsewhere, and the intimation that would have followed.
     *
     * Only meaningful once a 2B exists; without one there is nothing to
     * compare against and the "book" figure IS the claim.
     */
    const bookItc = (g3.bookItcCgst || 0) + (g3.bookItcSgst || 0) + (g3.bookItcIgst || 0)
    const avoided = imported && bookItc > gstr2bItc
      ? assessRule88D(bookItc, gstr2bItc)
      : null

    return NextResponse.json({
      month,
      ...result,
      inputs: {
        gstr1Tax: g1.summary?.totalOutputTax || 0,
        gstr3bTax: g3.totalOutputTax || 0,
        claimedItc,
        gstr2bItc,
        bookItc,
        itcBasis: g3.itcBasis || 'books-unverified',
        hasGstr2b: !!imported,
        gstr2bInvoiceCount: imported?.invoiceCount ?? 0,
        gstr2bImportedAt: imported?.importedAt ?? null,
      },
      // Present only when Rule 36(4) actually held something back.
      avoided: avoided ? { ...avoided, heldBack: bookItc - gstr2bItc } : null,
    })
  } catch (err) {
    return apiError(err, 'Failed to assess the notice risk', 500)
  }
}
