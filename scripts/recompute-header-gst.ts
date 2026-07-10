/**
 * 🔒 V17-Ext Reconciliation FIX: Backfill script — recompute header CGST/SGST/IGST
 * from per-item values on ALL existing transactions.
 *
 * ROOT CAUSE: The header CGST/SGST/IGST was accumulated independently during
 * line-item computation (roundMoney at each step), which can drift from the
 * Postgres SUM of per-item values by a few paise across many transactions.
 * The V10 fix made per-item GST the "single source of truth" — so the header
 * should be DERIVED from the items, not computed independently.
 *
 * This script sets Transaction.cgst/sgst/igst = SUM(TransactionItem.cgst/sgst/igst)
 * for every transaction. After running this, the reconciliation health check
 * will pass (SUM(headers) = SUM(items) by construction).
 *
 * Safe to run:
 *   - Only touches the header GST columns (cgst, sgst, igst)
 *   - Does NOT touch totalAmount, paidAmount, or any other field
 *   - Does NOT touch line items
 *   - Idempotent — running twice produces the same result
 *   - Works on both active and soft-deleted transactions (for consistency)
 *
 * Usage:
 *   DRY_RUN=true  npx tsx scripts/recompute-header-gst.ts   # preview only
 *   npx tsx scripts/recompute-header-gst.ts                   # apply
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const DRY_RUN = process.env.DRY_RUN === 'true'
  console.log(`[recompute-header-gst] ${DRY_RUN ? 'DRY RUN (no changes)' : 'APPLYING changes'}`)
  console.log('[recompute-header-gst] Recomputing Transaction.cgst/sgst/igst from per-item values...')

  // Get all transactions that have items (sale/purchase)
  const transactions = await prisma.transaction.findMany({
    where: { type: { in: ['sale', 'purchase'] } },
    select: {
      id: true,
      cgst: true,
      sgst: true,
      igst: true,
      items: {
        select: { cgst: true, sgst: true, igst: true },
      },
    },
  })

  console.log(`[recompute-header-gst] Found ${transactions.length} sale/purchase transactions.`)

  let changedCount = 0
  let totalCgstDiff = 0
  let totalSgstDiff = 0
  let totalIgstDiff = 0

  for (const txn of transactions) {
    // Compute the correct header values from items
    const correctCgst = Math.round(txn.items.reduce((s, i) => s + (i.cgst || 0), 0) * 100) / 100
    const correctSgst = Math.round(txn.items.reduce((s, i) => s + (i.sgst || 0), 0) * 100) / 100
    const correctIgst = Math.round(txn.items.reduce((s, i) => s + (i.igst || 0), 0) * 100) / 100

    const cgstDiff = Math.round((correctCgst - txn.cgst) * 100) / 100
    const sgstDiff = Math.round((correctSgst - txn.sgst) * 100) / 100
    const igstDiff = Math.round((correctIgst - txn.igst) * 100) / 100

    if (cgstDiff !== 0 || sgstDiff !== 0 || igstDiff !== 0) {
      changedCount++
      totalCgstDiff += cgstDiff
      totalSgstDiff += sgstDiff
      totalIgstDiff += igstDiff

      if (DRY_RUN && changedCount <= 10) {
        console.log(`  [DRY RUN] ${txn.id}: cgst ${txn.cgst}→${correctCgst} (Δ${cgstDiff}), sgst ${txn.sgst}→${correctSgst} (Δ${sgstDiff}), igst ${txn.igst}→${correctIgst} (Δ${igstDiff})`)
      }

      if (!DRY_RUN) {
        await prisma.transaction.update({
          where: { id: txn.id },
          data: {
            cgst: correctCgst,
            sgst: correctSgst,
            igst: correctIgst,
          },
        })
      }
    }
  }

  console.log(`\n[recompute-header-gst] Summary:`)
  console.log(`  Transactions checked: ${transactions.length}`)
  console.log(`  Transactions changed: ${changedCount}`)
  console.log(`  Total CGST drift fixed: ₹${totalCgstDiff.toFixed(2)}`)
  console.log(`  Total SGST drift fixed: ₹${totalSgstDiff.toFixed(2)}`)
  console.log(`  Total IGST drift fixed: ₹${totalIgstDiff.toFixed(2)}`)

  if (DRY_RUN && changedCount > 0) {
    console.log(`\n[recompute-header-gst] DRY RUN complete. Run without DRY_RUN=true to apply.`)
  } else if (!DRY_RUN) {
    console.log(`\n[recompute-header-gst] Done. Header GST values now match per-item sums exactly.`)
  } else {
    console.log(`\n[recompute-header-gst] No changes needed — all headers already match.`)
  }
}

main()
  .catch((e) => {
    console.error('[recompute-header-gst] Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
