import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney, fromPaise } from '@/lib/money'
import { istMonthStartOffset, getISTDateParts } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'
import { captureGstFilingError } from '@/lib/sentry-gst'
import { logAudit } from '@/lib/audit'
import { deriveStateCode } from '@/lib/gst'
import { getAdvancesForPeriod } from '@/lib/advances-for-period'
import { buildAmendments, filedInvoicesFrom } from '@/lib/gstr1-amendments'
import { buildGstr1, type Gstr1Transaction, type ShopInfo } from '@/lib/gstr1-builder'
import { getPriorFYBounds } from '@/lib/fiscal-year'

/**
 * GET /api/gstr-1?month=2026-07
 *
 * 🔒 V17 Audit Phase 3: Computes a GSTR-1 filing export for a given IST month.
 * Returns the portal-ready JSON structure with all 8 sections:
 *   B2B, B2CL, B2CS, CDNR, CDNUR, HSN, NIL, DOC
 *
 * Also returns the existing Gstr1Snapshot if one exists (for filed/draft status).
 *
 * The JSON can be directly uploaded to the GST portal.
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

    // Parse month param (YYYY-MM)
    const { searchParams } = new URL(req.url)
    const monthParam = searchParams.get('month')
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'month is required (format: YYYY-MM, e.g. 2026-07)' }, { status: 400 })
    }

    const [year, month] = monthParam.split('-').map(Number)
    // Use the 15th of the month to avoid timezone edge cases at month boundaries
    const monthDate = new Date(Date.UTC(year, month - 1, 15))
    const periodStart = istMonthStartOffset(monthDate, 0)
    const periodEnd = istMonthStartOffset(monthDate, 1)

    // monthYear string (MMYYYY format — matches GSTR-1 fp)
    const istParts = getISTDateParts(periodStart)
    const monthYear = String(istParts.month + 1).padStart(2, '0') + String(istParts.year)

    // Fetch all transactions for this month (sales + credit-notes + income for NIL section)
    const txns = await db.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: { in: ['sale', 'credit-note', 'income'] },
        date: { gte: periodStart, lt: periodEnd },
      },
      include: {
        items: true,
        party: { select: { gstin: true, state: true, name: true } },
      },
      orderBy: { date: 'asc' },
    })

    // Fetch shop settings for GSTIN + state
    const setting = await db.setting.findUnique({
      where: { userId },
      select: { gstin: true, state: true, shopName: true, priorFyTurnover: true },
    })

    const shopGstin = setting?.gstin || null
    const shopState = setting?.state || null
    const shopStateCode = deriveStateCode(null, null, shopGstin, shopState)

    const shop: ShopInfo = {
      gstin: shopGstin,
      state: shopState,
      stateCode: shopStateCode,
    }

    // 🔒 V26 N9: Fetch prior-FY outward turnover for the `gt` field.
    // Indian FY: April 1 → March 31. Raw SQL aggregate — the money extension
    // doesn't intercept $queryRaw, so we get paise back and convert via
    // fromPaise. Same pattern as insights/route.ts.
    const priorFY = getPriorFYBounds(year, month)
    const priorFyRows = await db.$queryRaw<Array<{ turnoverPaise: bigint }>>`
      SELECT
        COALESCE(SUM(CASE WHEN "type" = 'sale' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN "type" = 'credit-note' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN "type" = 'debit-note' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) AS "turnoverPaise"
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
        AND "type" IN ('sale', 'credit-note', 'debit-note')
        AND "date" >= ${priorFY.start}
        AND "date" < ${priorFY.end}
    `
    const computedPriorFy = fromPaise(Number(priorFyRows[0]?.turnoverPaise ?? 0))
    /*
     * A declared figure wins over the computed one.
     *
     * Computing from the app's own transactions is right for a shop that has
     * used it all along, and wrong for one that traded on paper for years and
     * started here in July — that shop's real prior-year turnover is not in the
     * database, so the computed value reads 0 and understates them. Turnover
     * decides HSN digit requirements and e-invoicing applicability, so a wrong
     * zero is not cosmetic.
     *
     * `?? computed` and not `|| computed`: a shopkeeper who genuinely turned
     * over nothing last year and says so must not have that answer overwritten
     * by the same zero arriving from a different route. Null means "I have not
     * said"; zero means "I have said, and it is zero".
     */
    const declaredPriorFy = setting?.priorFyTurnover
    const priorFyTurnover = declaredPriorFy ?? computedPriorFy

    // Transform DB rows to builder input
    const builderTxns: Gstr1Transaction[] = txns.map(t => ({
      id: t.id,
      type: t.type,
      invoiceNo: t.invoiceNo,
      date: t.date,
      totalAmount: roundMoney(t.totalAmount),
      subtotal: roundMoney(t.subtotal),
      discountAmount: roundMoney(t.discountAmount),
      cgst: roundMoney(t.cgst),
      sgst: roundMoney(t.sgst),
      igst: roundMoney(t.igst),
      isInterState: t.isInterState,
      isReverseCharge: t.isReverseCharge,
      partyId: t.partyId,
      partyName: t.party?.name || null,
      partyGstin: t.party?.gstin || null,
      partyState: t.party?.state || null,
      // 🔒 V26 BUG-062: pass originalTransactionId so the builder can look up
      // the original invoice's isInterState + totalAmount for B2CS-vs-CDNUR
      // classification (instead of using the note's own potentially-stale values).
      originalTransactionId: t.originalTransactionId || null,
      items: t.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        hsn: item.hsn,
        gstTreatment: item.gstTreatment,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: roundMoney(item.unitPrice),
        gstRate: item.gstRate,
        discountAmount: roundMoney(item.discountAmount),
        cgst: roundMoney(item.cgst),
        sgst: roundMoney(item.sgst),
        igst: roundMoney(item.igst),
        csamt: roundMoney(item.csamt || 0),
      })),
    }))

    /*
     * Cancelled documents, for Table 13.
     *
     * buildDOC used to hardcode `cancel: 0` with the comment "no cancellation
     * tracking yet", so the return declared that nothing had been cancelled
     * regardless of the truth. A real August 2026 file showed INV-0044 jumping
     * to INV-0053 — eight numbers gone — beside `cancel: 0`. One of those two
     * statements had to be false, and it was the declared one.
     *
     * A cancelled invoice still CONSUMED its number, which is exactly why the
     * portal asks for a count instead of letting it vanish. Only numbered
     * documents matter here: an unnumbered draft never entered the series.
     */
    const cancelledTxns = await db.transaction.findMany({
      where: {
        userId,
        deletedAt: { not: null },
        type: { in: ['sale', 'credit-note'] },
        date: { gte: periodStart, lt: periodEnd },
        invoiceNo: { not: null },
      },
      select: { id: true, type: true, invoiceNo: true, date: true },
    })
    const cancelledForDoc = cancelledTxns.map(t => ({
      id: t.id, type: t.type, invoiceNo: t.invoiceNo, date: t.date,
      totalAmount: 0, subtotal: 0, discountAmount: 0, cgst: 0, sgst: 0, igst: 0,
      isInterState: false, isReverseCharge: false,
      partyId: null, partyName: null, partyGstin: null, partyState: null,
      items: [],
    }))

    // Tables 11A/11B — money taken before the bill existed. Fetched by the same
    // helper GSTR-3B uses, so the two returns cannot disagree about advances.
    const advances = await getAdvancesForPeriod(userId, periodStart, periodEnd, shopStateCode)

    /*
     * Table 9A — invoices from earlier FILED returns that have since changed.
     *
     * Only FILED periods produce amendments: a draft can still be corrected in
     * place, and amending something never filed would declare a correction to a
     * return the department has never seen.
     *
     * The comparison is against the books as they stand, not against an "edited"
     * flag, because a total can move by routes no flag would catch — a line
     * deleted, a price corrected, a discount applied later. The honest question
     * is whether the invoice still says what we told the department it said.
     */
    const filedSnapshots = await db.gstr1Snapshot.findMany({
      where: { userId, filingStatus: 'filed', monthYear: { not: monthYear } },
      take: 120,  // ten years of monthly filings — a shop cannot have more
      select: { monthYear: true, rawJson: true, periodStart: true },
    })
    const filedInvoices = filedSnapshots
      .filter((s) => s.periodStart < periodStart)   // earlier periods only
      .flatMap((s) => filedInvoicesFrom(s.rawJson, s.monthYear))

    let amendments: { b2ba: Array<{ ctin: string; inv: unknown[] }>; b2cla: Array<{ pos: string; inv: unknown[] }> } =
      { b2ba: [], b2cla: [] }
    if (filedInvoices.length > 0) {
      const nums = [...new Set(filedInvoices.map((f) => f.inum))]
      /*
       * Two queries, not one with the soft-delete filter dropped.
       *
       * Cancellation matters here — an invoice deleted after filing must still
       * be amended to nil, or the buyer keeps claiming credit on a bill that no
       * longer exists. The lazy way to get both is to omit `deletedAt`
       * entirely, but this file has other transaction queries that must keep
       * filtering it, and the sweep guard works per FILE: one blanket exception
       * would stop protecting those too. So each query says explicitly which
       * set it wants.
       */
      const [live, cancelled] = await Promise.all([
        db.transaction.findMany({
          where: { userId, invoiceNo: { in: nums }, type: 'sale', deletedAt: null },
          take: 5000,
          select: {
            invoiceNo: true, date: true, totalAmount: true,
            party: { select: { gstin: true, state: true } },
          },
        }),
        db.transaction.findMany({
          where: { userId, invoiceNo: { in: nums }, type: 'sale', deletedAt: { not: null } },
          take: 5000,
          select: { invoiceNo: true },
        }),
      ])
      const cancelledNums = new Set(cancelled.map((t) => String(t.invoiceNo)))

      const current = new Map(
        live.map((t) => {
          const partyState = deriveStateCode(t.party?.state || null, null, t.party?.gstin || null, null)
          return [String(t.invoiceNo), {
            inum: String(t.invoiceNo),
            idt: formatPortalDateForAmendment(t.date),
            val: roundMoney(t.totalAmount),
            pos: partyState || shopStateCode || '',
            ctin: t.party?.gstin || undefined,
            // These came from the live query, so they exist by construction.
            exists: true,
          }]
        }),
      )
      /*
       * A cancelled invoice is absent from `live`, and buildAmendments already
       * treats "not present" as cancelled. Adding it explicitly makes the
       * intent legible rather than relying on an absence, and keeps working if
       * the live query ever grows a narrower filter.
       */
      for (const inum of cancelledNums) {
        if (!current.has(inum)) {
          current.set(inum, { inum, idt: '', val: 0, pos: '', ctin: undefined, exists: false })
        }
      }
      amendments = buildAmendments(filedInvoices, current) as typeof amendments
    }

    // Build the GSTR-1 JSON
    const gstr1 = buildGstr1(builderTxns, shop, monthYear, {
      amendments,
      priorFyTurnover,
      cancelled: cancelledForDoc,
      advancesReceivedThisPeriod: advances.receivedThisPeriod,
      // 11B releases only what an earlier period's 11A already declared.
      advancesFromEarlierPeriods: advances.fromEarlierPeriods,
    })

    // Compute summary totals
    const totalTaxableValue = roundMoney(
      builderTxns
        .filter(t => t.type === 'sale')
        .reduce((s, t) => s + t.subtotal - t.discountAmount, 0)
    )
    const totalOutputTax = roundMoney(
      builderTxns
        .filter(t => t.type === 'sale')
        .reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0)
    )
    const totalInvoiceCount = builderTxns.filter(t => t.type === 'sale').length
    const totalCreditNotes = builderTxns.filter(t => t.type === 'credit-note').length

    // Fetch existing snapshot
    const existingSnapshot = await db.gstr1Snapshot.findUnique({
      where: { userId_monthYear: { userId, monthYear } },
    })

    return NextResponse.json({
      period: {
        monthYear,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        monthLabel: new Date(periodStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
      },
      gstr1,
      summary: {
        totalTaxableValue,
        totalOutputTax,
        totalInvoiceCount,
        totalCreditNotes,
      },
      shop: {
        gstin: shopGstin,
        state: shopState,
        stateCode: shopStateCode,
      },
      snapshot: existingSnapshot ? {
        id: existingSnapshot.id,
        filingStatus: existingSnapshot.filingStatus,
        filedAt: existingSnapshot.filedAt,
        filedByUserId: existingSnapshot.filedByUserId,
        filedTotalTaxableValue: existingSnapshot.totalTaxableValue,
        filedTotalOutputTax: existingSnapshot.totalOutputTax,
      } : null,
    })
  } catch (err) {
    // 🔒 V20-017: GST filing error — capture with GST-specific tags for Sentry alerting
    captureGstFilingError(err, {
      route: '/api/gstr-1',
      action: 'compute',
    })
    return apiError(err, 'Failed to compute GSTR-1', 500)
  }
}

/**
 * POST /api/gstr-1
 *
 * Saves or files a GSTR-1 snapshot. The server RE-COMPUTES all values (never
 * trusts client-sent financial data) and upserts to Gstr1Snapshot.
 *
 * Body: { month: "2026-07", action: "save" | "file" }
 *   - "save": creates/updates a draft snapshot
 *   - "file": marks the snapshot as "filed" (immutable)
 *
 * If already filed, returns 409 (must file a revised return on the portal).
 * CAs are blocked (assertCanWrite).
 */
export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 🔒 V17 Audit Phase 3: CAs are read-only — block save/file
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const body = await req.json()
    const { month: monthParam, action } = body

    if (!monthParam || typeof monthParam !== 'string') {
      return NextResponse.json({ error: 'month is required (format: YYYY-MM)' }, { status: 400 })
    }
    if (action !== 'save' && action !== 'file') {
      return NextResponse.json({ error: 'action must be "save" or "file"' }, { status: 400 })
    }

    const [year, month] = monthParam.split('-').map(Number)
    const monthDate = new Date(Date.UTC(year, month - 1, 15))
    const periodStart = istMonthStartOffset(monthDate, 0)
    const periodEnd = istMonthStartOffset(monthDate, 1)
    const istParts = getISTDateParts(periodStart)
    const monthYear = String(istParts.month + 1).padStart(2, '0') + String(istParts.year)

    // Check if already filed (immutable)
    const existing = await db.gstr1Snapshot.findUnique({
      where: { userId_monthYear: { userId, monthYear } },
    })
    if (existing?.filingStatus === 'filed') {
      return NextResponse.json({
        error: 'Already filed',
        message: 'This GSTR-1 has already been filed. To correct it, file a revised return on the GST portal.',
      }, { status: 409 })
    }

    // === Re-compute the GSTR-1 (same as GET — DRY) ===
    const txns = await db.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: { in: ['sale', 'credit-note', 'income'] },
        date: { gte: periodStart, lt: periodEnd },
      },
      include: {
        items: true,
        party: { select: { gstin: true, state: true, name: true } },
      },
      orderBy: { date: 'asc' },
    })

    const setting = await db.setting.findUnique({
      where: { userId },
      select: { gstin: true, state: true, priorFyTurnover: true },
    })
    const shopGstin = setting?.gstin || null
    const shopState = setting?.state || null
    const shopStateCode = deriveStateCode(null, null, shopGstin, shopState)
    const shop: ShopInfo = { gstin: shopGstin, state: shopState, stateCode: shopStateCode }

    // 🔒 V26 N9: Fetch prior-FY outward turnover for the `gt` field (same as GET).
    const priorFY = getPriorFYBounds(year, month)
    const priorFyRows = await db.$queryRaw<Array<{ turnoverPaise: bigint }>>`
      SELECT
        COALESCE(SUM(CASE WHEN "type" = 'sale' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN "type" = 'credit-note' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN "type" = 'debit-note' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) AS "turnoverPaise"
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
        AND "type" IN ('sale', 'credit-note', 'debit-note')
        AND "date" >= ${priorFY.start}
        AND "date" < ${priorFY.end}
    `
    const computedPriorFy = fromPaise(Number(priorFyRows[0]?.turnoverPaise ?? 0))
    /*
     * A declared figure wins over the computed one.
     *
     * Computing from the app's own transactions is right for a shop that has
     * used it all along, and wrong for one that traded on paper for years and
     * started here in July — that shop's real prior-year turnover is not in the
     * database, so the computed value reads 0 and understates them. Turnover
     * decides HSN digit requirements and e-invoicing applicability, so a wrong
     * zero is not cosmetic.
     *
     * `?? computed` and not `|| computed`: a shopkeeper who genuinely turned
     * over nothing last year and says so must not have that answer overwritten
     * by the same zero arriving from a different route. Null means "I have not
     * said"; zero means "I have said, and it is zero".
     */
    const declaredPriorFy = setting?.priorFyTurnover
    const priorFyTurnover = declaredPriorFy ?? computedPriorFy

    const builderTxns: Gstr1Transaction[] = txns.map(t => ({
      id: t.id,
      type: t.type,
      invoiceNo: t.invoiceNo,
      date: t.date,
      totalAmount: roundMoney(t.totalAmount),
      subtotal: roundMoney(t.subtotal),
      discountAmount: roundMoney(t.discountAmount),
      cgst: roundMoney(t.cgst),
      sgst: roundMoney(t.sgst),
      igst: roundMoney(t.igst),
      isInterState: t.isInterState,
      isReverseCharge: t.isReverseCharge,
      partyId: t.partyId,
      partyName: t.party?.name || null,
      partyGstin: t.party?.gstin || null,
      partyState: t.party?.state || null,
      items: t.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        hsn: item.hsn,
        gstTreatment: item.gstTreatment,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: roundMoney(item.unitPrice),
        gstRate: item.gstRate,
        discountAmount: roundMoney(item.discountAmount),
        cgst: roundMoney(item.cgst),
        sgst: roundMoney(item.sgst),
        igst: roundMoney(item.igst),
        csamt: roundMoney(item.csamt || 0),
      })),
    }))

    const gstr1 = buildGstr1(builderTxns, shop, monthYear, { priorFyTurnover })

    const totalTaxableValue = roundMoney(
      builderTxns.filter(t => t.type === 'sale').reduce((s, t) => s + t.subtotal - t.discountAmount, 0)
    )
    const totalOutputTax = roundMoney(
      builderTxns.filter(t => t.type === 'sale').reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0)
    )
    const totalInvoiceCount = builderTxns.filter(t => t.type === 'sale').length
    const totalCreditNotes = builderTxns.filter(t => t.type === 'credit-note').length

    // === Upsert the snapshot ===
    const filingStatus = action === 'file' ? 'filed' : 'draft'
    const filedAt = action === 'file' ? new Date() : null
    const filedByUserId = action === 'file' ? (authCtx.actingUserId || userId) : null

    const snapshot = await db.gstr1Snapshot.upsert({
      where: { userId_monthYear: { userId, monthYear } },
      update: {
        filingStatus,
        filedAt,
        filedByUserId,
        rawJson: gstr1 as any,
        totalTaxableValue,
        totalOutputTax,
        totalInvoiceCount,
        totalCreditNotes,
      },
      create: {
        userId,
        monthYear,
        periodStart,
        periodEnd,
        filingStatus,
        filedAt,
        filedByUserId,
        rawJson: gstr1 as any,
        totalTaxableValue,
        totalOutputTax,
        totalInvoiceCount,
        totalCreditNotes,
      },
    })

    // 🔒 Audit log
    await logAudit({
      userId,
      action: action === 'file' ? 'gstr1.filed' : 'gstr1.saved',
      entityType: 'gstr1Snapshot',
      entityId: snapshot.id,
      req,
      metadata: {
        monthYear,
        filingStatus,
        totalTaxableValue,
        totalOutputTax,
        totalInvoiceCount,
      },
    })

    return NextResponse.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        monthYear: snapshot.monthYear,
        filingStatus: snapshot.filingStatus,
        filedAt: snapshot.filedAt,
        totalTaxableValue: snapshot.totalTaxableValue,
        totalOutputTax: snapshot.totalOutputTax,
      },
      message: action === 'file'
        ? 'GSTR-1 marked as filed. Download the JSON and upload it to the GST portal.'
        : 'GSTR-1 draft saved.',
    })
  } catch (err) {
    // 🔒 V20-017: GST filing error — capture with GST-specific tags for Sentry alerting
    captureGstFilingError(err, {
      route: '/api/gstr-1',
      action: 'save',
    })
    return apiError(err, 'Failed to save GSTR-1', 500)
  }
}


/** dd-mm-yyyy, the only date format the portal accepts. Matches the builder. */
function formatPortalDateForAmendment(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return d + '-' + m + '-' + date.getFullYear()
}
