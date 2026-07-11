import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

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

  const url = new URL(req.url)
  const shouldFix = url.searchParams.get('fix') === 'true'

  // Find ALL transactions that have line items
  const transactions = await db.transaction.findMany({
    where: {
      deletedAt: null,
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

  if (!shouldFix || inconsistent === 0) {
    return NextResponse.json({
      mode: shouldFix ? 'fix' : 'diagnose',
      totalScanned: transactions.length,
      consistent: transactions.length - inconsistent,
      inconsistent,
      totalDrift: Math.round(totalDrift * 100) / 100,
      inconsistentTransactions: results.slice(0, 50),
      message: inconsistent === 0
        ? '✅ All transactions are consistent. The GSTR-1 reconciliation mismatch is NOT a data issue.'
        : shouldFix
          ? 'No fix applied (dry run). Pass ?fix=true to repair.'
          : `Found ${inconsistent} inconsistent transactions. Add ?fix=true to repair.`,
    })
  }

  // === FIX MODE ===
  let fixed = 0
  const fixes: Array<{ id: string; invoiceNo: string | null; before: number; after: number }> = []

  for (const r of results) {
    const txn = transactions.find(t => t.id === r.id)
    if (!txn) continue

    let subtotal = 0
    let discountAmount = 0
    let cgst = 0
    let sgst = 0
    let igst = 0

    for (const item of txn.items) {
      const grossAmount = Math.round(item.quantity * item.unitPrice * 100) / 100
      subtotal = Math.round((subtotal + grossAmount) * 100) / 100
      discountAmount = Math.round((discountAmount + (item.discountAmount || 0)) * 100) / 100
      cgst = Math.round((cgst + (item.cgst || 0)) * 100) / 100
      sgst = Math.round((sgst + (item.sgst || 0)) * 100) / 100
      igst = Math.round((igst + (item.igst || 0)) * 100) / 100
    }

    const totalAmount = Math.round((subtotal - discountAmount + cgst + sgst + igst + (txn.roundOff || 0)) * 100) / 100

    await db.transaction.update({
      where: { id: r.id },
      data: { subtotal, discountAmount, cgst, sgst, igst, totalAmount },
    })

    fixed++
    fixes.push({
      id: r.id,
      invoiceNo: r.invoiceNo,
      before: r.headerTaxable,
      after: Math.round((subtotal - discountAmount) * 100) / 100,
    })
  }

  return NextResponse.json({
    mode: 'fix',
    totalScanned: transactions.length,
    inconsistent,
    fixed,
    totalDrift: Math.round(totalDrift * 100) / 100,
    fixes: fixes.slice(0, 50),
    message: `✅ Repaired ${fixed} transactions. GSTR-1 export should work now. Re-run the export to verify.`,
  })
}
