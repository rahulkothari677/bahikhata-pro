import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { istMonthStartOffset } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/gstr-2b/reconcile?month=2026-07
 *
 * V17-Ext Tier 3 Step 3: Reconciles GSTR-2B invoices against purchase
 * transactions to determine ITC eligibility.
 *
 * Matching algorithm:
 *   For each 2B invoice, find a purchase Transaction where:
 *     1. type = 'purchase' AND deletedAt IS NULL
 *     2. party.gstin = 2B invoice's supplierGstin (case-insensitive)
 *     3. invoiceNo = 2B invoice's invoiceNumber (case-insensitive)
 *     4. |totalAmount - 2B total| <= 0.05 (₹0.05 tolerance for float drift)
 *
 * Three reconciliation outcomes:
 *   ✅ matched       — 2B invoice has a corresponding purchase (eligible ITC)
 *   ⚠️ booksOnly     — purchase in books but NOT in 2B (ITC not yet available)
 *   ❌ twoBOnly      — 2B invoice but NO purchase in books (missing purchase)
 *
 * Returns:
 *   {
 *     monthYear, hasImport,
 *     summary: { matched, booksOnly, twoBOnly, matchedItc, deferredItc, missingItc },
 *     matched: [{ ...2bInvoice, ...purchase }],
 *     booksOnly: [{ ...purchase }],
 *     twoBOnly: [{ ...2bInvoice }]
 *   }
 */
export const maxDuration = 60

// ₹0.05 tolerance for amount comparison (matches gstr-export reconciliation)
const AMOUNT_TOLERANCE = 0.05

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

    // === Check if a 2B import exists for this month ===
    const gstr2bImport = await db.gstr2bImport.findUnique({
      where: { userId_monthYear: { userId, monthYear } },
      include: {
        invoices: {
          orderBy: { supplierGstin: 'asc' },
        },
      },
    })

    if (!gstr2bImport) {
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

    // === Fetch all purchases for this month (with party GSTIN) ===
    const periodStart = istMonthStartOffset(new Date(Date.UTC(year, month - 1, 15)), 0)
    const periodEnd = istMonthStartOffset(new Date(Date.UTC(year, month - 1, 15)), 1)

    const purchases = await db.transaction.findMany({
      where: {
        userId,
        type: 'purchase',
        deletedAt: null,
        date: { gte: periodStart, lt: periodEnd },
      },
      include: {
        party: {
          select: { id: true, name: true, gstin: true },
        },
      },
    })

    // === Build lookup maps for fast matching ===
    // Key: "SUPPLIER_GSTIN|INVOICE_NO" (uppercased for case-insensitive match)
    const purchaseMap = new Map<string, any>()
    for (const p of purchases) {
      if (p.party?.gstin && p.invoiceNo) {
        const key = `${p.party.gstin.toUpperCase()}|${p.invoiceNo.toUpperCase()}`
        purchaseMap.set(key, p)
      }
    }

    // Track which purchases were matched (for booksOnly list)
    const matchedPurchaseIds = new Set<string>()

    // === Match each 2B invoice against purchases ===
    const matched: any[] = []
    const twoBOnly: any[] = []

    for (const inv of gstr2bImport.invoices) {
      const key = `${inv.supplierGstin.toUpperCase()}|${inv.invoiceNumber.toUpperCase()}`
      const purchase = purchaseMap.get(key)

      if (purchase) {
        // Found a matching purchase — check amount tolerance
        const amountDiff = Math.abs(roundMoney(purchase.totalAmount) - roundMoney(inv.totalAmount))
        const isAmountMatch = amountDiff <= AMOUNT_TOLERANCE

        matchedPurchaseIds.add(purchase.id)
        matched.push({
          // 2B invoice data
          supplierGstin: inv.supplierGstin,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          twoBTaxable: inv.taxableValue,
          twoBIgst: inv.igst,
          twoBCgst: inv.cgst,
          twoBSgst: inv.sgst,
          twoBTotal: inv.totalAmount,
          isReverseCharge: inv.isReverseCharge,
          // Purchase data (from books)
          purchaseId: purchase.id,
          purchaseDate: purchase.date,
          purchaseTotal: purchase.totalAmount,
          purchaseCgst: purchase.cgst,
          purchaseSgst: purchase.sgst,
          purchaseIgst: purchase.igst,
          partyName: purchase.party?.name || 'Unknown',
          // Match quality
          amountMatch: isAmountMatch,
          amountDifference: roundMoney(amountDiff),
          status: isAmountMatch ? 'matched' : 'amount_mismatch',
        })
      } else {
        // 2B invoice has no matching purchase in books
        twoBOnly.push({
          supplierGstin: inv.supplierGstin,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          taxableValue: inv.taxableValue,
          igst: inv.igst,
          cgst: inv.cgst,
          sgst: inv.sgst,
          totalAmount: inv.totalAmount,
          isReverseCharge: inv.isReverseCharge,
          status: 'missing_in_books',
        })
      }
    }

    // === Find purchases NOT in 2B (booksOnly) ===
    const booksOnly: any[] = []
    for (const p of purchases) {
      if (p.party?.gstin && p.invoiceNo && !matchedPurchaseIds.has(p.id)) {
        booksOnly.push({
          purchaseId: p.id,
          invoiceNumber: p.invoiceNo,
          purchaseDate: p.date,
          partyName: p.party?.name || 'Unknown',
          partyGstin: p.party?.gstin || '',
          taxableValue: roundMoney(p.subtotal - (p.discountAmount || 0)),
          igst: p.igst,
          cgst: p.cgst,
          sgst: p.sgst,
          totalAmount: p.totalAmount,
          status: 'not_in_2b',
        })
      }
    }

    // === Compute summary totals ===
    const matchedItc = roundMoney(
      matched.reduce((s, m) => s + m.twoBIgst + m.twoBCgst + m.twoBSgst, 0)
    )
    const deferredItc = roundMoney(
      booksOnly.reduce((s, b) => s + b.igst + b.cgst + b.sgst, 0)
    )
    const missingItc = roundMoney(
      twoBOnly.reduce((s, t) => s + t.igst + t.cgst + t.sgst, 0)
    )

    return NextResponse.json({
      monthYear,
      hasImport: true,
      importInfo: {
        importedAt: gstr2bImport.importedAt,
        invoiceCount: gstr2bImport.invoiceCount,
        taxableTotal: gstr2bImport.taxableTotal,
        igstTotal: gstr2bImport.igstTotal,
        cgstTotal: gstr2bImport.cgstTotal,
        sgstTotal: gstr2bImport.sgstTotal,
      },
      summary: {
        matched: matched.length,
        booksOnly: booksOnly.length,
        twoBOnly: twoBOnly.length,
        matchedItc,
        deferredItc,
        missingItc,
        totalPurchases: purchases.length,
        totalTwoBInvoices: gstr2bImport.invoices.length,
      },
      matched,
      booksOnly,
      twoBOnly,
    })
  } catch (err) {
    return apiError(err, 'Failed to reconcile GSTR-2B', 500)
  }
}
