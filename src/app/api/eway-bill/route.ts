import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'

/**
 * Save the e-way bill number a shopkeeper got from the portal.
 *
 * WHY (2026-08-09). The app can now tell them when a consignment probably needs
 * one, but had nowhere to put the answer. Without that the warning never goes
 * away — it would sit on a bill whose e-way bill was generated an hour ago,
 * which is how a useful warning turns into wallpaper.
 *
 * It is also the record that matters if the vehicle is stopped: the number and
 * its validity date are what an officer asks for, and the shopkeeper should be
 * able to read them off the bill rather than dig through the portal.
 *
 * NOT GENERATED HERE. The e-way bill portal issues the number; this app is not
 * connected to it and must not pretend otherwise. The shopkeeper generates it
 * there and records it here — exactly the arrangement already used for the
 * e-invoice IRN, and honest about what this app does and does not do.
 */

/** 12 digits, as issued by the NIC e-way bill system. */
const EWAY_BILL_NO = /^\d{12}$/

export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'sales')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError
    const userId = authCtx.userId

    const body = await req.json().catch(() => ({}))
    const { transactionId, ewayBillNo, ewayBillExpiry } = body || {}

    if (typeof transactionId !== 'string' || !transactionId || transactionId.length > 100) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 })
    }

    /*
     * An empty number CLEARS it — the shopkeeper mistyped, or the bill was
     * cancelled on the portal. Without this the only way to correct a wrong
     * number would be to leave it wrong.
     */
    const clearing = ewayBillNo === null || ewayBillNo === ''
    if (!clearing) {
      if (typeof ewayBillNo !== 'string' || !EWAY_BILL_NO.test(ewayBillNo.trim())) {
        return NextResponse.json({
          error: 'Invalid e-way bill number',
          message: 'An e-way bill number is 12 digits. Check the number on the portal and try again.',
        }, { status: 400 })
      }
    }

    let expiry: Date | null = null
    if (!clearing && ewayBillExpiry) {
      const d = new Date(ewayBillExpiry)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid validity date' }, { status: 400 })
      }
      expiry = d
    }

    // Scoped to this user's own transaction — never another shop's.
    const txn = await db.transaction.findFirst({
      where: { id: transactionId, userId, deletedAt: null },
      select: { id: true, type: true, invoiceNo: true, ewayBillNo: true },
    })
    if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    if (txn.type !== 'sale') {
      return NextResponse.json({
        error: 'Only a sale can carry an e-way bill',
        message: 'The consignment on a purchase is your supplier’s to declare, not yours.',
      }, { status: 400 })
    }

    const updated = await db.transaction.update({
      where: { id: txn.id },
      data: {
        ewayBillNo: clearing ? null : String(ewayBillNo).trim(),
        ewayBillExpiry: clearing ? null : expiry,
      },
      select: { id: true, ewayBillNo: true, ewayBillExpiry: true },
    })

    await logAudit({
      userId,
      action: clearing ? 'delete' : 'update',
      entityType: 'transaction',
      entityId: txn.id,
      // A number that proves a consignment was declared has to be answerable
      // later, so both the old and the new value are recorded.
      metadata: { field: 'ewayBillNo', from: txn.ewayBillNo, to: updated.ewayBillNo, invoiceNo: txn.invoiceNo },
    })

    return NextResponse.json({
      success: true,
      ewayBillNo: updated.ewayBillNo,
      ewayBillExpiry: updated.ewayBillExpiry,
      message: clearing ? 'E-way bill number removed.' : 'E-way bill number saved.',
    })
  } catch (err) {
    return apiError(err, 'Failed to save the e-way bill number', 500)
  }
}
