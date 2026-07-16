import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { istMonthStartOffset, getISTDateParts } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'
import { captureGstFilingError } from '@/lib/sentry-gst'
import { logAudit } from '@/lib/audit'
import { deriveStateCode } from '@/lib/gst'
import { buildGstr1, type Gstr1Transaction, type ShopInfo } from '@/lib/gstr1-builder'

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
      select: { gstin: true, state: true, shopName: true },
    })

    const shopGstin = setting?.gstin || null
    const shopState = setting?.state || null
    const shopStateCode = deriveStateCode(null, null, shopGstin, shopState)

    const shop: ShopInfo = {
      gstin: shopGstin,
      state: shopState,
      stateCode: shopStateCode,
    }

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
      items: t.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        hsn: item.hsn,
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

    // Build the GSTR-1 JSON
    const gstr1 = buildGstr1(builderTxns, shop, monthYear)

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
      select: { gstin: true, state: true },
    })
    const shopGstin = setting?.gstin || null
    const shopState = setting?.state || null
    const shopStateCode = deriveStateCode(null, null, shopGstin, shopState)
    const shop: ShopInfo = { gstin: shopGstin, state: shopState, stateCode: shopStateCode }

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

    const gstr1 = buildGstr1(builderTxns, shop, monthYear)

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
