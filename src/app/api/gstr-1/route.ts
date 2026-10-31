import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney, fromPaise } from '@/lib/money'
import { istMonthStartOffset, getISTDateParts } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'
import { captureGstFilingError } from '@/lib/sentry-gst'
import { logAudit } from '@/lib/audit'
import { stateCodeOf } from '@/lib/gst'
import { getAdvancesForPeriod } from '@/lib/advances-for-period'
import {
  buildCorrections, filedVersionsFrom, latestVersions, includedCorrections, amendmentTables, amendmentDeadline,
  GSTIN_CORRECTION_ROUTE, GSTIN_CORRECTION_SHORT,
  type Correction, type CurrentDoc, type IncludedCorrections,
} from '@/lib/gstr1-amendments'
import { gstr1aWindow, correctionFitsGstr1a } from '@/lib/gstr1a-window'
import { buildGstr1, documentRow, type Gstr1Transaction, type ShopInfo, type OriginalInvoiceLookup } from '@/lib/gstr1-builder'
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

/*
 * ONE RETURN, BUILT ONE WAY (#342, Phase 8c, 31 Oct 2026).
 *
 * GET (the screen and the downloaded file) and POST ("Save draft" / "Mark as
 * filed") each built the return themselves, and POST's copy — commented "same
 * as GET — DRY" — had drifted: no amendments, no advances (Tables 11A/11B), no
 * cancelled-document counts (Table 13). So "Mark as filed" stored a different
 * return from the one the shopkeeper uploaded, and the filed record never held
 * the corrections that were filed — the baseline #104 compares against. Both
 * now call computeReturn.
 */
type ShopCtx = { gstin: string | null; state: string | null; stateCode: string }

const TXN_INCLUDE = { items: true, party: { select: { gstin: true, state: true, name: true } } } as const

/** Transform a stored bill (with its items and party) to builder input. */
function toBuilderTxn(t: any): Gstr1Transaction {
  return {
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
    placeOfSupply: t.placeOfSupply,
    deliveryState: t.deliveryState,
    // 🔒 V26 BUG-062: pass originalTransactionId so the builder can look up
    // the original invoice's isInterState + totalAmount for B2CS-vs-CDNUR
    // classification (instead of using the note's own potentially-stale values).
    originalTransactionId: t.originalTransactionId || null,
    items: (t.items || []).map((item: any) => ({
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
      total: roundMoney(item.total),  // exact taxable = total − taxes (#98)
    })),
  }
}

/**
 * 🔒 BUG-062 (2026-08-14): the originals of notes whose invoice is NOT among
 * `docs`. A credit note is classified B2CS-vs-CDNUR by its ORIGINAL invoice's
 * inter-state flag and value, not its own — and a note is almost always issued
 * in a LATER month than the invoice it cancels, so the original is usually
 * absent from the period. Fetched by id, unbounded by date, and only for the
 * ids actually missing — when none are, the query does not run at all.
 */
async function originalsFor(userId: string, docs: Array<{ id: string; type: string; originalTransactionId?: string | null }>): Promise<OriginalInvoiceLookup> {
  const have = new Set(docs.map((t) => t.id))
  const missingOriginalIds = [...new Set(
    docs
      .filter((t) => t.type === 'credit-note' && t.originalTransactionId)
      .map((t) => t.originalTransactionId as string)
      .filter((id) => !have.has(id)),
  )]
  const originalInvoices: OriginalInvoiceLookup = new Map()
  if (missingOriginalIds.length > 0) {
    // userId scoped: a note must never be classified by another shop's invoice.
    const rows = await db.transaction.findMany({
      where: { userId, id: { in: missingOriginalIds }, deletedAt: null },
      select: { id: true, isInterState: true, totalAmount: true },
    })
    for (const r of rows) originalInvoices.set(r.id, { isInterState: r.isInterState, totalAmount: roundMoney(r.totalAmount) })
  }
  return originalInvoices
}

/**
 * The filed documents `nums` as the books hold them today — each written by the
 * SAME builder as GSTR-1 itself (documentRow), or marked cancelled.
 *
 * Two queries, not one with the soft-delete filter dropped: an invoice deleted
 * after filing must still be amended to nil, but this file has other queries
 * that must keep filtering deleted rows, and the sweep guard works per FILE.
 */
async function currentDocs(userId: string, nums: string[], shop: ShopInfo): Promise<Map<string, CurrentDoc>> {
  const current = new Map<string, CurrentDoc>()
  if (nums.length === 0) return current
  const [live, cancelled] = await Promise.all([
    db.transaction.findMany({
      /*
       * 🔒 #71: cap removed. This query is ALREADY bounded — by `nums`, the
       * document numbers we previously filed. `take: 5000` could only ever drop
       * filed invoices out of a compliance cross-check.
       */
      where: { userId, invoiceNo: { in: nums }, type: { in: ['sale', 'credit-note'] }, deletedAt: null },
      include: TXN_INCLUDE,
    }),
    db.transaction.findMany({
      // Bounded by `nums` too — same reasoning as above.
      where: { userId, invoiceNo: { in: nums }, type: { in: ['sale', 'credit-note'] }, deletedAt: { not: null } },
      select: { invoiceNo: true },
    }),
  ])
  const originalInvoices = await originalsFor(userId, live)
  for (const t of live) {
    current.set(String(t.invoiceNo), { exists: true, placed: documentRow(toBuilderTxn(t), shop, originalInvoices) })
  }
  for (const t of cancelled) {
    const n = String(t.invoiceNo)
    if (!current.has(n)) current.set(n, { exists: false, placed: null })
  }
  return current
}

/** Parse "YYYY-MM" into the IST period and its portal fp (MMYYYY). */
function periodOf(monthParam: string) {
  const [year, month] = monthParam.split('-').map(Number)
  // Use the 15th of the month to avoid timezone edge cases at month boundaries
  const monthDate = new Date(Date.UTC(year, month - 1, 15))
  const periodStart = istMonthStartOffset(monthDate, 0)
  const periodEnd = istMonthStartOffset(monthDate, 1)
  const istParts = getISTDateParts(periodStart)
  const monthYear = String(istParts.month + 1).padStart(2, '0') + String(istParts.year)
  return { year, month, periodStart, periodEnd, monthYear }
}

/**
 * Everything GSTR-1 for one month: the return, its corrections, its totals.
 * GET and POST both come here (#342).
 */
async function computeReturn(userId: string, monthParam: string) {
  const { year, month, periodStart, periodEnd, monthYear } = periodOf(monthParam)

  // All sales + credit notes for this month (+ income for the NIL section). Not 'debit-note':
  // in EkBook that is a purchase return to a supplier, never a GSTR-1 document (8c).
  const txns = await db.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      type: { in: ['sale', 'credit-note', 'income'] },
      date: { gte: periodStart, lt: periodEnd },
    },
    include: TXN_INCLUDE,
    orderBy: { date: 'asc' },
  })

  const setting = await db.setting.findUnique({
    where: { userId },
    select: { gstin: true, state: true, shopName: true, priorFyTurnover: true },
  })
  const shopGstin = setting?.gstin || null
  const shopState = setting?.state || null
  const shopStateCode = stateCodeOf({ gstin: shopGstin, state: shopState })
  // Phase 2 (#118): refuse rather than write place of supply "00", which
  // the portal rejects. A registered shop's GSTIN always gives the code;
  // this only stops a shop with neither a GSTIN nor a recognised state.
  if (!shopStateCode) {
    return {
      error: NextResponse.json({
        error: 'Shop state not set',
        message: 'Add your GSTIN or your state in Shop profile — GSTR-1 needs it for the place of supply.',
      }, { status: 400 }),
    } as const
  }
  const shop: ShopInfo = { gstin: shopGstin, state: shopState, stateCode: shopStateCode }

  // 🔒 V26 N9: Fetch prior-FY outward turnover for the `gt` field.
  // Sales less credit notes. Not 'debit-note': in EkBook that is a purchase return (8c).
  // Raw SQL aggregate — the money extension doesn't intercept $queryRaw, so we get
  // paise back and convert via fromPaise.
  const priorFY = getPriorFYBounds(year, month)
  const priorFyRows = await db.$queryRaw<Array<{ turnoverPaise: bigint }>>`
    SELECT
      COALESCE(SUM(CASE WHEN "type" = 'sale' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN "type" = 'credit-note' THEN "subtotal" - "discountAmount" ELSE 0 END), 0) AS "turnoverPaise"
    FROM "Transaction"
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND "type" IN ('sale', 'credit-note')
      AND "date" >= ${priorFY.start}
      AND "date" < ${priorFY.end}
  `
  const computedPriorFy = fromPaise(Number(priorFyRows[0]?.turnoverPaise ?? 0))
  /*
   * A declared figure wins over the computed one. `?? computed` and not
   * `|| computed`: null means "I have not said"; zero means "I have said, and
   * it is zero" — a declared zero must not be overwritten.
   */
  const priorFyTurnover = setting?.priorFyTurnover ?? computedPriorFy

  const originalInvoices = await originalsFor(userId, txns)
  const builderTxns: Gstr1Transaction[] = txns.map(toBuilderTxn)

  /*
   * Cancelled documents, for Table 13. A cancelled invoice still CONSUMED its
   * number, which is exactly why the portal asks for a count instead of letting
   * it vanish. Only numbered documents matter here.
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

  const existingSnapshot = await db.gstr1Snapshot.findUnique({
    where: { userId_monthYear: { userId, monthYear } },
  })

  /*
   * Tables 9A / 9C — documents from earlier FILED returns that have since changed.
   *
   * Only FILED periods produce corrections: a draft can still be corrected in
   * place. Compared with the LAST version filed (#104), against the books as
   * they stand, not an "edited" flag — a total can move by routes no flag would
   * catch. And none goes into the return until switched on (#103): included
   * are those whose stored fingerprint still matches.
   */
  const filedSnapshots = await db.gstr1Snapshot.findMany({
    where: { userId, filingStatus: 'filed', monthYear: { not: monthYear } },
    take: 120,  // ten years of monthly filings — a shop cannot have more
    select: { monthYear: true, rawJson: true, periodStart: true },
  })
  const latest = latestVersions(
    filedSnapshots
      .filter((s) => s.periodStart < periodStart)   // earlier periods only
      .flatMap((s) => filedVersionsFrom(s.rawJson, s.monthYear)),
  )
  const corrections: Correction[] = latest.length
    ? buildCorrections(latest, await currentDocs(userId, [...new Set(latest.map((v) => v.num))], shop))
    : []
  const included = includedCorrections(corrections, existingSnapshot?.includedAmendments as IncludedCorrections | null)

  const gstr1 = buildGstr1(builderTxns, shop, monthYear, {
    amendments: amendmentTables(included),
    priorFyTurnover,
    // 🔒 BUG-062: originals for notes whose invoice is in an earlier month.
    originalInvoices,
    cancelled: cancelledForDoc,
    advancesReceivedThisPeriod: advances.receivedThisPeriod,
    // 11B releases only what an earlier period's 11A already declared.
    advancesFromEarlierPeriods: advances.fromEarlierPeriods,
  })

  const sales = builderTxns.filter(t => t.type === 'sale')
  const totals = {
    totalTaxableValue: roundMoney(sales.reduce((s, t) => s + t.subtotal - t.discountAmount, 0)),
    totalOutputTax: roundMoney(sales.reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0)),
    totalInvoiceCount: sales.length,
    totalCreditNotes: builderTxns.filter(t => t.type === 'credit-note').length,
  }

  const shopCtx: ShopCtx = { gstin: shopGstin, state: shopState, stateCode: shopStateCode }
  return { monthYear, periodStart, periodEnd, shop, shopCtx, gstr1, totals, existingSnapshot, corrections, included } as const
}

/** What the screen shows for each correction: the switch, the two figures, the deadline (#103). */
function correctionsForScreen(all: Correction[], included: Correction[], existingIncluded: IncludedCorrections | null) {
  const on = new Set(included.map((c) => c.key))
  return all.map((c) => {
    const deadline = amendmentDeadline(c.firstFp)
    const stored = existingIncluded?.[c.key]
    return {
      key: c.key,
      section: c.section,
      number: c.original.num,
      firstFp: c.firstFp,
      lastFp: c.lastFp,
      filedVal: c.filedVal,
      nowVal: c.nowVal,
      changes: c.changes,
      fingerprint: c.fingerprint,
      included: on.has(c.key),
      // Switched on for an older version of the bill: it has changed again since, so it is off until confirmed again.
      lapsed: !!stored && stored !== c.fingerprint,
      canInclude: !!c.row && !deadline.expired,
      // The row gets the short form; the full advice (and the CA note) sits behind ⓘ.
      problem: c.problem === GSTIN_CORRECTION_ROUTE ? GSTIN_CORRECTION_SHORT : c.problem ?? (deadline.expired ? deadline.message : null),
      problemInfo: c.problem === GSTIN_CORRECTION_ROUTE ? GSTIN_CORRECTION_ROUTE : null,
      deadline: deadline.message,
      // #344: the date alone, for the row; the sentence goes behind ⓘ.
      deadlineDate: deadline.effectiveDeadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      daysLeft: deadline.daysLeft,
    }
  })
}

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

    const r = await computeReturn(userId, monthParam)
    if ('error' in r) return r.error
    const { monthYear, periodStart, periodEnd, shop, shopCtx, gstr1, totals, existingSnapshot, corrections, included } = r

    /*
     * ── GSTR-1A: THIS period's own correction window (#41) ────────────────
     *
     * Everything above deals with EARLIER periods — `monthYear: { not: ... }`
     * — so a correction to the period being viewed has never appeared on its
     * own screen. The window is open when this period's GSTR-1 is filed and
     * its OWN GSTR-3B is not. Both facts are already stored, so nothing is
     * guessed. Correcting inside the window means the right tax is paid once.
     */
    let gstr1a: {
      window: ReturnType<typeof gstr1aWindow>
      corrections: Array<{ inum: string; changes: string[]; fitsGstr1a: boolean; reason: string }>
      blockedCount: number
    } | null = null

    if (existingSnapshot?.filingStatus === 'filed') {
      const own3b = await db.gstReturn.findUnique({
        where: { userId_monthYear: { userId, monthYear } },
        select: { filingStatus: true },
      })
      const window = gstr1aWindow({
        gstr1Filed: true,
        gstr3bFiled: own3b?.filingStatus === 'filed',
        /*
         * Frequency is not stored anywhere yet, so this passes null and the
         * window answers for a monthly filer — logged as the known limit.
         */
        filingFrequency: null,
      })

      /*
       * The SAME comparison the later-period corrections use — the filed
       * version against the books as they stand, through buildCorrections.
       * Two rules answering "has this document changed?" would drift, and this
       * one decides which return a correction belongs in.
       */
      const ownFiled = latestVersions(filedVersionsFrom(existingSnapshot.rawJson, monthYear))
      const ownCorrections: Array<{ inum: string; changes: string[]; fitsGstr1a: boolean; reason: string }> = []

      if (window.isOpen && ownFiled.length > 0) {
        const own = buildCorrections(ownFiled, await currentDocs(userId, [...new Set(ownFiled.map((v) => v.num))], shop))
        for (const c of own) {
          const fit = correctionFitsGstr1a(c.changes)
          ownCorrections.push({ inum: c.original.num, changes: c.changes, fitsGstr1a: fit.fits, reason: fit.reason })
        }
      }

      gstr1a = {
        window,
        corrections: ownCorrections,
        blockedCount: ownCorrections.filter(c => !c.fitsGstr1a).length,
      }
    }

    return NextResponse.json({
      gstr1a,
      period: {
        monthYear,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        monthLabel: new Date(periodStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
      },
      gstr1,
      corrections: correctionsForScreen(corrections, included, existingSnapshot?.includedAmendments as IncludedCorrections | null),
      summary: totals,
      shop: shopCtx,
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
 * Saves or files a GSTR-1 snapshot, or switches one correction in or out. The
 * server RE-COMPUTES all values (never trusts client-sent financial data).
 *
 * Body:
 *   { month: "2026-07", action: "save" | "file" }
 *     - "save": creates/updates a draft snapshot
 *     - "file": marks the snapshot as "filed" (immutable)
 *   { month, action: "include", key, fingerprint, include: boolean }   (#103)
 *     - include one correction in this month's return, or take it out. The
 *       fingerprint must match the correction as it stands NOW, so a switch
 *       cannot be set on a version the shopkeeper has not seen.
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

    if (!monthParam || typeof monthParam !== 'string' || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'month is required (format: YYYY-MM)' }, { status: 400 })
    }
    if (action !== 'save' && action !== 'file' && action !== 'include') {
      return NextResponse.json({ error: 'action must be "save", "file" or "include"' }, { status: 400 })
    }

    // Check if already filed (immutable)
    const { monthYear } = periodOf(monthParam)
    const existing = await db.gstr1Snapshot.findUnique({
      where: { userId_monthYear: { userId, monthYear } },
    })
    if (existing?.filingStatus === 'filed') {
      return NextResponse.json({
        error: 'Already filed',
        message: action === 'include'
          ? 'This month’s GSTR-1 is filed. A correction can go into a later month’s return instead.'
          : 'This GSTR-1 has already been filed. To correct it, file a revised return on the GST portal.',
      }, { status: 409 })
    }

    const r = await computeReturn(userId, monthParam)
    if ('error' in r) return r.error
    const { periodStart, periodEnd, gstr1, totals, corrections } = r

    if (action === 'include') {
      const { key, fingerprint, include } = body
      const c = corrections.find((x) => x.key === key)
      if (!c) return NextResponse.json({ error: 'Not found', message: 'That correction is no longer pending.' }, { status: 404 })
      if (include && (!c.row || amendmentDeadline(c.firstFp).expired)) {
        return NextResponse.json({ error: 'Cannot include', message: c.problem ?? amendmentDeadline(c.firstFp).message }, { status: 409 })
      }
      if (include && fingerprint !== c.fingerprint) {
        return NextResponse.json({ error: 'Changed', message: 'This bill changed again since the screen loaded. Look at it again, then switch it on.' }, { status: 409 })
      }
      const next: IncludedCorrections = { ...((existing?.includedAmendments as IncludedCorrections | null) || {}) }
      if (include) next[c.key] = c.fingerprint
      else delete next[c.key]
      await db.gstr1Snapshot.upsert({
        where: { userId_monthYear: { userId, monthYear } },
        update: { includedAmendments: next },
        create: { userId, monthYear, periodStart, periodEnd, filingStatus: 'draft', includedAmendments: next },
      })
      await logAudit({
        userId,
        action: include ? 'gstr1.correction.included' : 'gstr1.correction.removed',
        entityType: 'gstr1Snapshot',
        entityId: monthYear,
        req,
        metadata: { monthYear, key: c.key, fingerprint: c.fingerprint, filedVal: c.filedVal, nowVal: c.nowVal },
      })
      return NextResponse.json({ success: true, key: c.key, included: !!include })
    }

    // === Upsert the snapshot — the SAME return GET shows and downloads (#342) ===
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
        ...totals,
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
        ...totals,
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
        totalTaxableValue: totals.totalTaxableValue,
        totalOutputTax: totals.totalOutputTax,
        totalInvoiceCount: totals.totalInvoiceCount,
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
