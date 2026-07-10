import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { getISTDateParts, istMonthStartOffset } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/gstr-2b/import
 *
 * V17-Ext Tier 3 Step 2: Upload GSTR-2B JSON from the GST portal.
 *
 * The user downloads the GSTR-2B JSON from the GST portal and uploads it here.
 * We validate it, parse the B2B invoices, and store them for reconciliation.
 *
 * Request body: { monthYear: "072026", data: <2B JSON from portal> }
 *
 * The 2B JSON structure from the portal (simplified):
 * {
 *   "gstin": "27AAAAA0000A1Z5",      // taxpayer's own GSTIN
 *   "fp": "072026",                   // filing period (MMYYYY)
 *   "b2b": [
 *     {
 *       "ctin": "29BBBBB1111B1Z2",   // supplier GSTIN
 *       "inv": [
 *         {
 *           "inum": "INV-001",       // invoice number
 *           "idt": "01-07-2026",     // invoice date (dd-mm-yyyy)
 *           "val": 11800,            // invoice value (total)
 *           "txval": 10000,          // taxable value
 *           "iamt": 1800,            // IGST
 *           "camt": 0,               // CGST
 *           "samt": 0,               // SGST
 *           "rchrg": "N",            // reverse charge (Y/N)
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * Validation:
 *   1. The GSTIN in the 2B file MUST match the shop's Setting.gstin
 *      (prevents uploading someone else's 2B)
 *   2. The fp (filing period) MUST match the requested monthYear
 *   3. Must have at least a b2b array (can be empty — means no B2B purchases)
 *
 * Storage:
 *   - Upserts Gstr2bImport (one per user per month — re-import replaces)
 *   - Deletes old Gstr2bInvoice rows for this import (CASCADE on re-import)
 *   - Creates new Gstr2bInvoice rows for each invoice in the 2B file
 *   - Stores raw JSON in Gstr2bImport.rawJson for audit/re-import
 *
 * Returns: { success, import: { id, monthYear, invoiceCount, totals }, message }
 */
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 🔒 V17-Ext Tier 3 Step 3: CAs are read-only — block 2B import (write op)
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const body = await req.json()
    const { monthYear, data } = body

    // === Validate input ===
    if (!monthYear || typeof monthYear !== 'string' || !/^\d{6}$/.test(monthYear)) {
      return NextResponse.json({ error: 'monthYear is required (format: MMYYYY, e.g. 072026)' }, { status: 400 })
    }

    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'data is required (the GSTR-2B JSON from the GST portal)' }, { status: 400 })
    }

    // === Validate GSTIN match ===
    // The GSTIN in the 2B file must match the shop's GSTIN
    const fileGstin = data.gstin
    if (!fileGstin) {
      return NextResponse.json({ error: 'The uploaded file does not contain a GSTIN. Please download the GSTR-2B JSON from the GST portal.' }, { status: 400 })
    }

    const setting = await db.setting.findUnique({
      where: { userId },
      select: { gstin: true, shopName: true },
    })

    if (setting?.gstin && setting.gstin.toUpperCase() !== String(fileGstin).toUpperCase()) {
      return NextResponse.json({
        error: 'GSTIN mismatch',
        message: `The GSTIN in the uploaded file (${fileGstin}) does not match your shop's GSTIN (${setting.gstin}). Please download the correct GSTR-2B for your GSTIN.`,
      }, { status: 400 })
    }

    // === Validate filing period match ===
    const fileFp = data.fp
    if (fileFp && fileFp !== monthYear) {
      return NextResponse.json({
        error: 'Period mismatch',
        message: `The filing period in the uploaded file (${fileFp}) does not match the requested month (${monthYear}). Please upload the correct month's GSTR-2B.`,
      }, { status: 400 })
    }

    // === Parse the 2B JSON into normalized invoice rows ===
    const b2bEntries = data.b2b || []
    const parsedInvoices: Array<{
      supplierGstin: string
      invoiceNumber: string
      invoiceDate: string | null
      taxableValue: number
      igst: number
      cgst: number
      sgst: number
      totalAmount: number
      isReverseCharge: boolean
    }> = []

    for (const b2bEntry of b2bEntries) {
      const ctin = b2bEntry.ctin
      if (!ctin) continue // skip entries without supplier GSTIN

      const invs = b2bEntry.inv || []
      for (const inv of invs) {
        const inum = inv.inum || inv.inum_inv || 'UNKNOWN'
        parsedInvoices.push({
          supplierGstin: String(ctin).toUpperCase(),
          invoiceNumber: String(inum),
          invoiceDate: inv.idt || inv.dt || null,
          taxableValue: roundMoney(Number(inv.txval) || 0),
          igst: roundMoney(Number(inv.iamt) || 0),
          cgst: roundMoney(Number(inv.camt) || 0),
          sgst: roundMoney(Number(inv.samt) || 0),
          totalAmount: roundMoney(Number(inv.val) || Number(inv.itcval) || 0),
          isReverseCharge: String(inv.rchrg || inv.rchrgitc || 'N').toUpperCase() === 'Y',
        })
      }
    }

    // Compute summary totals
    const taxableTotal = roundMoney(parsedInvoices.reduce((s, i) => s + i.taxableValue, 0))
    const igstTotal = roundMoney(parsedInvoices.reduce((s, i) => s + i.igst, 0))
    const cgstTotal = roundMoney(parsedInvoices.reduce((s, i) => s + i.cgst, 0))
    const sgstTotal = roundMoney(parsedInvoices.reduce((s, i) => s + i.sgst, 0))

    // === Upsert the import (re-import replaces) ===
    // Delete old import + invoices (CASCADE), then create new
    const existing = await db.gstr2bImport.findUnique({
      where: { userId_monthYear: { userId, monthYear } },
    })
    if (existing) {
      await db.gstr2bImport.delete({ where: { id: existing.id } })
      // CASCADE automatically deletes all Gstr2bInvoice rows
    }

    // Compute period dates for the monthYear
    const month = parseInt(monthYear.slice(0, 2))
    const year = parseInt(monthYear.slice(2))
    const monthDate = new Date(Date.UTC(year, month - 1, 15))
    const periodStart = istMonthStartOffset(monthDate, 0)

    const gstr2bImport = await db.gstr2bImport.create({
      data: {
        userId,
        monthYear,
        filingPeriod: fileFp || monthYear,
        supplierGstin: String(fileGstin).toUpperCase(),
        rawJson: data,
        invoiceCount: parsedInvoices.length,
        taxableTotal,
        igstTotal,
        cgstTotal,
        sgstTotal,
        invoices: {
          create: parsedInvoices.map(inv => ({
            userId,
            supplierGstin: inv.supplierGstin,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate,
            taxableValue: inv.taxableValue,
            igst: inv.igst,
            cgst: inv.cgst,
            sgst: inv.sgst,
            totalAmount: inv.totalAmount,
            isReverseCharge: inv.isReverseCharge,
          })),
        },
      },
    })

    // === Audit log ===
    await logAudit({
      userId,
      action: 'gstr2b.imported',
      entityType: 'gstr2bImport',
      entityId: gstr2bImport.id,
      req,
      metadata: {
        monthYear,
        invoiceCount: parsedInvoices.length,
        taxableTotal,
        igstTotal,
        cgstTotal,
        sgstTotal,
      },
    })

    return NextResponse.json({
      success: true,
      import: {
        id: gstr2bImport.id,
        monthYear: gstr2bImport.monthYear,
        invoiceCount: parsedInvoices.length,
        taxableTotal,
        igstTotal,
        cgstTotal,
        sgstTotal,
      },
      message: `GSTR-2B imported successfully. ${parsedInvoices.length} invoice(s) found. Taxable: Rs. ${taxableTotal.toFixed(2)}, Total ITC: Rs. ${roundMoney(igstTotal + cgstTotal + sgstTotal).toFixed(2)}.`,
    })
  } catch (err) {
    return apiError(err, 'Failed to import GSTR-2B', 500)
  }
}
