import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireFounder, isRepairAllowed } from '@/lib/debug-auth'
import { apiError } from '@/lib/api-error'

/**
 * 🔍 GSTR-1 Reconciliation Diagnostic + Repair endpoint.
 *
 * GET /api/debug/repair-headers?userId=<id>
 *   → diagnose only (no changes). Reports transactions where header totals
 *     don't match line-item sums.
 *
 * POST /api/debug/repair-headers
 *   Body: { userId: string, transactionIds: string[] }
 *   → repairs the specified transactions by recomputing header columns
 *     (subtotal, discountAmount, cgst, sgst, igst, totalAmount) from line
 *     items. Does NOT touch line items or any other fields.
 *
 * 🔒 INTEGRATION PHASE D.2 (2026-07-25): This route was MOVED from
 * /api/admin/repair-headers. The old location used `requireAdmin()` from
 * `src/lib/admin-auth.ts` (a hardcoded 2-email allowlist with no 2FA, no
 * audit trail). The new location uses `requireFounder()` from
 * `src/lib/debug-auth.ts` which:
 *   1. Checks the FOUNDER_EMAILS env var (flexible, not hardcoded)
 *   2. Uses the main app's auth context (getAuthContext)
 *   3. For repair endpoints, additionally requires ALLOW_REPAIR_ENDPOINTS=true
 *      in production (defense-in-depth — repairs are inert unless explicitly
 *      enabled)
 * This is a SECURITY UPGRADE, not just a lateral move. The old /api/admin/
 * namespace has been deleted entirely; all admin functionality lives in the
 * separate bahikhata-admin app.
 *
 * 🔒 AUDITOR FIX 2026-07-22 (preserved from the original route): This route
 * used to WRITE from a GET when called with `?fix=true`. A GET must never
 * mutate — browsers, link previews and prefetchers issue GETs on their own,
 * and CSRF defences do not cover them. The repair now lives in POST below.
 *
 * 🔒 AUDITOR FIX 2026-07-22 (preserved): The GET query had NO userId filter,
 * so an admin running it scanned every shopkeeper's transactions. A userId
 * is now required.
 *
 * See: download/Integration-Plan-BahiKhata-Pro-Admin.md (Phase D.2, B.3)
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const founderCheck = await requireFounder()
  if ('error' in founderCheck) return founderCheck.error
  // Note: userId from founderCheck is the admin's own userId, not the target.
  // The target userId comes from the query string.

  const url = new URL(req.url)
  const targetUserId = url.searchParams.get('userId')

  if (!targetUserId) {
    return NextResponse.json({
      error: 'userId query parameter is required',
      message: 'Pass ?userId=<id> to scope the diagnostic to one shop. Cross-user scans are not allowed.',
    }, { status: 400 })
  }

  // Find ALL transactions that have line items, scoped to the target user.
  const transactions = await db.transaction.findMany({
    where: {
      deletedAt: null,
      userId: targetUserId,
      type: { in: ['sale', 'purchase', 'credit-note', 'debit-note'] },
    },
    include: { items: true },
    orderBy: { date: 'desc' },
  })

  const results: Array<{
    id: string
    type: string
    invoiceNo: string | null
    date: string
    items: number
    headerTaxable: number
    itemsTaxable: number
    drift: number
  }> = []

  let inconsistent = 0
  let totalDrift = 0

  for (const txn of transactions) {
    if (txn.items.length === 0) continue

    // Compute what the header SHOULD be from line items
    let computedSubtotal = 0
    let computedDiscount = 0

    for (const item of txn.items) {
      const grossAmount = Math.round(item.quantity * item.unitPrice * 100) / 100
      computedSubtotal = Math.round((computedSubtotal + grossAmount) * 100) / 100
      computedDiscount = Math.round((computedDiscount + (item.discountAmount || 0)) * 100) / 100
    }

    const headerTaxable = Math.round((txn.subtotal - txn.discountAmount) * 100) / 100
    const itemsTaxable = Math.round((computedSubtotal - computedDiscount) * 100) / 100
    const drift = Math.round((itemsTaxable - headerTaxable) * 100) / 100

    if (Math.abs(drift) >= 0.01) {
      inconsistent++
      totalDrift += drift
      results.push({
        id: txn.id,
        type: txn.type,
        invoiceNo: txn.invoiceNo,
        date: txn.date.toISOString().split('T')[0],
        items: txn.items.length,
        headerTaxable,
        itemsTaxable,
        drift,
      })
    }
  }

  return NextResponse.json({
    mode: 'diagnose',
    scopedToUserId: targetUserId,
    totalScanned: transactions.length,
    consistent: transactions.length - inconsistent,
    inconsistent,
    totalDrift: Math.round(totalDrift * 100) / 100,
    inconsistentTransactions: results.slice(0, 50),
    message: inconsistent === 0
      ? '✅ All transactions are consistent. The GSTR-1 reconciliation mismatch is NOT a data issue.'
      : `Found ${inconsistent} inconsistent transactions. To repair, POST to this route with { userId, transactionIds: [...] } — taken from inconsistentTransactions above.`,
  })
}

/**
 * POST /api/debug/repair-headers
 *
 * The repair. Separated from GET on 2026-07-22 for two reasons, both of which
 * had already gone wrong here:
 *
 *   1. A GET must never write. The previous version repaired money when called
 *      with `?fix=true`, so a prefetch or a bookmarked URL could silently
 *      rewrite invoice totals.
 *   2. It ran across EVERY user with no userId filter. An admin repairing one
 *      shop's headers rewrote every shop's.
 *
 * This route therefore repairs BY EXPLICIT ID, for ONE user, which is the same
 * protocol the payment repair endpoint follows: never a heuristic sweep, since
 * a rule that looks safe in aggregate destroys legitimate rows.
 *
 * Body: { userId: string, transactionIds: string[] }
 *
 * 🔒 INTEGRATION PHASE D.2: Added isRepairAllowed() check — in production,
 * repairs are inert unless ALLOW_REPAIR_ENDPOINTS=true env var is set.
 */
export async function POST(req: NextRequest) {
  try {
    const founderCheck = await requireFounder()
    if ('error' in founderCheck) return founderCheck.error

    // 🔒 V26 S2: In production, repair endpoints must be explicitly enabled.
    if (!isRepairAllowed()) {
      return NextResponse.json({
        error: 'Repair endpoints are disabled',
        message: 'Set ALLOW_REPAIR_ENDPOINTS=true in production to enable transaction header repairs.',
      }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const userId: string | undefined = body?.userId
    const transactionIds: string[] = Array.isArray(body?.transactionIds) ? body.transactionIds : []

    if (!userId || transactionIds.length === 0) {
      return NextResponse.json({
        error: 'userId and a non-empty transactionIds array are required',
        message: 'Run GET /api/debug/repair-headers?userId=... first and pass the ids it reports.',
      }, { status: 400 })
    }

    // Scoped by BOTH the id list and the owner — an id from another shop
    // simply will not match.
    const transactions = await db.transaction.findMany({
      where: { id: { in: transactionIds }, userId, deletedAt: null },
      include: { items: true },
    })

    const fixes: Array<{ id: string; invoiceNo: string | null; before: number; after: number }> = []

    for (const txn of transactions) {
      let subtotal = 0
      let discountAmount = 0
      let cgst = 0
      let sgst = 0
      let igst = 0

      // The header is rebuilt by summing the stored line items — the same
      // relationship computeLineItems establishes when a bill is saved.
      for (const item of txn.items) {
        const grossAmount = Math.round(item.quantity * item.unitPrice * 100) / 100
        subtotal = Math.round((subtotal + grossAmount) * 100) / 100
        discountAmount = Math.round((discountAmount + (item.discountAmount || 0)) * 100) / 100
        cgst = Math.round((cgst + (item.cgst || 0)) * 100) / 100
        sgst = Math.round((sgst + (item.sgst || 0)) * 100) / 100
        igst = Math.round((igst + (item.igst || 0)) * 100) / 100
      }

      const totalAmount = Math.round((subtotal - discountAmount + cgst + sgst + igst + (txn.roundOff || 0)) * 100) / 100

      fixes.push({
        id: txn.id,
        invoiceNo: txn.invoiceNo,
        before: txn.totalAmount,
        after: totalAmount,
      })

      await db.transaction.update({
        where: { id: txn.id },
        data: { subtotal, discountAmount, cgst, sgst, igst, totalAmount },
      })
    }

    return NextResponse.json({
      mode: 'fix',
      userId,
      requested: transactionIds.length,
      matched: transactions.length,
      fixed: fixes.length,
      skipped: transactionIds.length - transactions.length,
      fixes: fixes.slice(0, 50),
      message: `Repaired ${fixes.length} of ${transactionIds.length} requested transactions for this user.`,
    })
  } catch (error) {
    return apiError(error, 'Failed to repair transaction headers', 500)
  }
}
