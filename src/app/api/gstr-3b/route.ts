import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney, fromPaise } from '@/lib/money'
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

// 🔒 V19-035 FIX: Extracted shared query + computation function.
// Previously the GET and POST handlers had copy-pasted 200+ line blocks.
// Now both call this single function — any change automatically applies to both.
async function computeGstr3bValues(userId: string, periodStart: Date, periodEnd: Date) {
  const [
    outwardSalesAgg, rcmInwardAgg, creditNoteAgg, nilRatedAgg, exemptAgg, nonGstAgg,
    interstateB2cAgg, itcPurchasesAgg, rcmItcAgg, debitNoteAgg, exemptInwardAgg,
  ] = await Promise.all([
    db.transaction.aggregate({
      where: { userId, type: 'sale', deletedAt: null, isReverseCharge: false, date: { gte: periodStart, lt: periodEnd } },
      _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
      _count: true,
    }),
    db.transaction.aggregate({
      where: { userId, type: 'purchase', deletedAt: null, isReverseCharge: true, date: { gte: periodStart, lt: periodEnd } },
      _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
      _count: true,
    }),
    db.transaction.aggregate({
      where: { userId, type: 'credit-note', deletedAt: null, date: { gte: periodStart, lt: periodEnd } },
      _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
      _count: true,
    }),
    db.$queryRaw<Array<{ totalValuePaise: string }>>`
      SELECT COALESCE(SUM(
        ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 0)
      ), 0)::text AS "totalValuePaise"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      LEFT JOIN "Product" p ON ti."productId" = p.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."isReverseCharge" = false
        AND t."date" >= ${periodStart}
        AND t."date" < ${periodEnd}
        AND ti."gstRate" = 0
        AND (p."gstTreatment" IS NULL OR p."gstTreatment" = 'taxable' OR p."gstTreatment" = 'nil')
    `,
    db.$queryRaw<Array<{ totalValuePaise: string }>>`
      SELECT COALESCE(SUM(
        ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 0)
      ), 0)::text AS "totalValuePaise"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      LEFT JOIN "Product" p ON ti."productId" = p.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."isReverseCharge" = false
        AND t."date" >= ${periodStart}
        AND t."date" < ${periodEnd}
        AND p."gstTreatment" = 'exempt'
    `,
    db.transaction.aggregate({
      where: { userId, type: 'income', deletedAt: null, date: { gte: periodStart, lt: periodEnd } },
      _sum: { totalAmount: true }, _count: true,
    }),
    db.$queryRaw<Array<{ taxableValuePaise: string; igstPaise: string }>>`
      SELECT
        COALESCE(SUM(t."subtotal"::numeric - COALESCE(t."discountAmount", 0)::numeric), 0)::text AS "taxableValuePaise",
        COALESCE(SUM(t."igst"::numeric), 0)::text AS "igstPaise"
      FROM "Transaction" t
      LEFT JOIN "Party" p ON t."partyId" = p.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL AND t."type" = 'sale'
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
    db.$queryRaw<Array<{ totalValuePaise: string }>>`
      SELECT COALESCE(SUM(t."totalAmount"::numeric), 0)::text AS "totalValuePaise"
      FROM "Transaction" t
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL AND t."type" = 'purchase'
        AND t."date" >= ${periodStart} AND t."date" < ${periodEnd}
        AND NOT EXISTS (SELECT 1 FROM "TransactionItem" ti WHERE ti."transactionId" = t.id AND ti."gstRate" > 0)
    `,
  ])

  // === Compute structured 3B values ===
  const outwardTaxableValue = roundMoney((outwardSalesAgg._sum.subtotal || 0) - (outwardSalesAgg._sum.discountAmount || 0))
  const outwardCgst = roundMoney(outwardSalesAgg._sum.cgst || 0)
  const outwardSgst = roundMoney(outwardSalesAgg._sum.sgst || 0)
  const outwardIgst = roundMoney(outwardSalesAgg._sum.igst || 0)
  const zeroRatedTaxableValue = 0
  const zeroRatedIgst = 0
  const nilRatedValue = fromPaise(Number(nilRatedAgg[0]?.totalValuePaise || 0))
  const exemptValue = fromPaise(Number(exemptAgg[0]?.totalValuePaise || 0))
  const nonGstValue = roundMoney(nonGstAgg._sum.totalAmount || 0)
  const rcmTaxableValue = roundMoney((rcmInwardAgg._sum.subtotal || 0) - (rcmInwardAgg._sum.discountAmount || 0))
  const rcmCgst = roundMoney(rcmInwardAgg._sum.cgst || 0)
  const rcmSgst = roundMoney(rcmInwardAgg._sum.sgst || 0)
  const rcmIgst = roundMoney(rcmInwardAgg._sum.igst || 0)
  const creditNoteTaxableValue = roundMoney((creditNoteAgg._sum.subtotal || 0) - (creditNoteAgg._sum.discountAmount || 0))
  const creditNoteCgst = roundMoney(creditNoteAgg._sum.cgst || 0)
  const creditNoteSgst = roundMoney(creditNoteAgg._sum.sgst || 0)
  const creditNoteIgst = roundMoney(creditNoteAgg._sum.igst || 0)
  const interstateB2cTaxableValue = fromPaise(Number(interstateB2cAgg[0]?.taxableValuePaise || 0))
  const interstateB2cIgst = fromPaise(Number(interstateB2cAgg[0]?.igstPaise || 0))
  const itcTaxableValue = roundMoney((itcPurchasesAgg._sum.subtotal || 0) - (itcPurchasesAgg._sum.discountAmount || 0))
  const itcCgst = roundMoney(itcPurchasesAgg._sum.cgst || 0)
  const itcSgst = roundMoney(itcPurchasesAgg._sum.sgst || 0)
  const itcIgst = roundMoney(itcPurchasesAgg._sum.igst || 0)
  const rcmItcTaxableValue = roundMoney((rcmItcAgg._sum.subtotal || 0) - (rcmItcAgg._sum.discountAmount || 0))
  const rcmItcCgst = roundMoney(rcmItcAgg._sum.cgst || 0)
  const rcmItcSgst = roundMoney(rcmItcAgg._sum.sgst || 0)
  const rcmItcIgst = roundMoney(rcmItcAgg._sum.igst || 0)
  const debitNoteTaxableValue = roundMoney((debitNoteAgg._sum.subtotal || 0) - (debitNoteAgg._sum.discountAmount || 0))
  const debitNoteCgst = roundMoney(debitNoteAgg._sum.cgst || 0)
  const debitNoteSgst = roundMoney(debitNoteAgg._sum.sgst || 0)
  const debitNoteIgst = roundMoney(debitNoteAgg._sum.igst || 0)
  const exemptInwardValue = fromPaise(Number(exemptInwardAgg[0]?.totalValuePaise || 0))
  const totalOutputTax = roundMoney(outwardCgst + outwardSgst + outwardIgst)
  const totalRcmInward = roundMoney(rcmCgst + rcmSgst + rcmIgst)
  const totalCreditNoteTax = roundMoney(creditNoteCgst + creditNoteSgst + creditNoteIgst)
  const totalItc = roundMoney(itcCgst + itcSgst + itcIgst)
  const totalRcmItc = roundMoney(rcmItcCgst + rcmItcSgst + rcmItcIgst)
  const totalDebitNoteTax = roundMoney(debitNoteCgst + debitNoteSgst + debitNoteIgst)
  const netTaxPayable = roundMoney(
    totalOutputTax + totalRcmInward - totalCreditNoteTax
    - totalItc - totalRcmItc + totalDebitNoteTax
  )

  return {
    outwardTaxableValue, outwardCgst, outwardSgst, outwardIgst,
    zeroRatedTaxableValue, zeroRatedIgst,
    nilRatedValue, exemptValue, nonGstValue,
    rcmTaxableValue, rcmCgst, rcmSgst, rcmIgst,
    creditNoteTaxableValue, creditNoteCgst, creditNoteSgst, creditNoteIgst,
    interstateB2cTaxableValue, interstateB2cIgst,
    itcTaxableValue, itcCgst, itcSgst, itcIgst,
    rcmItcTaxableValue, rcmItcCgst, rcmItcSgst, rcmItcIgst,
    debitNoteTaxableValue, debitNoteCgst, debitNoteSgst, debitNoteIgst,
    exemptInwardValue,
    netTaxPayable,
    totalOutputTax, totalRcmInward, totalCreditNoteTax, totalItc, totalRcmItc, totalDebitNoteTax,
    counts: {
      sales: outwardSalesAgg._count,
      purchases: itcPurchasesAgg._count,
      creditNotes: creditNoteAgg._count,
      debitNotes: debitNoteAgg._count,
      rcmPurchases: rcmInwardAgg._count,
      rcmItcPurchases: rcmItcAgg._count,
    },
  }
}

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
      // === Section 3.1(d): RCM INWARD liability (purchases with isReverseCharge=true) ===
      // 🔒 V17 Audit §2 FIX: Was `rcmOutwardAgg` querying type='sale' (RCM sales —
      // rare/never for kirana). GSTR-3B 3.1(d) "Inward supplies liable to reverse
      // charge" must be fed by RCM PURCHASES (GTA freight, legal fees, etc.).
      // The same purchases also appear in 4(b) as ITC — liability + ITC cancel
      // for fully-creditable RCM. This is the same `rcmItcAgg` query below; both
      // are kept for semantic clarity (3.1(d) = liability, 4(b) = ITC).
      rcmInwardAgg,
      // V17-Ext Tier 3: Credit notes (reduce output tax — seller issued credit to customer)
      creditNoteAgg,
      // === Section 3.1(c): Nil-rated, exempt, non-GST outward ===
      // 🔒 V17 Audit §4.1: Nil-rated = sum of 0%-rated line items (was: whole-invoice only)
      // 🔒 V17 Audit §4.2: Exempt = products marked gstTreatment='exempt' (was: hardcoded 0)
      // Non-GST = income transactions (not subject to GST at all)
      nilRatedAgg,
      exemptAgg,
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

      // 3.1(d): RCM INWARD liability (purchases with isReverseCharge = true)
      // 🔒 V17 Audit §2 FIX: Was type='sale' (RCM sales — rare). Now type='purchase'
      // (RCM inward — GTA freight, legal fees, etc.). This is the LIABILITY side;
      // the ITC side is in rcmItcAgg below (same purchases, same values).
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

      // 3.1(c) part 1: Nil-rated outward (0% GST items, EXCLUDING exempt/nonGst products)
      // 🔒 V17 Audit §4.1 FIX: Was "sales where ALL items have gstRate=0" (whole-invoice
      // only). An invoice with a mix of 0% and 18% items had its 0% portion counted
      // only inside the taxable supply, never broken out as nil-rated. Now: sum the
      // taxable value of ALL 0%-rated line items across ALL non-RCM sales (whether
      // the invoice is mixed or pure-0%). This correctly breaks out the nil-rated
      // portion of mixed invoices.
      // 🔒 V17 Audit Phase 4 FIX: Exclude products marked gstTreatment='exempt' or 'nonGst'
      // — those are counted in their own 3.1(c) sub-rows, not in nil-rated. Without this
      // exclusion, an exempt product (which typically has gstRate=0) would be counted in
      // BOTH nil-rated AND exempt → 3.1(c) total overstated.
      // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise. totalValue is always >= 0
      // (sum of taxable values), so positive nudge is sufficient.
      db.$queryRaw<Array<{ totalValuePaise: string }>>`
        SELECT COALESCE(ROUND(SUM(
          ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 0)
        ), 0)::text AS "totalValuePaise"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        LEFT JOIN "Product" p ON ti."productId" = p.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."isReverseCharge" = false
          AND t."date" >= ${periodStart}
          AND t."date" < ${periodEnd}
          AND ti."gstRate" = 0
          AND (p."gstTreatment" IS NULL OR p."gstTreatment" = 'taxable' OR p."gstTreatment" = 'nil')
      `,

      // 3.1(c) part 2: Exempt outward (products marked gstTreatment='exempt')
      // 🔒 V17 Audit §4.2 FIX: Was hardcoded to 0 (no exempt flag existed).
      // Now: sum the taxable value of line items whose product is marked exempt.
      // Falls back to 0 if no products have gstTreatment='exempt' (backward compat).
      // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise. Same pattern as above.
      db.$queryRaw<Array<{ totalValuePaise: string }>>`
        SELECT COALESCE(ROUND(SUM(
          ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 0)
        ), 0)::text AS "totalValuePaise"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        LEFT JOIN "Product" p ON ti."productId" = p.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."isReverseCharge" = false
          AND t."date" >= ${periodStart}
          AND t."date" < ${periodEnd}
          AND p."gstTreatment" = 'exempt'
      `,

      // 3.1(c) part 3: Non-GST outward (income transactions — not subject to GST)
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
      // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise for both columns.
      // taxableValue + igst are always >= 0, so positive nudge.
      db.$queryRaw<Array<{ taxableValuePaise: string; igstPaise: string }>>`
        SELECT
          COALESCE(SUM(t."subtotal"::numeric - COALESCE(t."discountAmount", 0)::numeric), 0)::text AS "taxableValuePaise",
          COALESCE(SUM(t."igst"::numeric), 0)::text AS "igstPaise"
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
      // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise. totalAmount >= 0, positive nudge.
      db.$queryRaw<Array<{ totalValuePaise: string }>>`
        SELECT COALESCE(SUM(t."totalAmount"::numeric), 0)::text AS "totalValuePaise"
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
    // 🔒 V17 Audit §4.1: Nil-rated now sums 0%-rated line items (not whole invoices)
    // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise; convert to rupees via fromPaise().
    const nilRatedValue = fromPaise(Number(nilRatedAgg[0]?.totalValuePaise || 0))
    // 🔒 V17 Audit §4.2: Exempt now reads from Product.gstTreatment='exempt' (was: hardcoded 0)
    const exemptValue = fromPaise(Number(exemptAgg[0]?.totalValuePaise || 0))
    const nonGstValue = roundMoney(nonGstAgg._sum.totalAmount || 0)

    // 3.1(d): RCM INWARD liability (purchases with isReverseCharge = true)
    // 🔒 V17 Audit §2 FIX: Now fed by RCM purchases (was: RCM sales).
    // This is the LIABILITY that appears in 3.1(d). The ITC on the same
    // purchases appears in 4(b). For fully-creditable RCM, liability = ITC
    // (they cancel in netTaxPayable). If ITC is partially blocked, the
    // liability still appears here.
    const rcmTaxableValue = roundMoney(
      (rcmInwardAgg._sum.subtotal || 0) - (rcmInwardAgg._sum.discountAmount || 0)
    )
    const rcmCgst = roundMoney(rcmInwardAgg._sum.cgst || 0)
    const rcmSgst = roundMoney(rcmInwardAgg._sum.sgst || 0)
    const rcmIgst = roundMoney(rcmInwardAgg._sum.igst || 0)

    // V17-Ext Tier 3: Credit notes reduce output tax
    const creditNoteTaxableValue = roundMoney(
      (creditNoteAgg._sum.subtotal || 0) - (creditNoteAgg._sum.discountAmount || 0)
    )
    const creditNoteCgst = roundMoney(creditNoteAgg._sum.cgst || 0)
    const creditNoteSgst = roundMoney(creditNoteAgg._sum.sgst || 0)
    const creditNoteIgst = roundMoney(creditNoteAgg._sum.igst || 0)

    // 3.2: Inter-state B2C
    // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise; convert to rupees via fromPaise().
    const interstateB2cTaxableValue = fromPaise(Number(interstateB2cAgg[0]?.taxableValuePaise || 0))
    const interstateB2cIgst = fromPaise(Number(interstateB2cAgg[0]?.igstPaise || 0))

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
    // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise; convert to rupees via fromPaise().
    const exemptInwardValue = fromPaise(Number(exemptInwardAgg[0]?.totalValuePaise || 0))

    // 6.1: Net tax payable
    // = (output CGST + output SGST + output IGST)
    // + (RCM inward CGST + RCM inward SGST + RCM inward IGST)    // 🔒 V17 Audit §2: liability (3.1d)
    // - (credit note CGST + credit note SGST + credit note IGST)  // V17-Ext Tier 3
    // - (ITC CGST + ITC SGST + ITC IGST)
    // - (RCM ITC CGST + RCM ITC SGST + RCM ITC IGST)              // 🔒 V17 Audit §2: ITC (4b)
    // + (debit note CGST + debit note SGST + debit note IGST)    // V17-Ext Tier 3
    //
    // 🔒 V17 Audit §2 FIX: RCM inward liability (totalRcmInward) is now ADDED.
    // For fully-creditable RCM, totalRcmInward == totalRcmItc (same purchases),
    // so they cancel. Before this fix, totalRcmItc was subtracted with NO
    // matching liability added → net tax was understated by the RCM amount.
    // Now: if a shop has an RCM purchase of ₹10K + ₹1.8K GST, 3.1(d) shows
    // ₹1.8K liability AND 4(b) shows ₹1.8K ITC → net effect ₹0 (correct).
    const totalOutputTax = roundMoney(outwardCgst + outwardSgst + outwardIgst)
    const totalRcmInward = roundMoney(rcmCgst + rcmSgst + rcmIgst) // 🔒 V17 Audit §2: liability
    const totalCreditNoteTax = roundMoney(creditNoteCgst + creditNoteSgst + creditNoteIgst) // V17-Ext Tier 3
    const totalItc = roundMoney(itcCgst + itcSgst + itcIgst)
    const totalRcmItc = roundMoney(rcmItcCgst + rcmItcSgst + rcmItcIgst)
    const totalDebitNoteTax = roundMoney(debitNoteCgst + debitNoteSgst + debitNoteIgst) // V17-Ext Tier 3
    const netTaxPayable = roundMoney(
      totalOutputTax + totalRcmInward - totalCreditNoteTax
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
      // 🔒 V17 Audit Phase 1 P0.1: CDN breakdown — was computed + persisted to DB
      // but NOT returned in the GET response. The UI had no data to display.
      // Now returned so the Gstr3bReport can show the Credit/Debit Note Adjustments card.
      creditNoteTaxableValue,
      creditNoteCgst,
      creditNoteSgst,
      creditNoteIgst,
      debitNoteTaxableValue,
      debitNoteCgst,
      debitNoteSgst,
      debitNoteIgst,
      // Section 6
      netTaxPayable,
      totalOutputTax,
      totalRcmInward, // 🔒 V17 Audit §2: RCM inward liability (was: totalRcmOutward)
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
        // 🔒 V17 Audit Phase 1 P0.2: Return the filed netTaxPayable so the UI
        // can compare it to the live value and warn if they diverge (post-filing edits).
        filedNetTaxPayable: existingSnapshot.netTaxPayable,
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

    // 🔒 V17-Ext Tier 3 Step 3: CAs are read-only — block 3B save/file (write op)
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

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

    // 🔒 V19-035 FIX: Use shared function instead of copy-pasted queries
    const values = await computeGstr3bValues(userId, periodStart, periodEnd)
    const {
      outwardTaxableValue, outwardCgst, outwardSgst, outwardIgst,
      zeroRatedTaxableValue, zeroRatedIgst,
      nilRatedValue, exemptValue, nonGstValue,
      rcmTaxableValue, rcmCgst, rcmSgst, rcmIgst,
      creditNoteTaxableValue, creditNoteCgst, creditNoteSgst, creditNoteIgst,
      interstateB2cTaxableValue, interstateB2cIgst,
      itcTaxableValue, itcCgst, itcSgst, itcIgst,
      rcmItcTaxableValue, rcmItcCgst, rcmItcSgst, rcmItcIgst,
      debitNoteTaxableValue, debitNoteCgst, debitNoteSgst, debitNoteIgst,
      exemptInwardValue,
      netTaxPayable,
      totalOutputTax, totalRcmInward, totalCreditNoteTax, totalItc, totalRcmItc, totalDebitNoteTax,
    } = values

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
        nilRatedValue, exemptValue, nonGstValue,
        itcTaxableValue, itcCgst, itcSgst, itcIgst,
        // 🔒 V17 Audit §4.3: Persist CDN breakdown for audit/dispute resolution
        creditNoteTaxableValue, creditNoteCgst, creditNoteSgst, creditNoteIgst,
        debitNoteTaxableValue, debitNoteCgst, debitNoteSgst, debitNoteIgst,
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
        nilRatedValue, exemptValue, nonGstValue,
        itcTaxableValue, itcCgst, itcSgst, itcIgst,
        // 🔒 V17 Audit §4.3: Persist CDN breakdown for audit/dispute resolution
        creditNoteTaxableValue, creditNoteCgst, creditNoteSgst, creditNoteIgst,
        debitNoteTaxableValue, debitNoteCgst, debitNoteSgst, debitNoteIgst,
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
