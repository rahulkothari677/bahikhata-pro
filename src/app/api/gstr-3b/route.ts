import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { istMonthStartOffset, getISTDateParts } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/gstr-3b?month=2026-07
 *
 * V17-Ext Tier 3: Computes a GSTR-3B monthly liability summary for a given
 * IST month. Covers ALL sections of the 3B form:
 *
 * 3.1(a) Outward taxable supplies (regular sales)
 * 3.1(b) Zero-rated supplies (exports) — ₹0 for kirana
 * 3.1(c) Nil-rated + exempt + non-GST outward
 * 3.1(d) RCM (reverse charge) outward liability
 * 3.2   Inter-state B2C supplies (unregistered parties)
 * 4(a)  ITC from regular purchases
 * 4(b)  ITC from RCM purchases
 * 4(c)  ITC from imports — ₹0 for kirana
 * 4(d)  ITC from SEZ — ₹0 for kirana
 * 5     Exempt inward supplies (0% GST purchases)
 * 6.1   Net tax payable = (output + RCM) - ITC
 * 6.2   Late fee / interest (manual entry)
 * 7     TDS/TCS adjustment — ₹0 default
 * 8     TDS/TCS by e-commerce — ₹0 default
 *
 * Also returns the existing GstReturn snapshot if one exists for this month
 * (so the UI can show "Filed" vs "Draft" status).
 *
 * All SQL queries aggregate STORED per-item CGST/SGST/IGST (V10 source of
 * truth) — never recomputes GST from taxable × rate. This guarantees the
 * 3B numbers match the GSTR-1 export and the reconciliation health check.
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

    // Parse the month parameter (format: "2026-07" = YYYY-MM)
    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month') // "2026-07"

    // Determine the IST month range
    let monthDate: Date
    if (monthParam) {
      const [year, month] = monthParam.split('-').map(Number)
      if (!year || !month || month < 1 || month > 12) {
        return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM (e.g. 2026-07).' }, { status: 400 })
      }
      // Create a date in that month, then use istMonthStartOffset to get the start
      monthDate = new Date(Date.UTC(year, month - 1, 15))
    } else {
      monthDate = new Date()
    }

    const periodStart = istMonthStartOffset(monthDate, 0)
    const periodEnd = istMonthStartOffset(monthDate, 1) // start of NEXT month = end of this month
    // periodEnd is exclusive (gte periodStart, lt periodEnd) — covers all of the month

    // monthYear string for the snapshot (MMYYYY format, matching GSTR-1 fp)
    const istParts = getISTDateParts(periodStart)
    const monthYear = String(istParts.month + 1).padStart(2, '0') + String(istParts.year)

    // Run all queries in parallel. Each query is a SQL aggregate — O(1) memory.
    const [
      // === Section 3.1(a): Outward taxable supplies (regular sales, non-RCM) ===
      outwardSalesAgg,
      // === Section 3.1(d): RCM outward (sales with isReverseCharge = true) ===
      rcmOutwardAgg,
      // V17-Ext Tier 3: Credit notes (reduce output tax — seller issued credit to customer)
      creditNoteAgg,
      // === Section 3.1(c): Nil-rated, exempt, non-GST outward ===
      // Nil-rated = sales with all items at 0% GST (GST-rate is 0 but supply IS taxable)
      // Non-GST = income transactions (not subject to GST at all)
      // Exempt = we don't currently have an "exempt" flag, so this is 0 for now
      nilRatedAgg,
      nonGstAgg,
      // === Section 3.2: Inter-state B2C supplies (unregistered, any amount) ===
      // Sales where isInterState = true AND party has no GSTIN
      interstateB2cAgg,
      // === Section 4(a): ITC from regular purchases ===
      itcPurchasesAgg,
      // === Section 4(b): ITC from RCM purchases ===
      rcmItcAgg,
      // V17-Ext Tier 3: Debit notes (reduce ITC — supplier issued debit to us)
      debitNoteAgg,
      // === Section 5: Exempt inward (0% GST purchases) ===
      exemptInwardAgg,
      // === Existing snapshot (if any) ===
      existingSnapshot,
    ] = await Promise.all([
      // 3.1(a): Regular sales (non-RCM)
      db.transaction.aggregate({
        where: {
          userId,
          type: 'sale',
          deletedAt: null,
          isReverseCharge: false,
          date: { gte: periodStart, lt: periodEnd },
        },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),

      // 3.1(d): RCM outward (sales with isReverseCharge = true)
      // This is rare — usually the supplier charges RCM, but some unregistered
      // outward supplies may be marked RCM by the user.
      db.transaction.aggregate({
        where: {
          userId,
          type: 'sale',
          deletedAt: null,
          isReverseCharge: true,
          date: { gte: periodStart, lt: periodEnd },
        },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),

      // V17-Ext Tier 3: Credit notes (reduce output tax)
      db.transaction.aggregate({
        where: {
          userId,
          type: 'credit-note',
          deletedAt: null,
          date: { gte: periodStart, lt: periodEnd },
        },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),

      // 3.1(c) part 1: Nil-rated sales (all items at 0% GST)
      // Use raw SQL to find sales where ALL items have gstRate = 0
      db.$queryRaw<Array<{ totalValue: string }>>`
        SELECT COALESCE(SUM(t."totalAmount"::numeric), 0)::text AS "totalValue"
        FROM "Transaction" t
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."isReverseCharge" = false
          AND t."date" >= ${periodStart}
          AND t."date" < ${periodEnd}
          AND NOT EXISTS (
            SELECT 1 FROM "TransactionItem" ti
            WHERE ti."transactionId" = t.id
              AND ti."gstRate" > 0
          )
      `,

      // 3.1(c) part 2: Non-GST outward (income transactions — not subject to GST)
      db.transaction.aggregate({
        where: {
          userId,
          type: 'income',
          deletedAt: null,
          date: { gte: periodStart, lt: periodEnd },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),

      // 3.2: Inter-state B2C (unregistered parties)
      // Sales where isInterState = true AND party has no GSTIN
      db.$queryRaw<Array<{ taxableValue: string; igst: string }>>`
        SELECT
          COALESCE(SUM(t."subtotal"::numeric - COALESCE(t."discountAmount", 0)::numeric), 0)::text AS "taxableValue",
          COALESCE(SUM(t."igst"::numeric), 0)::text AS "igst"
        FROM "Transaction" t
        LEFT JOIN "Party" p ON t."partyId" = p.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."isInterState" = true
          AND t."isReverseCharge" = false
          AND t."date" >= ${periodStart}
          AND t."date" < ${periodEnd}
          AND (p."gstin" IS NULL OR p."gstin" = '')
      `,

      // 4(a): ITC from regular purchases (non-RCM)
      db.transaction.aggregate({
        where: {
          userId,
          type: 'purchase',
          deletedAt: null,
          isReverseCharge: false,
          date: { gte: periodStart, lt: periodEnd },
        },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),

      // 4(b): ITC from RCM purchases (isReverseCharge = true)
      db.transaction.aggregate({
        where: {
          userId,
          type: 'purchase',
          deletedAt: null,
          isReverseCharge: true,
          date: { gte: periodStart, lt: periodEnd },
        },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),

      // V17-Ext Tier 3: Debit notes (reduce ITC)
      db.transaction.aggregate({
        where: {
          userId,
          type: 'debit-note',
          deletedAt: null,
          date: { gte: periodStart, lt: periodEnd },
        },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),

      // 5: Exempt inward (0% GST purchases)
      // Same pattern as nil-rated sales — purchases where ALL items have gstRate = 0
      db.$queryRaw<Array<{ totalValue: string }>>`
        SELECT COALESCE(SUM(t."totalAmount"::numeric), 0)::text AS "totalValue"
        FROM "Transaction" t
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'purchase'
          AND t."date" >= ${periodStart}
          AND t."date" < ${periodEnd}
          AND NOT EXISTS (
            SELECT 1 FROM "TransactionItem" ti
            WHERE ti."transactionId" = t.id
              AND ti."gstRate" > 0
          )
      `,

      // Existing snapshot
      db.gstReturn.findUnique({
        where: { userId_monthYear: { userId, monthYear } },
      }),
    ])

    // === Compute the structured 3B values ===

    // 3.1(a): Outward taxable supplies
    const outwardTaxableValue = roundMoney(
      (outwardSalesAgg._sum.subtotal || 0) - (outwardSalesAgg._sum.discountAmount || 0)
    )
    const outwardCgst = roundMoney(outwardSalesAgg._sum.cgst || 0)
    const outwardSgst = roundMoney(outwardSalesAgg._sum.sgst || 0)
    const outwardIgst = roundMoney(outwardSalesAgg._sum.igst || 0)

    // 3.1(b): Zero-rated supplies (exports) — ₹0 for kirana (no export tracking)
    const zeroRatedTaxableValue = 0
    const zeroRatedIgst = 0

    // 3.1(c): Nil-rated + exempt + non-GST
    const nilRatedValue = roundMoney(Number(nilRatedAgg[0]?.totalValue || 0))
    const exemptValue = 0 // No exempt flag currently
    const nonGstValue = roundMoney(nonGstAgg._sum.totalAmount || 0)

    // 3.1(d): RCM outward
    const rcmTaxableValue = roundMoney(
      (rcmOutwardAgg._sum.subtotal || 0) - (rcmOutwardAgg._sum.discountAmount || 0)
    )
    const rcmCgst = roundMoney(rcmOutwardAgg._sum.cgst || 0)
    const rcmSgst = roundMoney(rcmOutwardAgg._sum.sgst || 0)
    const rcmIgst = roundMoney(rcmOutwardAgg._sum.igst || 0)

    // V17-Ext Tier 3: Credit notes reduce output tax
    const creditNoteTaxableValue = roundMoney(
      (creditNoteAgg._sum.subtotal || 0) - (creditNoteAgg._sum.discountAmount || 0)
    )
    const creditNoteCgst = roundMoney(creditNoteAgg._sum.cgst || 0)
    const creditNoteSgst = roundMoney(creditNoteAgg._sum.sgst || 0)
    const creditNoteIgst = roundMoney(creditNoteAgg._sum.igst || 0)

    // 3.2: Inter-state B2C
    const interstateB2cTaxableValue = roundMoney(Number(interstateB2cAgg[0]?.taxableValue || 0))
    const interstateB2cIgst = roundMoney(Number(interstateB2cAgg[0]?.igst || 0))

    // 4(a): ITC regular
    const itcTaxableValue = roundMoney(
      (itcPurchasesAgg._sum.subtotal || 0) - (itcPurchasesAgg._sum.discountAmount || 0)
    )
    const itcCgst = roundMoney(itcPurchasesAgg._sum.cgst || 0)
    const itcSgst = roundMoney(itcPurchasesAgg._sum.sgst || 0)
    const itcIgst = roundMoney(itcPurchasesAgg._sum.igst || 0)

    // 4(b): ITC from RCM purchases
    const rcmItcTaxableValue = roundMoney(
      (rcmItcAgg._sum.subtotal || 0) - (rcmItcAgg._sum.discountAmount || 0)
    )
    const rcmItcCgst = roundMoney(rcmItcAgg._sum.cgst || 0)
    const rcmItcSgst = roundMoney(rcmItcAgg._sum.sgst || 0)
    const rcmItcIgst = roundMoney(rcmItcAgg._sum.igst || 0)

    // V17-Ext Tier 3: Debit notes reduce ITC
    const debitNoteTaxableValue = roundMoney(
      (debitNoteAgg._sum.subtotal || 0) - (debitNoteAgg._sum.discountAmount || 0)
    )
    const debitNoteCgst = roundMoney(debitNoteAgg._sum.cgst || 0)
    const debitNoteSgst = roundMoney(debitNoteAgg._sum.sgst || 0)
    const debitNoteIgst = roundMoney(debitNoteAgg._sum.igst || 0)

    // 4(c): ITC from imports — ₹0 (not applicable)
    // 4(d): ITC from SEZ — ₹0 (not applicable)

    // 5: Exempt inward
    const exemptInwardValue = roundMoney(Number(exemptInwardAgg[0]?.totalValue || 0))

    // 6.1: Net tax payable
    // = (output CGST + output SGST + output IGST)
    // + (RCM outward CGST + RCM outward SGST + RCM outward IGST)
    // - (credit note CGST + credit note SGST + credit note IGST)  // V17-Ext Tier 3
    // - (ITC CGST + ITC SGST + ITC IGST)
    // - (RCM ITC CGST + RCM ITC SGST + RCM ITC IGST)
    // + (debit note CGST + debit note SGST + debit note IGST)    // V17-Ext Tier 3
    const totalOutputTax = roundMoney(outwardCgst + outwardSgst + outwardIgst)
    const totalRcmOutward = roundMoney(rcmCgst + rcmSgst + rcmIgst)
    const totalCreditNoteTax = roundMoney(creditNoteCgst + creditNoteSgst + creditNoteIgst) // V17-Ext Tier 3
    const totalItc = roundMoney(itcCgst + itcSgst + itcIgst)
    const totalRcmItc = roundMoney(rcmItcCgst + rcmItcSgst + rcmItcIgst)
    const totalDebitNoteTax = roundMoney(debitNoteCgst + debitNoteSgst + debitNoteIgst) // V17-Ext Tier 3
    const netTaxPayable = roundMoney(
      totalOutputTax + totalRcmOutward - totalCreditNoteTax
      - totalItc - totalRcmItc + totalDebitNoteTax
    )

    return NextResponse.json({
      period: {
        monthYear,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        monthLabel: new Date(periodStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      },
      // Section 3.1
      outwardTaxableValue,
      outwardCgst,
      outwardSgst,
      outwardIgst,
      zeroRatedTaxableValue,
      zeroRatedIgst,
      nilRatedValue,
      exemptValue,
      nonGstValue,
      rcmTaxableValue,
      rcmCgst,
      rcmSgst,
      rcmIgst,
      // Section 3.2
      interstateB2cTaxableValue,
      interstateB2cIgst,
      // Section 4
      itcTaxableValue,
      itcCgst,
      itcSgst,
      itcIgst,
      rcmItcTaxableValue,
      rcmItcCgst,
      rcmItcSgst,
      rcmItcIgst,
      // Section 5
      exemptInwardValue,
      // Section 6
      netTaxPayable,
      totalOutputTax,
      totalRcmOutward,
      totalCreditNoteTax, // V17-Ext Tier 3
      totalItc,
      totalRcmItc,
      totalDebitNoteTax, // V17-Ext Tier 3
      // Counts
      totalSaleInvoices: outwardSalesAgg._count,
      totalPurchaseBills: itcPurchasesAgg._count,
      totalRcmPurchases: rcmItcAgg._count,
      totalCreditNotes: creditNoteAgg._count,
      totalDebitNotes: debitNoteAgg._count,
      // Existing snapshot
      snapshot: existingSnapshot ? {
        id: existingSnapshot.id,
        filingStatus: existingSnapshot.filingStatus,
        filedAt: existingSnapshot.filedAt,
        filedByUserId: existingSnapshot.filedByUserId,
      } : null,
    })
  } catch (err) {
    return apiError(err, 'Failed to compute GSTR-3B', 500)
  }
}

/**
 * POST /api/gstr-3b
 *
 * Saves a GSTR-3B snapshot for a given month. The server RE-COMPUTES all
 * values (never trusts client-sent financial data) and upserts them to
 * the GstReturn table.
 *
 * Request body: { month: "2026-07", action: "save" | "file" }
 *   - "save": creates/updates a draft snapshot
 *   - "file": marks the snapshot as "filed" (sets filedAt + filedByUserId)
 *
 * If a snapshot is already "filed", it CANNOT be overwritten (filed returns
 * are immutable — you'd need to file a revised return on the portal).
 *
 * Auth: requires 'reports' permission (same as viewing GST reports).
 */
export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { month: monthParam, action } = body

    if (!monthParam || typeof monthParam !== 'string') {
      return NextResponse.json({ error: 'month is required (format: YYYY-MM, e.g. 2026-07)' }, { status: 400 })
    }

    if (action !== 'save' && action !== 'file') {
      return NextResponse.json({ error: 'action must be "save" or "file"' }, { status: 400 })
    }

    // Parse the month (same validation as GET)
    const [year, month] = monthParam.split('-').map(Number)
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM (e.g. 2026-07).' }, { status: 400 })
    }

    const monthDate = new Date(Date.UTC(year, month - 1, 15))
    const periodStart = istMonthStartOffset(monthDate, 0)
    const periodEnd = istMonthStartOffset(monthDate, 1)
    const istParts = getISTDateParts(periodStart)
    const monthYear = String(istParts.month + 1).padStart(2, '0') + String(istParts.year)

    // Check if a snapshot already exists
    const existing = await db.gstReturn.findUnique({
      where: { userId_monthYear: { userId, monthYear } },
    })

    // If already filed, block the update (filed returns are immutable)
    if (existing?.filingStatus === 'filed') {
      return NextResponse.json({
        error: 'This month is already filed',
        message: 'Filed GSTR-3B returns cannot be modified. To correct an error, file a revised return on the GST portal.',
        monthYear,
      }, { status: 409 })
    }

    // === Re-compute all 3B values (same queries as GET — DRY) ===
    // This is critical: we NEVER trust client-sent financial data for a
    // snapshot. The server always recomputes from the source of truth.
    const [
      outwardSalesAgg, rcmOutwardAgg, creditNoteAgg, nilRatedAgg, nonGstAgg,
      interstateB2cAgg, itcPurchasesAgg, rcmItcAgg, debitNoteAgg, exemptInwardAgg,
    ] = await Promise.all([
      db.transaction.aggregate({
        where: { userId, type: 'sale', deletedAt: null, isReverseCharge: false, date: { gte: periodStart, lt: periodEnd } },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: { userId, type: 'sale', deletedAt: null, isReverseCharge: true, date: { gte: periodStart, lt: periodEnd } },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: { userId, type: 'credit-note', deletedAt: null, date: { gte: periodStart, lt: periodEnd } },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      db.$queryRaw<Array<{ totalValue: string }>>`
        SELECT COALESCE(SUM(t."totalAmount"::numeric), 0)::text AS "totalValue"
        FROM "Transaction" t
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL AND t."type" = 'sale' AND t."isReverseCharge" = false
          AND t."date" >= ${periodStart} AND t."date" < ${periodEnd}
          AND NOT EXISTS (SELECT 1 FROM "TransactionItem" ti WHERE ti."transactionId" = t.id AND ti."gstRate" > 0)
      `,
      db.transaction.aggregate({
        where: { userId, type: 'income', deletedAt: null, date: { gte: periodStart, lt: periodEnd } },
        _sum: { totalAmount: true }, _count: true,
      }),
      db.$queryRaw<Array<{ taxableValue: string; igst: string }>>`
        SELECT
          COALESCE(SUM(t."subtotal"::numeric - COALESCE(t."discountAmount", 0)::numeric), 0)::text AS "taxableValue",
          COALESCE(SUM(t."igst"::numeric), 0)::text AS "igst"
        FROM "Transaction" t
        LEFT JOIN "Party" p ON t."partyId" = p.id
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'sale'
          AND t."isInterState" = true AND t."isReverseCharge" = false
          AND t."date" >= ${periodStart} AND t."date" < ${periodEnd}
          AND (p."gstin" IS NULL OR p."gstin" = '')
      `,
      db.transaction.aggregate({
        where: { userId, type: 'purchase', deletedAt: null, isReverseCharge: false, date: { gte: periodStart, lt: periodEnd } },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: { userId, type: 'purchase', deletedAt: null, isReverseCharge: true, date: { gte: periodStart, lt: periodEnd } },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      db.transaction.aggregate({
        where: { userId, type: 'debit-note', deletedAt: null, date: { gte: periodStart, lt: periodEnd } },
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        _count: true,
      }),
      db.$queryRaw<Array<{ totalValue: string }>>`
        SELECT COALESCE(SUM(t."totalAmount"::numeric), 0)::text AS "totalValue"
        FROM "Transaction" t
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL AND t."type" = 'purchase'
          AND t."date" >= ${periodStart} AND t."date" < ${periodEnd}
          AND NOT EXISTS (SELECT 1 FROM "TransactionItem" ti WHERE ti."transactionId" = t.id AND ti."gstRate" > 0)
      `,
    ])

    // Compute all values (same as GET)
    const outwardTaxableValue = roundMoney((outwardSalesAgg._sum.subtotal || 0) - (outwardSalesAgg._sum.discountAmount || 0))
    const outwardCgst = roundMoney(outwardSalesAgg._sum.cgst || 0)
    const outwardSgst = roundMoney(outwardSalesAgg._sum.sgst || 0)
    const outwardIgst = roundMoney(outwardSalesAgg._sum.igst || 0)
    const nilRatedValue = roundMoney(Number(nilRatedAgg[0]?.totalValue || 0))
    const nonGstValue = roundMoney(nonGstAgg._sum.totalAmount || 0)
    const rcmTaxableValue = roundMoney((rcmOutwardAgg._sum.subtotal || 0) - (rcmOutwardAgg._sum.discountAmount || 0))
    const rcmCgst = roundMoney(rcmOutwardAgg._sum.cgst || 0)
    const rcmSgst = roundMoney(rcmOutwardAgg._sum.sgst || 0)
    const rcmIgst = roundMoney(rcmOutwardAgg._sum.igst || 0)
    // V17-Ext Tier 3: Credit/debit notes
    const creditNoteTaxableValue = roundMoney((creditNoteAgg._sum.subtotal || 0) - (creditNoteAgg._sum.discountAmount || 0))
    const creditNoteCgst = roundMoney(creditNoteAgg._sum.cgst || 0)
    const creditNoteSgst = roundMoney(creditNoteAgg._sum.sgst || 0)
    const creditNoteIgst = roundMoney(creditNoteAgg._sum.igst || 0)
    const interstateB2cTaxableValue = roundMoney(Number(interstateB2cAgg[0]?.taxableValue || 0))
    const interstateB2cIgst = roundMoney(Number(interstateB2cAgg[0]?.igst || 0))
    const itcTaxableValue = roundMoney((itcPurchasesAgg._sum.subtotal || 0) - (itcPurchasesAgg._sum.discountAmount || 0))
    const itcCgst = roundMoney(itcPurchasesAgg._sum.cgst || 0)
    const itcSgst = roundMoney(itcPurchasesAgg._sum.sgst || 0)
    const itcIgst = roundMoney(itcPurchasesAgg._sum.igst || 0)
    const rcmItcTaxableValue = roundMoney((rcmItcAgg._sum.subtotal || 0) - (rcmItcAgg._sum.discountAmount || 0))
    const rcmItcCgst = roundMoney(rcmItcAgg._sum.cgst || 0)
    const rcmItcSgst = roundMoney(rcmItcAgg._sum.sgst || 0)
    const rcmItcIgst = roundMoney(rcmItcAgg._sum.igst || 0)
    // V17-Ext Tier 3: Debit notes
    const debitNoteTaxableValue = roundMoney((debitNoteAgg._sum.subtotal || 0) - (debitNoteAgg._sum.discountAmount || 0))
    const debitNoteCgst = roundMoney(debitNoteAgg._sum.cgst || 0)
    const debitNoteSgst = roundMoney(debitNoteAgg._sum.sgst || 0)
    const debitNoteIgst = roundMoney(debitNoteAgg._sum.igst || 0)
    const exemptInwardValue = roundMoney(Number(exemptInwardAgg[0]?.totalValue || 0))
    const totalOutputTax = roundMoney(outwardCgst + outwardSgst + outwardIgst)
    const totalRcmOutward = roundMoney(rcmCgst + rcmSgst + rcmIgst)
    const totalCreditNoteTax = roundMoney(creditNoteCgst + creditNoteSgst + creditNoteIgst)
    const totalItc = roundMoney(itcCgst + itcSgst + itcIgst)
    const totalRcmItc = roundMoney(rcmItcCgst + rcmItcSgst + rcmItcIgst)
    const totalDebitNoteTax = roundMoney(debitNoteCgst + debitNoteSgst + debitNoteIgst)
    const netTaxPayable = roundMoney(
      totalOutputTax + totalRcmOutward - totalCreditNoteTax
      - totalItc - totalRcmItc + totalDebitNoteTax
    )

    // === Upsert the snapshot ===
    const filingStatus = action === 'file' ? 'filed' : 'draft'
    const filedAt = action === 'file' ? new Date() : null
    const filedByUserId = action === 'file' ? (authCtx.actingUserId || userId) : null

    const snapshot = await db.gstReturn.upsert({
      where: { userId_monthYear: { userId, monthYear } },
      update: {
        filingStatus,
        filedAt,
        filedByUserId,
        outwardTaxableValue, outwardCgst, outwardSgst, outwardIgst,
        rcmTaxableValue, rcmCgst, rcmSgst, rcmIgst,
        nilRatedValue, exemptValue: 0, nonGstValue,
        itcTaxableValue, itcCgst, itcSgst, itcIgst,
        exemptInwardValue,
        interstateB2cTaxableValue, interstateB2cIgst,
        netTaxPayable,
      },
      create: {
        userId,
        monthYear,
        periodStart,
        periodEnd,
        filingStatus,
        filedAt,
        filedByUserId,
        outwardTaxableValue, outwardCgst, outwardSgst, outwardIgst,
        rcmTaxableValue, rcmCgst, rcmSgst, rcmIgst,
        nilRatedValue, exemptValue: 0, nonGstValue,
        itcTaxableValue, itcCgst, itcSgst, itcIgst,
        exemptInwardValue,
        interstateB2cTaxableValue, interstateB2cIgst,
        netTaxPayable,
      },
    })

    // 🔒 Audit log — record the save/file action
    await logAudit({
      userId,
      action: action === 'file' ? 'gstr3b.filed' : 'gstr3b.saved',
      entityType: 'gstReturn',
      entityId: snapshot.id,
      req,
      metadata: {
        monthYear,
        filingStatus,
        netTaxPayable,
        outwardTaxableValue,
        itcTaxableValue,
      },
    })

    return NextResponse.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        monthYear: snapshot.monthYear,
        filingStatus: snapshot.filingStatus,
        filedAt: snapshot.filedAt,
        netTaxPayable: snapshot.netTaxPayable,
      },
      message: action === 'file'
        ? `GSTR-3B for ${monthParam} marked as Filed. Net tax payable: Rs. ${netTaxPayable.toFixed(2)}`
        : `GSTR-3B for ${monthParam} saved as Draft.`,
    })
  } catch (err) {
    return apiError(err, 'Failed to save GSTR-3B', 500)
  }
}
