import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { apiError } from '@/lib/api-error'
import { deriveStateCode } from '@/lib/gst'
import {
  buildIrnRequest,
  isValidIrn,
  isEInvoiceEligible,
  type EInvoiceTransaction,
  type EInvoiceShopInfo,
} from '@/lib/e-invoice'

/**
 * GET /api/e-invoice/irn?transactionId=xxx
 *
 * Returns the IRN request JSON for a transaction (for manual submission to NIC portal)
 * and the current IRN/QR status if already generated.
 *
 * The user can download this JSON and submit it to:
 *   1. The NIC e-Invoice portal (https://einvoice.nic.in)
 *   2. A third-party API provider
 */
export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const transactionId = searchParams.get('transactionId')
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 })
    }

    // Fetch transaction with items + party
    const txn = await db.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
      include: {
        items: true,
        party: true,
      },
    })
    if (!txn) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    // Fetch shop settings
    const setting = await db.setting.findUnique({
      where: { userId },
      select: {
        gstin: true, state: true, shopName: true, ownerName: true,
        address: true, phone: true, email: true,
      },
    })

    const shopGstin = setting?.gstin || null
    const shopState = setting?.state || null
    const shopStateCode = deriveStateCode(null, null, shopGstin, shopState)

    const shop: EInvoiceShopInfo = {
      gstin: shopGstin,
      state: shopState,
      stateCode: shopStateCode,
      shopName: setting?.shopName || null,
      ownerName: setting?.ownerName || null,
      address: setting?.address || null,
      phone: setting?.phone || null,
      email: setting?.email || null,
    }

    const eTxn: EInvoiceTransaction = {
      id: txn.id,
      type: txn.type,
      invoiceNo: txn.invoiceNo,
      date: txn.date,
      totalAmount: roundMoney(txn.totalAmount),
      subtotal: roundMoney(txn.subtotal),
      discountAmount: roundMoney(txn.discountAmount),
      cgst: roundMoney(txn.cgst),
      sgst: roundMoney(txn.sgst),
      igst: roundMoney(txn.igst),
      isInterState: txn.isInterState,
      isReverseCharge: txn.isReverseCharge,
      partyName: txn.party?.name || null,
      partyGstin: txn.party?.gstin || null,
      partyState: txn.party?.state || null,
      partyAddress: txn.party?.address || null,
      partyPhone: txn.party?.phone || null,
      partyEmail: txn.party?.email || null,
      items: txn.items.map(item => ({
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
    }

    // Check eligibility
    const eligibility = isEInvoiceEligible(eTxn, shop)
    if (!eligibility.eligible) {
      return NextResponse.json({
        eligible: false,
        reason: eligibility.reason,
      })
    }

    // Build IRN request JSON
    const irnRequest = buildIrnRequest(
      eTxn,
      shop,
      txn.originalTransactionId || undefined,
      undefined,  // original invoice date would need a separate fetch
    )

    return NextResponse.json({
      eligible: true,
      irnRequest,
      currentStatus: {
        irn: txn.irn || null,
        signedQR: txn.signedQR || null,
        irnStatus: txn.irnStatus || null,
        irnGeneratedAt: txn.irnGeneratedAt || null,
        ewayBillNo: txn.ewayBillNo || null,
        ewayBillExpiry: txn.ewayBillExpiry || null,
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to generate IRN request', 500)
  }
}

/**
 * POST /api/e-invoice/irn
 *
 * Stores the IRN + signed QR result (after the user submits the request JSON
 * to the NIC portal and receives the response).
 *
 * Body: { transactionId, irn, signedQR, ackNo?, ackDt? }
 *
 * This is a "store result" endpoint — the actual NIC API call happens externally
 * (manually or via a third-party provider). The user pastes the IRN + QR from
 * the NIC response into the app.
 */
export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 🔒 CAs are read-only — block IRN storage
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const body = await req.json()
    const { transactionId, irn, signedQR } = body

    if (!transactionId || !irn) {
      return NextResponse.json({ error: 'transactionId and irn are required' }, { status: 400 })
    }

    // Validate IRN format
    if (!isValidIrn(irn)) {
      return NextResponse.json({
        error: 'Invalid IRN format',
        message: 'IRN must be a 64-character alphanumeric string issued by the NIC portal.',
      }, { status: 400 })
    }

    // Verify the transaction belongs to this user
    const txn = await db.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
    })
    if (!txn) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    // Store the IRN + QR
    const updated = await db.transaction.update({
      where: { id: transactionId },
      data: {
        irn,
        signedQR: signedQR || null,
        irnStatus: 'generated',
        irnGeneratedAt: new Date(),
      },
      select: {
        id: true,
        irn: true,
        irnStatus: true,
        irnGeneratedAt: true,
      },
    })

    return NextResponse.json({
      success: true,
      transaction: updated,
      message: 'IRN stored successfully. The invoice is now e-Invoice compliant.',
    })
  } catch (err) {
    return apiError(err, 'Failed to store IRN', 500)
  }
}

/**
 * DELETE /api/e-invoice/irn?transactionId=xxx
 *
 * Cancels an IRN (marks it as cancelled). The actual cancellation must also
 * be done on the NIC portal — this just updates the local status.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const { searchParams } = new URL(req.url)
    const transactionId = searchParams.get('transactionId')
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 })
    }

    const txn = await db.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
    })
    if (!txn) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    if (!txn.irn) {
      return NextResponse.json({ error: 'No IRN to cancel' }, { status: 400 })
    }

    await db.transaction.update({
      where: { id: transactionId },
      data: { irnStatus: 'cancelled' },
    })

    return NextResponse.json({
      success: true,
      message: 'IRN marked as cancelled. Please also cancel it on the NIC portal.',
    })
  } catch (err) {
    return apiError(err, 'Failed to cancel IRN', 500)
  }
}
