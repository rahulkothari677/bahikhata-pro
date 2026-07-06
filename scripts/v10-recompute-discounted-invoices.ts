/**
 * 🔒 V10 §2.1 ONE-TIME RECOMPUTE MIGRATION SCRIPT
 *
 * Run this ONCE after deploying the V10 fix. It re-applies the proportional
 * discount distribution to every existing discounted invoice so that:
 *   - per-item CGST/SGST/IGST are computed on the post-discount taxable
 *   - the transaction header totals match the per-item sums exactly
 *
 * WHY: every discounted invoice created BEFORE V10 overcharged GST (it was
 * computed on the pre-discount amount). The GST numbers stored on those
 * invoices are wrong, and any that were filed via GSTR-1 are technically
 * non-filable. This script recomputes them correctly so going forward the
 * stored values match the (now fixed) write-time formula.
 *
 * IF ANY WRONG INVOICES WERE ALREADY FILED WITH THE GST PORTAL:
 *   - DO NOT just recompute silently — the filed return now disagrees with
 *     the books. You'll need a CA-guided amendment (GSTR-1 amendment for
 *     the affected months).
 *   - This script logs every invoice it touches so you have a paper trail
 *     for the CA conversation. Run with DRY_RUN=true first to see the list.
 *
 * Usage:
 *   # Dry run — log what would change, don't write
 *   DRY_RUN=true npx tsx scripts/v10-recompute-discounted-invoices.ts
 *
 *   # Real run — recompute and write
 *   npx tsx scripts/v10-recompute-discounted-invoices.ts
 *
 *   # Real run, scoped to one user
 *   USER_ID=clxxxxxxx npx tsx scripts/v10-recompute-discounted-invoices.ts
 */

import { PrismaClient } from '@prisma/client'
import {
  roundMoney,
  calculateGst,
  splitGst,
  distributeDiscountProportionally,
  toMoney,
} from '../src/lib/money'

const db = new PrismaClient()

const DRY_RUN = process.env.DRY_RUN === 'true'
const USER_FILTER = process.env.USER_ID

async function main() {
  console.log('=== V10 §2.1 recompute script ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'REAL RUN (writes enabled)'}`)
  if (USER_FILTER) console.log(`Scoped to user: ${USER_FILTER}`)
  console.log('')

  // Find all transactions that have a non-zero order-level discount.
  // These are the ones the V10 bug affected. Income/expense have no items,
  // so we only look at sale/purchase.
  const where: any = {
    type: { in: ['sale', 'purchase'] },
    discountAmount: { gt: 0 },
    deletedAt: null,
  }
  if (USER_FILTER) where.userId = USER_FILTER

  const affected = await db.transaction.findMany({
    where,
    include: { items: true },
    orderBy: { date: 'asc' },
  })

  console.log(`Found ${affected.length} discounted transaction(s) to recompute.`)

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: list of affected transactions ---')
    for (const t of affected) {
      const oldGst = roundMoney(t.cgst + t.sgst + t.igst)
      console.log(`  ${t.invoiceNo || t.id} | ${t.type} | ${t.date.toISOString().slice(0,10)} | user=${t.userId} | old_gst=${oldGst} | old_total=${t.totalAmount}`)
    }
    console.log('\nNo changes written. Re-run without DRY_RUN=true to apply.')
    return
  }

  let recomputed = 0
  let skipped = 0
  for (const t of affected) {
    if (t.items.length === 0) {
      console.warn(`  SKIP ${t.id}: no items (orphan)`)
      skipped++
      continue
    }

    // Recompute per-item GST using the V10 formula
    const orderDiscount = toMoney(t.discountAmount)
    const grossAmounts = t.items.map(it =>
      roundMoney(toMoney(it.quantity) * toMoney(it.unitPrice)),
    )
    const perItemDiscounts = distributeDiscountProportionally(grossAmounts, orderDiscount)

    let cgst = 0, sgst = 0, igst = 0
    let subtotal = 0
    const itemUpdates: Array<{ id: string; discountAmount: number; cgst: number; sgst: number; igst: number; total: number }> = []

    for (let i = 0; i < t.items.length; i++) {
      const it = t.items[i]
      const gross = grossAmounts[i]
      const itemDiscount = roundMoney(perItemDiscounts[i])
      const taxable = roundMoney(gross - itemDiscount)
      const itemGst = calculateGst(taxable, it.gstRate)
      const itemTotal = roundMoney(taxable + itemGst)
      subtotal = roundMoney(subtotal + gross)

      let itemCgst = 0, itemSgst = 0, itemIgst = 0
      if (t.isInterState) {
        itemIgst = itemGst
        igst = roundMoney(igst + itemGst)
      } else {
        const split = splitGst(itemGst)
        itemCgst = split.cgst
        itemSgst = split.sgst
        cgst = roundMoney(cgst + split.cgst)
        sgst = roundMoney(sgst + split.sgst)
      }

      itemUpdates.push({
        id: it.id,
        discountAmount: itemDiscount,
        cgst: itemCgst,
        sgst: itemSgst,
        igst: itemIgst,
        total: itemTotal,
      })
    }

    const totalGst = roundMoney(cgst + sgst + igst)
    const totalAmount = roundMoney((subtotal - orderDiscount) + totalGst)

    // Recompute grossProfit on post-discount realized price (V10 §2.4).
    // We need product purchasePrice for this — but the snapshot is in
    // TransactionItem.purchasePriceAtSale, so we can use that.
    let grossProfit = 0
    for (let i = 0; i < t.items.length; i++) {
      const it = t.items[i]
      if (t.type !== 'sale') continue
      const taxable = roundMoney(grossAmounts[i] - perItemDiscounts[i])
      const realizedUnitPrice = roundMoney(taxable / toMoney(it.quantity))
      grossProfit = roundMoney(grossProfit + (realizedUnitPrice - it.purchasePriceAtSale) * toMoney(it.quantity))
    }

    const oldGst = roundMoney(t.cgst + t.sgst + t.igst)
    const gstDelta = roundMoney(totalGst - oldGst)

    console.log(
      `  ${t.invoiceNo || t.id} | ${t.type} | gst: ${oldGst} → ${totalGst} (Δ ${gstDelta > 0 ? '+' : ''}${gstDelta}) | total: ${t.totalAmount} → ${totalAmount}`,
    )

    // Atomically update the transaction + all its items
    await db.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: t.id },
        data: {
          subtotal: roundMoney(subtotal),
          cgst: roundMoney(cgst),
          sgst: roundMoney(sgst),
          igst: roundMoney(igst),
          totalAmount,
          grossProfit: roundMoney(grossProfit),
        },
      })
      for (const upd of itemUpdates) {
        await tx.transactionItem.update({
          where: { id: upd.id },
          data: {
            discountAmount: upd.discountAmount,
            cgst: upd.cgst,
            sgst: upd.sgst,
            igst: upd.igst,
            total: upd.total,
          },
        })
      }
    })

    recomputed++
  }

  console.log(`\nDone. Recomputed: ${recomputed}. Skipped: ${skipped}.`)

  if (recomputed > 0) {
    console.log('\n⚠️  IMPORTANT: If any of these invoices were already filed via')
    console.log('    GSTR-1, the filed return now disagrees with the books.')
    console.log('    Consult a CA about filing amendments for the affected months.')
    console.log('    The dry-run log above (or your version control) has the')
    console.log('    before/after values for the CA conversation.')
  }
}

main()
  .catch((err) => {
    console.error('Recompute failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
