import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney, fromPaise } from '@/lib/money'
import { classifySupplyLine } from '@/lib/supply-classification'
import { getAdvancesForPeriod } from '@/lib/advances-for-period'
import { stateCodeOf } from '@/lib/gst'
import { istMonthStartOffset, getISTDateParts } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'
import { captureGstFilingError } from '@/lib/sentry-gst'
import { logAudit } from '@/lib/audit'
import { LINE_TAXABLE_SQL } from '@/lib/line-taxable-sql'
import { setOffGst } from '@/lib/gst-setoff'
import { claimForPeriod, earliestClaimableBill } from '@/lib/itc-claim'
import { loadTwoBMonth, claimLines } from '@/lib/gstr2b-context'

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
/**
 * "MMYYYY" for a period start, matching the key Gstr2bImport is stored under.
 *
 * Computed in IST, because a period that begins at midnight IST is the previous
 * day in UTC — reading the month off the raw Date would look up the wrong 2B
 * for every period, and the failure would be a silently empty match rather than
 * an error.
 */
function monthYearOf(periodStart: Date): string {
  const ist = new Date(periodStart.getTime() + 5.5 * 60 * 60 * 1000)
  return String(ist.getUTCMonth() + 1).padStart(2, '0') + String(ist.getUTCFullYear())
}

async function computeGstr3bValues(userId: string, periodStart: Date, periodEnd: Date) {
  // 🔒 BUG-014 FIX (V22-15 Phase 9): Split 11 parallel queries into 2 batches.
  // Was: all 11 in one Promise.all → connection pool exhaustion on Neon
  // (connection_limit=1) → 500 error "Failed to compute GSTR-3B".
  // Now: Batch 1 (6 queries) wakes the DB, Batch 2 (5 queries) runs warm.
  // Same pattern as the Dashboard API's 2-batch strategy.

  // === Batch 1: Simple aggregates + nil-rated/exempt (wakes the DB if cold) ===
  const [
    outwardSalesAgg, rcmInwardAgg, creditNoteAgg, supplyClassRows, nonGstAgg,
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
      where: { userId, type: 'credit-note', deletedAt: null, outsideGst: false, date: { gte: periodStart, lt: periodEnd } },
      _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
      _count: true,
    }),
    /*
     * 3.1(c) inputs: the month's sale lines, grouped but NOT yet classified.
     *
     * WHY IT IS SHAPED THIS WAY (2026-08-08). There used to be two queries here,
     * one for nil-rated and one for exempt, each carrying its own copy of the
     * classification rule in SQL — and each joined LIVE to Product. GSTR-1 was
     * meanwhile applying a different rule, in TypeScript, to the snapshot on the
     * line. The two returns disagreed about the same shop's supplies: for August
     * 2026, GSTR-1 reported ₹2,959 nil + ₹100 exempt while this reported ₹0 nil
     * + ₹3,034 exempt, leaving ₹25 sitting in outward taxable supplies.
     *
     * So SQL no longer decides anything. It groups by the two fields the rule
     * looks at and returns the totals; `classifySupplyLine` — the same function
     * GSTR-1 calls — sorts the groups into boxes below. The rule cannot drift
     * between the two returns because there is only one of it.
     *
     * Reading ti."gstTreatment" rather than p."gstTreatment" is the other half:
     * a return must reflect what the product was when it was sold, not what the
     * product list says today.
     */
    db.$queryRaw<Array<{ treatment: string | null; gstRate: number; totalValuePaise: string }>>`
      SELECT ti."gstTreatment" AS "treatment",
             ti."gstRate" AS "gstRate",
             COALESCE(SUM(
               ${LINE_TAXABLE_SQL}
             ), 0)::text AS "totalValuePaise"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."isReverseCharge" = false
        AND t."date" >= ${periodStart}
        AND t."date" < ${periodEnd}
      GROUP BY ti."gstTreatment", ti."gstRate"
    `,
    // 🔒 AUDIT V23 FIX §13.9i: nonGstValue (GSTR-3B 3.1(e) "Non-GST outward
    // supplies") was previously computed from ALL income transactions. But
    // income categories like 'Commission', 'Interest', 'Rent Received',
    // 'Discount Received', 'Refund', 'Miscellaneous' are NON-SUPPLY income
    // (interest on bank deposits, rent of own property, etc.) — they are NOT
    // outward supplies of goods/services and do NOT belong in 3.1(e).
    // Including them inflated 3.1(e) for every kirana shop that records
    // interest or commission income.
    //
    // The only income category that could plausibly be a non-GST outward
    // supply (i.e., a supply of goods that is NOT liable to GST — alcohol,
    // petrol, lottery, etc.) is 'Scrap Sale' (casual sale of capital assets).
    // Filter to that category only. TODO: add a proper isNonGstSupply flag
    // on Transaction for users who genuinely sell non-GST goods.
    db.transaction.aggregate({
      where: {
        userId,
        type: 'income',
        deletedAt: null,
        date: { gte: periodStart, lt: periodEnd },
        category: 'Scrap Sale',
      },
      _sum: { totalAmount: true }, _count: true,
    }),
  ])

  // === Batch 2: Complex raw SQL queries (DB is now warm from Batch 1) ===
  const [
    interstateB2cAgg, itcPurchasesAgg, rcmItcAgg, debitNoteAgg, exemptInwardAgg,
  ] = await Promise.all([
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
      where: {
        userId, type: 'purchase', deletedAt: null, isReverseCharge: false,
        date: { gte: periodStart, lt: periodEnd },
        // Section 17(5): credit on these is blocked outright, so they never
        // enter the claim — before Rule 36(4) matching is even considered.
        itcBlockedReason: null,
      },
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
    /*
     * #132 (8e): Table 5 is every 0% LINE bought, not only bills that are 0%
     * throughout. Toor dal at 0% on a bill that also carries 5% atta was
     * counted nowhere in Table 5 and sat inside Table 4's value instead.
     * The same line rule 3.1(c) uses for sales (LINE_TAXABLE_SQL).
     */
    db.$queryRaw<Array<{ totalValuePaise: string }>>`
      SELECT COALESCE(SUM(${LINE_TAXABLE_SQL}), 0)::text AS "totalValuePaise"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL AND t."type" = 'purchase'
        AND t."date" >= ${periodStart} AND t."date" < ${periodEnd}
        AND ti."gstRate" = 0
    `,
  ])

  /*
   * Advances, from the same helper GSTR-1 uses for Tables 11A/11B.
   *
   * 3B does not show advances on their own line — they are folded into 3.1(a).
   * Fetching them here rather than recomputing keeps the two returns saying the
   * same thing about the same money.
   */
  const shopSetting = await db.setting.findUnique({
    where: { userId },
    select: { gstin: true, state: true },
  })
  const shopStateCode = stateCodeOf(shopSetting)
  const { totals: advanceTotals } = await getAdvancesForPeriod(userId, periodStart, periodEnd, shopStateCode)

  // === Compute structured 3B values ===

  // 3.1(c): Nil-rated + exempt + non-GST (computed FIRST so 3.1(a) can subtract them)
  // 🔒 V17 Audit §4.1: Nil-rated now sums 0%-rated line items (not whole invoices)
  // 🔒 V17 PAISE MIGRATION Phase 2G: SQL returns paise; convert to rupees via fromPaise().
  /*
   * Sort the grouped sale lines into 3.1(c)'s three boxes using the SAME
   * classifier GSTR-1 uses for its Table 8, so the two returns cannot disagree.
   */
  const classTotalsPaise = { taxable: 0, nil: 0, exempt: 0, nonGst: 0 }
  for (const row of supplyClassRows) {
    const cls = classifySupplyLine({ gstTreatment: row.treatment, gstRate: Number(row.gstRate) || 0 })
    classTotalsPaise[cls] += Number(row.totalValuePaise || 0)
  }
  const nilRatedValue = fromPaise(classTotalsPaise.nil)
  const exemptValue = fromPaise(classTotalsPaise.exempt)
  /*
   * Non-GST comes from two places and they are different things: lines on a
   * sale explicitly marked nonGst, plus the Scrap Sale income category (see the
   * note on that query). Both are 3.1(e).
   */
  const nonGstValue = roundMoney(fromPaise(classTotalsPaise.nonGst) + (nonGstAgg._sum.totalAmount || 0))

  // 3.1(a): Outward taxable supplies (other than zero rated, nil rated and exempted)
  // 🔒 AUDIT V23 FIX §13.2: Was SUM(subtotal - discount) over ALL sales → included
  // 0%-GST and exempt items → double-counted with 3.1(c). Now: subtract nilRatedValue
  // and exemptValue from the header total so 3.1(a) only covers taxable supplies.
  const rawOutwardTaxable = roundMoney((outwardSalesAgg._sum.subtotal || 0) - (outwardSalesAgg._sum.discountAmount || 0))
  /*
   * Advances move 3.1(a) in both directions.
   *
   * The value in 3.1(a) is: invoices + debit notes − credit notes + advances
   * received on which no invoice was issued this period − advances adjusted
   * against invoices issued this period. Advances are NOT shown separately in
   * 3B; they are folded into this one line.
   *
   * These are the same two quantities GSTR-1 declares in Tables 11A and 11B, and
   * they are computed from the same `advanceTax` function, so the returns move
   * together. Computing them separately here is how GSTR-1 and 3B drifted apart
   * over nil/exempt supplies, and that is not being repeated.
   */
  const advanceAdded = advanceTotals.received      // 11A — liability arising
  const advanceReleased = advanceTotals.adjusted   // 11B — liability released
  const outwardTaxableValue = roundMoney(
    rawOutwardTaxable - nilRatedValue - exemptValue + advanceAdded.adAmt - advanceReleased.adAmt,
  )
  const outwardCgst = roundMoney((outwardSalesAgg._sum.cgst || 0) + advanceAdded.cgst - advanceReleased.cgst)
  const outwardSgst = roundMoney((outwardSalesAgg._sum.sgst || 0) + advanceAdded.sgst - advanceReleased.sgst)
  const outwardIgst = roundMoney((outwardSalesAgg._sum.igst || 0) + advanceAdded.igst - advanceReleased.igst)
  const zeroRatedTaxableValue = 0
  const zeroRatedIgst = 0
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
  /*
   * ITC — and whether the shop is actually ENTITLED to it.
   *
   * WHY THIS IS NOT JUST A SUM (2026-08-08). Rule 36(4), as it has stood since
   * 1 January 2022, allows input tax credit ONLY on invoices that appear in the
   * shop's GSTR-2B. A supplier who has not filed means no credit that month,
   * however genuine the purchase and however carefully it was recorded.
   *
   * This claimed every purchase in the books. So the app told a shopkeeper they
   * could claim credit the law does not allow, they paid LESS tax than owed, and
   * under-payment is the expensive direction: interest under Section 50 runs
   * from the due date, plus penalty, and it compounds quietly until a notice
   * arrives.
   *
   * The app already knew the right answer. api/gstr-2b/reconcile computes
   * matched (claimable) against booksOnly (in the books, absent from 2B, so
   * deferred) — and GSTR-3B never consulted it. Two halves, each complete,
   * never connected. That is the fourth time this exact shape has appeared in
   * this codebase.
   *
   * The figures below therefore depend on whether a 2B has been imported:
   *
   *   imported     — claim only what is matched in 2B, and report the deferred
   *                  amount separately so nothing simply vanishes
   *   not imported — the app CANNOT know eligibility, so it reports the books
   *                  figure and marks it unverified rather than presenting a
   *                  guess as a filing figure
   */
  /*
   * What Section 17(5) removed, reported rather than silently dropped.
   *
   * A shopkeeper whose credit falls needs to see WHY, or the app looks like it
   * lost their money. It is also the figure a CA checks at assessment: not
   * "was any credit blocked" but "was the right credit blocked, and for what".
   */
  const blockedAgg = await db.transaction.aggregate({
    where: {
      userId, type: 'purchase', deletedAt: null, isReverseCharge: false,
      date: { gte: periodStart, lt: periodEnd },
      itcBlockedReason: { not: null },
    },
    _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
    _count: true,
  })
  const blockedItcTaxableValue = roundMoney((blockedAgg._sum.subtotal || 0) - (blockedAgg._sum.discountAmount || 0))
  const blockedItcCgst = roundMoney(blockedAgg._sum.cgst || 0)
  const blockedItcSgst = roundMoney(blockedAgg._sum.sgst || 0)
  const blockedItcIgst = roundMoney(blockedAgg._sum.igst || 0)
  const blockedItcCount = blockedAgg._count

  // 9a-2: the month's 2B against the books, loaded the one way the supplier-bills screen loads it.
  const gstr2b = await loadTwoBMonth(userId, monthYearOf(periodStart))

  /*
   * #132 (8e): Table 4's value is the TAXED lines only. A 0% line carries no
   * credit; it belongs in Table 5 (above), and counting it here too reported
   * the same purchase twice. Per purchase, so the 2B claim below uses it too.
   */
  // Bounded by s.16(4): no older bill can still be claimed, so none is needed.
  const taxedEarliest = earliestClaimableBill(monthYearOf(periodStart))
  const taxedFrom = istMonthStartOffset(new Date(Date.UTC(taxedEarliest.year, taxedEarliest.month - 1, 15)), 0)
  const taxedRows = await db.$queryRaw<Array<{ id: string; taxedPaise: string }>>`
    SELECT ti."transactionId" AS id, COALESCE(SUM(${LINE_TAXABLE_SQL}), 0)::text AS "taxedPaise"
    FROM "TransactionItem" ti
    JOIN "Transaction" t ON ti."transactionId" = t.id
    WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'purchase'
      AND t."date" >= ${taxedFrom} AND t."date" < ${periodEnd} AND ti."gstRate" > 0
    GROUP BY ti."transactionId"
  `
  const taxedById = new Map(taxedRows.map((r) => [r.id, fromPaise(Number(r.taxedPaise))]))
  const itcPeriodIds = await db.transaction.findMany({
    where: { userId, type: 'purchase', deletedAt: null, isReverseCharge: false, itcBlockedReason: null, date: { gte: periodStart, lt: periodEnd } },
    select: { id: true },
  })
  const bookItcTaxable = roundMoney(itcPeriodIds.reduce((s, p) => s + (taxedById.get(p.id) || 0), 0))
  const bookItcCgst = roundMoney(itcPurchasesAgg._sum.cgst || 0)
  const bookItcSgst = roundMoney(itcPurchasesAgg._sum.sgst || 0)
  const bookItcIgst = roundMoney(itcPurchasesAgg._sum.igst || 0)

  let itcTaxableValue = bookItcTaxable
  let itcCgst = bookItcCgst
  let itcSgst = bookItcSgst
  let itcIgst = bookItcIgst
  let itcBasis: 'gstr2b' | 'books-unverified' = 'books-unverified'
  let deferredItcTaxableValue = 0
  let deferredItcCgst = 0
  let deferredItcSgst = 0
  let deferredItcIgst = 0

  /*
   * Phase 8d (#116, #117): the claim comes from lib/itc-claim.ts — the lower of
   * book and 2B per head, and every purchase not yet claimed (inside s.16(4)),
   * not only those dated this month. claimedIds is what "Mark as filed" stamps.
   */
  let itcClaim: ReturnType<typeof claimForPeriod> | null = null
  if (gstr2b) {
    const fp = monthYearOf(periodStart)
    // The candidates (s.16(4) window, not blocked, not claimed elsewhere) come from lib/gstr2b-context.ts.
    const purchases = gstr2b.purchases
    itcClaim = claimForPeriod(
      fp,
      purchases.map((p) => ({
        id: p.id,
        billFp: monthYearOf(p.date),
        gstin: p.party?.gstin || null,
        invoiceNo: p.invoiceNo,
        taxable: roundMoney(taxedById.get(p.id) || 0), // #132: taxed lines only
        cgst: p.cgst || 0, sgst: p.sgst || 0, igst: p.igst || 0,
        itcClaimedIn: p.itcClaimedIn,
        supplier: p.party?.name || null,
      })),
      // #353 / 9a-1: a bill 2B marks "ITC not available" (itcavl N) is never claimed — claimForPeriod
      // puts it in its own bucket, not "waiting for the supplier". 9a-2: bills only, each carrying the
      // number of the purchase the screen paired it with (corrected bill, or the shop's "same bill").
      claimLines(gstr2b),
      // 9a-2: a bill an earlier 2B marked "no credit" stays there, not "waiting".
      gstr2b.noCreditKeys,
    )
    const t = itcClaim.totals.claim
    itcTaxableValue = t.taxable; itcCgst = t.cgst; itcSgst = t.sgst; itcIgst = t.igst
    const d = itcClaim.deferred
    deferredItcTaxableValue = roundMoney(d.reduce((s, x) => s + x.taxable, 0))
    deferredItcCgst = roundMoney(d.reduce((s, x) => s + x.cgst, 0))
    deferredItcSgst = roundMoney(d.reduce((s, x) => s + x.sgst, 0))
    deferredItcIgst = roundMoney(d.reduce((s, x) => s + x.igst, 0))
    itcBasis = 'gstr2b'
  }
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
  /*
   * #133 (8e): what is actually paid. netTaxPayable above is plain arithmetic
   * and goes negative; the return never does. Head by head, credit in the
   * order s.49(5)/Rule 88A fix, reverse charge in cash (lib/gst-setoff.ts).
   * netTaxPayable stays for the filed-snapshot comparison it already feeds.
   */
  const setOff = setOffGst(
    { igst: outwardIgst - creditNoteIgst, cgst: outwardCgst - creditNoteCgst, sgst: outwardSgst - creditNoteSgst },
    { igst: itcIgst + rcmItcIgst - debitNoteIgst, cgst: itcCgst + rcmItcCgst - debitNoteCgst, sgst: itcSgst + rcmItcSgst - debitNoteSgst },
    { igst: rcmIgst, cgst: rcmCgst, sgst: rcmSgst },
  )

  return {
    outwardTaxableValue, outwardCgst, outwardSgst, outwardIgst,
    zeroRatedTaxableValue, zeroRatedIgst,
    nilRatedValue, exemptValue, nonGstValue,
    rcmTaxableValue, rcmCgst, rcmSgst, rcmIgst,
    creditNoteTaxableValue, creditNoteCgst, creditNoteSgst, creditNoteIgst,
    interstateB2cTaxableValue, interstateB2cIgst,
    itcTaxableValue, itcCgst, itcSgst, itcIgst,
    // How the ITC figure was arrived at, and what is being held back. A caller
    // that shows the claim without showing the basis is repeating the fault.
    itcBasis,
    deferredItcTaxableValue, deferredItcCgst, deferredItcSgst, deferredItcIgst,
    // #116/#117 (8d): what the claim held back and why — and which bills it claimed (stamped on filing).
    itcDetail: itcClaim ? {
      shortBy: itcClaim.totals.shortBy,
      shortCount: itcClaim.claimed.filter((c) => c.shortBy > 0).length,
      lateCount: itcClaim.totals.lateCount,
      lateTax: roundMoney(itcClaim.claimed.filter((c) => c.late).reduce((s, c) => s + c.claim.cgst + c.claim.sgst + c.claim.igst, 0)),
      deferredCount: itcClaim.deferred.length,
      deferredTax: itcClaim.totals.deferredTax,
      stillWaitingCount: itcClaim.stillWaiting.length,
      stillWaitingTax: itcClaim.totals.stillWaitingTax,
      lapsedCount: itcClaim.lapsed.length,
      lapsedTax: itcClaim.totals.lapsedTax,
      // 9a-1: in 2B, but 2B says no credit on it.
      notAvailableCount: itcClaim.notAvailable.length,
      notAvailableTax: itcClaim.totals.notAvailableTax,
      // #112: bills to chase, by name, before s.16(4) shuts the window.
      endingSoonTax: itcClaim.totals.endingSoonTax,
      endingSoon: itcClaim.endingSoon.map((p) => ({
        id: p.id, invoiceNo: p.invoiceNo, supplier: p.supplier ?? null, gstin: p.gstin,
        billFp: p.billFp, tax: roundMoney(p.cgst + p.sgst + p.igst), final: p.final,
      })),
    } : null,
    claimedPurchaseIds: itcClaim ? itcClaim.claimed.map((c) => c.id) : [],
    blockedItcTaxableValue, blockedItcCgst, blockedItcSgst, blockedItcIgst, blockedItcCount,
    bookItcTaxableValue: bookItcTaxable, bookItcCgst, bookItcSgst, bookItcIgst,
    rcmItcTaxableValue, rcmItcCgst, rcmItcSgst, rcmItcIgst,
    debitNoteTaxableValue, debitNoteCgst, debitNoteSgst, debitNoteIgst,
    exemptInwardValue,
    netTaxPayable,
    cashPayable: setOff.cash,
    creditCarryForward: setOff.carryForward,
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

    // 🔒 AUDIT V22 FIX §1 (DRY): The GET handler previously duplicated ALL
    // queries and computation from computeGstr3bValues() — and introduced a
    // parenthesis bug (unclosed COALESCE) in two of the duplicated raw SQL
    // queries, causing a 500 error on every GSTR-3B load.
    //
    // Now: call the shared helper (same as POST does), then fetch the snapshot.
    // One correct query path, both GET and POST, no divergence.
    const [values, existingSnapshot] = await Promise.all([
      computeGstr3bValues(userId, periodStart, periodEnd),
      db.gstReturn.findUnique({
        where: { userId_monthYear: { userId, monthYear } },
      }),
    ])

    const {
      outwardTaxableValue, outwardCgst, outwardSgst, outwardIgst,
      zeroRatedTaxableValue, zeroRatedIgst,
      nilRatedValue, exemptValue, nonGstValue,
      rcmTaxableValue, rcmCgst, rcmSgst, rcmIgst,
      creditNoteTaxableValue, creditNoteCgst, creditNoteSgst, creditNoteIgst,
      interstateB2cTaxableValue, interstateB2cIgst,
      itcTaxableValue, itcCgst, itcSgst, itcIgst,
      /*
       * These must be destructured AND returned, or they are computed and
       * silently dropped. This GET names every field explicitly, so a value
       * added to computeGstr3bValues does not reach the client on its own —
       * which is exactly how the ITC warnings shipped invisible on the first
       * attempt, and the same shape as TransactionItem.hsn and the public
       * bill page before it.
       */
      itcBasis,
      deferredItcTaxableValue, deferredItcCgst, deferredItcSgst, deferredItcIgst,
      itcDetail,
      blockedItcTaxableValue, blockedItcCgst, blockedItcSgst, blockedItcIgst, blockedItcCount,
      bookItcTaxableValue, bookItcCgst, bookItcSgst, bookItcIgst,
      rcmItcTaxableValue, rcmItcCgst, rcmItcSgst, rcmItcIgst,
      debitNoteTaxableValue, debitNoteCgst, debitNoteSgst, debitNoteIgst,
      exemptInwardValue,
      netTaxPayable, cashPayable, creditCarryForward,
      totalOutputTax, totalRcmInward, totalCreditNoteTax, totalItc, totalRcmItc, totalDebitNoteTax,
      counts,
    } = values

    return NextResponse.json({
      period: {
        monthYear,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        monthLabel: new Date(periodStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
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
      // How that claim was arrived at, and what is being held back or blocked.
      // A claim shown without its basis invites a shopkeeper to file it.
      itcBasis,
      deferredItcTaxableValue,
      deferredItcCgst,
      deferredItcSgst,
      deferredItcIgst,
      itcDetail,
      blockedItcTaxableValue,
      blockedItcCgst,
      blockedItcSgst,
      blockedItcIgst,
      blockedItcCount,
      bookItcTaxableValue,
      bookItcCgst,
      bookItcSgst,
      bookItcIgst,
      rcmItcTaxableValue,
      rcmItcCgst,
      rcmItcSgst,
      rcmItcIgst,
      // Section 5
      exemptInwardValue,
      // 🔒 V17 Audit Phase 1 P0.1: CDN breakdown
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
      // #133: what is paid in cash and what credit carries forward — never negative.
      cashPayable,
      creditCarryForward,
      totalOutputTax,
      totalRcmInward,
      totalCreditNoteTax,
      totalItc,
      totalRcmItc,
      totalDebitNoteTax,
      // Counts
      totalSaleInvoices: counts.sales,
      totalPurchaseBills: counts.purchases,
      totalRcmPurchases: counts.rcmItcPurchases,
      totalCreditNotes: counts.creditNotes,
      totalDebitNotes: counts.debitNotes,
      // Existing snapshot
      snapshot: existingSnapshot ? {
        id: existingSnapshot.id,
        filingStatus: existingSnapshot.filingStatus,
        filedAt: existingSnapshot.filedAt,
        filedByUserId: existingSnapshot.filedByUserId,
        filedNetTaxPayable: existingSnapshot.netTaxPayable,
      } : null,
    })
  } catch (err) {
    // 🔒 V20-017: GST filing error — capture with GST-specific tags for Sentry alerting.
    captureGstFilingError(err, {
      route: '/api/gstr-3b',
      action: 'compute',
    })
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
      claimedPurchaseIds,
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

    /*
     * #117: filing this 3B claims these purchases' credit, so it is stamped on
     * them — a later period then never claims them again, and a bill whose
     * supplier filed late stays claimable until the month it appears in 2B.
     * Only on "file", and only bills not already stamped by another period.
     */
    if (action === 'file' && claimedPurchaseIds.length) {
      await db.transaction.updateMany({
        where: { userId, id: { in: claimedPurchaseIds }, itcClaimedIn: null },
        data: { itcClaimedIn: monthYear },
      })
    }

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
    // 🔒 V20-017: GST filing error — capture with GST-specific tags for Sentry alerting.
    // The POST handler is the most critical — this is where a V20-001-class bug
    // (100× wrong GST filing) would surface as a 500 or as silently wrong data.
    // `action` may not be in scope if the error happened before parsing the body.
    captureGstFilingError(err, {
      route: '/api/gstr-3b',
      action: 'save',  // POST handler is always save/file; exact action unknown in catch
    })
    return apiError(err, 'Failed to save GSTR-3B', 500)
  }
}
