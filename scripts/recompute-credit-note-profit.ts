/**
 * V17 Audit §1 Backfill Script — Recompute grossProfit for existing credit notes.
 *
 * PROBLEM: Credit notes created BEFORE the Phase 1 fix have grossProfit=0
 * because computeLineItems only computed profit for type='sale'. The fix
 * (line-items.ts) now computes NEGATIVE profit for credit notes, but existing
 * rows in the DB still have the wrong value.
 *
 * This script:
 *   1. Finds all credit-note transactions with grossProfit = 0
 *   2. For each, recomputes grossProfit from its items using the same formula
 *      as computeLineItems: -(realizedUnitPrice - purchasePriceAtSale) × quantity
 *   3. Updates the transaction row with the correct (negative) grossProfit
 *
 * Usage:
 *   npx tsx scripts/recompute-credit-note-profit.ts
 *
 * Or via the existing migrate-with-retry pattern:
 *   npx tsx scripts/recompute-credit-note-profit.ts --dry-run  (preview only)
 *   npx tsx scripts/recompute-credit-note-profit.ts            (apply changes)
 *
 * This is a ONE-TIME backfill. After running it, all credit notes will have
 * correct negative grossProfit and the dashboard/P&L will show true net profit.
 */

import { PrismaClient } from '@prisma/client'
import { roundMoney } from '../src/lib/money'

const db = new PrismaClient()
const isDryRun = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`V17 Audit §1 Backfill: Recompute credit-note grossProfit`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'APPLY'}`)
  console.log(`${'='.repeat(70)}\n`)

  // Find all credit-note transactions with grossProfit = 0
  const creditNotes = await db.transaction.findMany({
    where: {
      type: 'credit-note',
      deletedAt: null,
      grossProfit: 0,
    },
    include: {
      items: true,
    },
  })

  console.log(`Found ${creditNotes.length} credit note(s) with grossProfit = 0\n`)

  if (creditNotes.length === 0) {
    console.log('✅ Nothing to backfill. All credit notes already have correct grossProfit.')
    return
  }

  let updated = 0
  let skipped = 0
  let totalProfitReversed = 0

  for (const cn of creditNotes) {
    // Recompute grossProfit from items
    // Formula (from line-items.ts): -(realizedUnitPrice - purchasePriceAtSale) × quantity
    // realizedUnitPrice = taxableAmount / quantity = (quantity × unitPrice - discountAmount) / quantity
    let recomputedProfit = 0
    let hasItemsWithProduct = false

    for (const item of cn.items) {
      if (!item.productId) continue // skip unlinked items (no purchasePrice)
      hasItemsWithProduct = true

      const grossAmount = roundMoney(item.quantity * item.unitPrice)
      const taxableAmount = roundMoney(grossAmount - (item.discountAmount || 0))
      const realizedUnitPrice = item.quantity > 0
        ? roundMoney(taxableAmount / item.quantity)
        : 0
      // purchasePriceAtSale is stored on the item at creation time
      const purchasePrice = item.purchasePriceAtSale || 0
      const itemProfit = roundMoney((realizedUnitPrice - purchasePrice) * item.quantity)
      recomputedProfit = roundMoney(recomputedProfit - itemProfit) // NEGATE (credit note reverses)
    }

    if (!hasItemsWithProduct) {
      console.log(`  ⏭️  ${cn.invoiceNo || cn.id}: no linked-product items, skipping (profit stays 0)`)
      skipped++
      continue
    }

    if (recomputedProfit === 0) {
      console.log(`  ⏭️  ${cn.invoiceNo || cn.id}: recomputed profit is 0 (item-level break-even), skipping`)
      skipped++
      continue
    }

    console.log(`  ${isDryRun ? '🔍' : '✏️'}  ${cn.invoiceNo || cn.id}: grossProfit 0 → ${recomputedProfit}`)

    if (!isDryRun) {
      await db.transaction.update({
        where: { id: cn.id },
        data: { grossProfit: recomputedProfit },
      })
    }

    updated++
    totalProfitReversed += Math.abs(recomputedProfit)
  }

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`Summary:`)
  console.log(`  Total credit notes found:  ${creditNotes.length}`)
  console.log(`  ${isDryRun ? 'Would update' : 'Updated'}:              ${updated}`)
  console.log(`  Skipped (no data):         ${skipped}`)
  console.log(`  Total profit reversed:     ₹${totalProfitReversed.toFixed(2)}`)
  if (isDryRun) {
    console.log(`\n  → Run without --dry-run to apply these changes.`)
  } else {
    console.log(`\n  ✅ Backfill complete. Dashboard/P&L will now show correct net profit.`)
  }
  console.log(`${'─'.repeat(70)}\n`)
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
