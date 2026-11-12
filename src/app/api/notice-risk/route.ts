import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { assessNoticeRisk, assessRule88D, twoBCreditForRule88D, gstr1aFixFor88C } from '@/lib/notice-risk'
import { roundMoney } from '@/lib/money'
import { gstr1Declared } from '@/lib/gst-reconciliation'

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
      select: { id: true, invoiceCount: true, importedAt: true },
      orderBy: { importedAt: 'desc' },
    })

    // 9b-3 (#357): 2B's credit by document — the database adds, one row per kind.
    const twoBGroups = imported
      ? await db.gstr2bInvoice.groupBy({
        by: ['docType', 'itcAvailable', 'isReverseCharge'],
        where: { userId, gstr2bImportId: imported.id },
        _sum: { igst: true, cgst: true, sgst: true },
      })
      : []
    const twoB = twoBCreditForRule88D(twoBGroups.map((g) => ({
      docType: g.docType, itcAvailable: g.itcAvailable, isReverseCharge: g.isReverseCharge,
      tax: (g._sum.igst || 0) + (g._sum.cgst || 0) + (g._sum.sgst || 0),
    })))
    const gstr2bItc = twoB.net
    // 3B's net credit: the claim less what the shop's own return-to-supplier entries reverse.
    const claimedItc = roundMoney((g3.totalItc || 0) - (g3.totalDebitNoteTax || 0))

    // 9b-3: once GSTR-1 is filed, Rule 88C compares what was FILED, not the books today.
    const { tax: gstr1Tax, filed: gstr1Filed } = gstr1Declared(g1)

    const result = assessNoticeRisk({
      gstr1Tax,
      gstr3bTax: g3.totalOutputTax || 0,
      gstr3bItc: claimedItc,
      gstr2bItc,
      hasGstr2b: !!imported,
    })

    // #101: the gap's own bills, when GSTR-1A can still carry them.
    const rule88C = result.rules.find((r) => r.rule === '88C')!
    const gstr1aFix = gstr1aFixFor88C(rule88C, g1.gstr1a)
    if (gstr1aFix) {
      rule88C.action = `File GSTR-1A for ${gstr1aFix.bills.length === 1 ? 'this bill' : `these ${gstr1aFix.bills.length} bills`} before you file GSTR-3B.`
    }
    // #357: a supplier's credit note the books lack is the gap's cause — chasing a supplier would not close it.
    const rule88D = result.rules.find((r) => r.rule === '88D')
    const unrecordedNotes = g3.itcDetail?.unrecordedNotesCount || 0
    if (rule88D && rule88D.excess > 0 && unrecordedNotes > 0) {
      rule88D.action = `Record ${unrecordedNotes === 1 ? 'the supplier’s credit note' : `${unrecordedNotes} supplier credit notes`} in Supplier bills (GSTR-2B).`
    }

    /*
     * What Rule 36(4) already saved them. The credit in their own purchase
     * bills that the 2B does not support — the figure they would have claimed
     * elsewhere, and the intimation that would have followed.
     *
     * Only meaningful once a 2B exists; without one there is nothing to
     * compare against and the "book" figure IS the claim.
     */
    const bookItc = (g3.bookItcCgst || 0) + (g3.bookItcSgst || 0) + (g3.bookItcIgst || 0)
    // Held against 2B's bills, like with like — notes are not in bookItc.
    const avoided = imported && bookItc > twoB.bills
      ? assessRule88D(bookItc, twoB.bills)
      : null

    return NextResponse.json({
      month,
      ...result,
      gstr1aFix,
      inputs: {
        gstr1Tax,
        gstr1Filed,
        gstr2bBillItc: twoB.bills,
        gstr2bNoteItc: twoB.notes,
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
      avoided: avoided ? { ...avoided, heldBack: roundMoney(bookItc - twoB.bills) } : null,
    })
  } catch (err) {
    return apiError(err, 'Failed to assess the notice risk', 500)
  }
}
