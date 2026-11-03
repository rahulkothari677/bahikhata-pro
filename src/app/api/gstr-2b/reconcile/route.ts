import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { apiError } from '@/lib/api-error'
import { imsWindow, IMS_ACTIONS } from '@/lib/ims-deadline'
import { loadTwoBMonth } from '@/lib/gstr2b-context'
import { isBillDoc, type MatchLine, type MatchPurchase, type Pair } from '@/lib/gstr2b-match'

/**
 * GET /api/gstr-2b/reconcile?month=2026-07
 *
 * A month's GSTR-2B against the books. 9a-2: the matching is lib/gstr2b-match.ts
 * (the one rule — see its header for the order a 2B bill finds its purchase), over
 * the purchases lib/gstr2b-context.ts loads — the same ones GSTR-3B claims from,
 * so a supplier's late-filed bill from an earlier month is matched, not "missing".
 *
 * Returns the shape the screen and CSV export have always read —
 *   summary, matched (incl. amount_mismatch and itc_not_available rows),
 *   booksOnly (waiting for suppliers), twoBOnly (not in your books)
 * — plus `groups`: every 2B document in exactly one group with its reason
 * (matched, amountDiffers, noCredit, sameBill, notInBooks, notMine, notes, waiting).
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse month param (YYYY-MM format from UI)
    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month')
    if (!monthParam) {
      return NextResponse.json({ error: 'month parameter is required (format: YYYY-MM, e.g. 2026-07)' }, { status: 400 })
    }

    const [year, month] = monthParam.split('-').map(Number)
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM (e.g. 2026-07).' }, { status: 400 })
    }

    // Convert to monthYear (MMYYYY) for DB lookup
    const monthYear = String(month).padStart(2, '0') + String(year)

    // === This month's 2B against the books — the one loader GSTR-3B uses too (9a-2) ===
    const twoB = await loadTwoBMonth(userId, monthYear)

    if (!twoB) {
      return NextResponse.json({
        monthYear,
        hasImport: false,
        message: 'No GSTR-2B has been imported for this month. Upload the 2B JSON from the GST portal to reconcile.',
        summary: null,
        matched: [],
        booksOnly: [],
        twoBOnly: [],
      })
    }

    const { sort } = twoB
    const tax = (x: { cgst: number; sgst: number; igst: number }) => roundMoney(x.cgst + x.sgst + x.igst)
    const lineOut = (l: MatchLine) => ({
      id: l.id, docType: l.docType, supplierGstin: l.supplierGstin, invoiceNumber: l.invoiceNumber,
      originalNumber: l.originalNumber, invoiceDate: l.invoiceDate, taxableValue: l.taxableValue,
      igst: l.igst, cgst: l.cgst, sgst: l.sgst, totalAmount: l.totalAmount,
      isReverseCharge: l.isReverseCharge, itcAvailable: l.itcAvailable, itcReason: l.itcReason,
      supplierName: twoB.suppliers.get(l.supplierGstin.trim().toUpperCase())?.name ?? null,
      supplierPartyId: twoB.suppliers.get(l.supplierGstin.trim().toUpperCase())?.id ?? null,
    })
    const purchaseOut = (p: MatchPurchase) => ({
      purchaseId: p.id, invoiceNumber: p.invoiceNo, purchaseDate: p.date, partyName: p.supplier || 'Unknown',
      partyGstin: p.gstin || '', partyPhone: p.phone ?? null, taxableValue: p.taxable ?? 0, igst: p.igst, cgst: p.cgst, sgst: p.sgst, totalAmount: p.totalAmount,
    })
    // The shape the screen and the CSV export have always read, one row per paired bill.
    const pairOut = (pr: Pair, status: string, difference = 0) => ({
      supplierGstin: pr.line.supplierGstin, invoiceNumber: pr.line.invoiceNumber, invoiceDate: pr.line.invoiceDate,
      twoBTaxable: pr.line.taxableValue, twoBIgst: pr.line.igst, twoBCgst: pr.line.cgst, twoBSgst: pr.line.sgst,
      twoBTotal: pr.line.totalAmount, isReverseCharge: pr.line.isReverseCharge,
      purchaseId: pr.purchase.id, purchaseDate: pr.purchase.date, purchaseTotal: pr.purchase.totalAmount,
      purchaseInvoiceNo: pr.purchase.invoiceNo, purchaseCgst: pr.purchase.cgst, purchaseSgst: pr.purchase.sgst,
      purchaseIgst: pr.purchase.igst, partyName: pr.purchase.supplier || 'Unknown', partyPhone: pr.purchase.phone ?? null,
      amountMatch: status !== 'amount_mismatch', amountDifference: difference,
      itcAvailable: pr.line.itcAvailable, itcReason: pr.line.itcReason, via: pr.via, status,
    })

    const matched = [
      ...sort.matched.map((p) => pairOut(p, 'matched')),
      ...sort.amountDiffers.map((p) => pairOut(p, 'amount_mismatch', p.difference)),
      // #353: 2B says no credit on this bill (itcavl N) — never counted as eligible.
      ...sort.noCredit.map((p) => pairOut(p, 'itc_not_available')),
    ]
    const twoBOnly = sort.notInBooks.map((l) => ({ ...lineOut(l), status: 'missing_in_books' }))
    const booksOnly = sort.waiting.map((p) => ({ ...purchaseOut(p), status: 'not_in_2b' }))

    // === Summary totals (eligible credit: matched and amount-differs pairs, never no-credit) ===
    const matchedItc = roundMoney([...sort.matched, ...sort.amountDiffers].reduce((s, p) => s + tax(p.line), 0))
    const deferredItc = roundMoney(sort.waiting.reduce((s, p) => s + tax(p), 0))
    const missingItc = roundMoney(sort.notInBooks.reduce((s, l) => s + tax(l), 0))

    /*
     * ── IMS: when this stops being a choice (#40) ─────────────────────────
     *
     * Under the substituted Section 38 an invoice nobody acts on is DEEMED
     * ACCEPTED when GSTR-2B generates on the 14th — accepted along with the tax
     * treatment the supplier gave it. So a "not in your books" row can mean
     * "somebody billed your GSTIN for something that is not yours, and you have
     * until the 14th to say so".
     */
    const own3b = await db.gstReturn.findUnique({
      where: { userId_monthYear: { userId, monthYear } },
      select: { filingStatus: true },
    })
    const ims = imsWindow(monthYear, own3b?.filingStatus === 'filed')

    return NextResponse.json({
      monthYear,
      hasImport: true,
      ims: {
        ...ims,
        generationDate: ims.generationDate.toISOString(),
        actions: IMS_ACTIONS,
      },
      importInfo: {
        importedAt: twoB.importRow.importedAt,
        invoiceCount: twoB.importRow.invoiceCount,
        taxableTotal: twoB.importRow.taxableTotal,
        igstTotal: twoB.importRow.igstTotal,
        cgstTotal: twoB.importRow.cgstTotal,
        sgstTotal: twoB.importRow.sgstTotal,
      },
      summary: {
        matched: matched.length,
        booksOnly: booksOnly.length,
        twoBOnly: twoBOnly.length,
        matchedItc,
        deferredItc,
        missingItc,
        totalPurchases: twoB.purchases.length,
        totalTwoBInvoices: twoB.lines.filter((l) => isBillDoc(l.docType)).length,
      },
      matched,
      booksOnly,
      twoBOnly,
      /*
       * 9a-2: every 2B document in exactly one group, with its reason — what the
       * supplier-bills screen (9a-3) draws. Counts and credit add up to the 2B.
       */
      groups: {
        matched: sort.matched.map((p) => pairOut(p, 'matched')),
        amountDiffers: sort.amountDiffers.map((p) => pairOut(p, 'amount_mismatch', p.difference)),
        noCredit: sort.noCredit.map((p) => pairOut(p, 'itc_not_available')),
        sameBill: sort.sameBill.map((s) => ({ line: lineOut(s.line), candidates: s.candidates.map(purchaseOut) })),
        notInBooks: sort.notInBooks.map(lineOut),
        notMine: sort.notMine.map(lineOut),
        notes: sort.notes.map(lineOut),
        // 9a-4: each supplier credit note recorded (with the shop's entry), offered, or still to record.
        notesRecorded: sort.notesRecorded.map((p) => ({ line: lineOut(p.line), entry: purchaseOut(p.purchase) })),
        notesOffered: sort.notesOffered.map((x) => ({ line: lineOut(x.line), candidates: x.candidates.map(purchaseOut) })),
        notesToRecord: sort.notesToRecord.map(lineOut),
        waiting: sort.waiting.map(purchaseOut),
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to reconcile GSTR-2B', 500)
  }
}
