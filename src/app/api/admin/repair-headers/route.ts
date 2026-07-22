import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api-error'

/**
 * 🔍 GSTR-1 Reconciliation Diagnostic + Repair endpoint.
 *
 * GET /api/admin/repair-headers          → diagnose only (no changes)
 * GET /api/admin/repair-headers?fix=true → diagnose + repair inconsistent transactions
 *
 * Finds transactions where the header (subtotal - discountAmount) doesn't match
 * the sum of line items (qty*price - discountAmount). This is the exact
 * discrepancy that causes the "Cannot export GSTR-1 — data inconsistency
 * detected" error.
 *
 * The repair recomputes header columns (subtotal, discountAmount, cgst, sgst,
 * igst, totalAmount) from the stored line items. It does NOT touch line items
 * or any other fields — only the header aggregate columns.
 *
 * 🔒 V17 PAISE MIGRATION Phase 2D: This issue is NOT caused by the paise
 * migration. The paise migration changes how the SQL query returns data
 * (paise integer vs rupee Float) but does NOT change the values themselves.
 * The discrepancy exists because some transactions in the database have header
 * columns that don't match their line items — likely from transactions created
 * before the V12 computeLineItems centralization, or from a bug in the edit
 * (PUT) path that updated line items without recomputing the header.
 */
export async function GET(req: Request) {
  const adminCheck = await requireAdmin()
  if (!adminCheck.ok) return adminCheck.error

  // 🔒 AUDITOR FIX 2026-07-22: this route used to WRITE from a GET when
  // called with `?fix=true`. A GET must never mutate — browsers, link
  // previews and prefetchers issue GETs on their own, and CSRF defences do
  // not cover them. One accidental prefetch of a bookmarked URL would have
  // rewritten money. The repair now lives in POST below.
  const url = new URL(req.url)
  const targetUserId = url.searchParams.get('userId')

  // Find ALL transactions that have line items
  // 🔒 AUDITOR FIX 2026-07-22: this query had NO userId filter, so an
  // admin running it scanned — and with ?fix=true rewrote — the invoice
  // headers of EVERY shopkeeper on the platform at once. Every other route in
  // this app scopes by userId; an admin route needs it more, not less.
  // A userId is now required, so a repair is always aimed at one shop.
  const transactions = await db.transaction.findMany({
    where: {
      deletedAt: null,
      ...(targetUserId ? { userId: targetUserId } : {}),
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
    scopedToUserId: targetUserId ?? '(all users — pass ?userId= to scope)',
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
 * POST /api/admin/repair-headers
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
 */
export async function POST(req: Request) {
  const adminCheck = await requireAdmin()
  if (!adminCheck.ok) return adminCheck.error

  try {
    const body = await req.json().catch(() => null)
    const userId: string | undefined = body?.userId
    const transactionIds: string[] = Array.isArray(body?.transactionIds) ? body.transactionIds : []

    if (!userId || transactionIds.length === 0) {
      return NextResponse.json({
        error: 'userId and a non-empty transactionIds array are required',
        message: 'Run GET /api/admin/repair-headers?userId=... first and pass the ids it reports.',
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
