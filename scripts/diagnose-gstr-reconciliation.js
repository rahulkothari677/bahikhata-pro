#!/usr/bin/env node
/**
 * 🔍 GSTR-1 Reconciliation Diagnostic Script
 *
 * Finds transactions where the header (subtotal - discountAmount) doesn't match
 * the sum of line items (qty*price - discountAmount). This is the exact
 * discrepancy that causes the "Cannot export GSTR-1 — data inconsistency
 * detected" error.
 *
 * Usage:
 *   node scripts/diagnose-gstr-reconciliation.js          # diagnose only
 *   node scripts/diagnose-gstr-reconciliation.js --fix    # diagnose + repair
 *
 * The --fix flag recomputes header columns (subtotal, discountAmount, cgst,
 * sgst, igst, totalAmount, grossProfit) from the stored line items.
 */

const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  const args = process.argv.slice(2)
  const shouldFix = args.includes('--fix')

  console.log('🔍 GSTR-1 Reconciliation Diagnostic')
  console.log('='.repeat(60))
  console.log()

  // Find ALL transactions that have line items (sale, purchase, credit-note, debit-note)
  // Skip income/expense (no items)
  const transactions = await db.transaction.findMany({
    where: {
      deletedAt: null,
      type: { in: ['sale', 'purchase', 'credit-note', 'debit-note'] },
    },
    include: {
      items: true,
    },
    orderBy: { date: 'desc' },
  })

  console.log(`Found ${transactions.length} active transactions with items.`)
  console.log()

  let inconsistent = 0
  let totalDrift = 0
  const inconsistentTransactions = []

  for (const txn of transactions) {
    if (txn.items.length === 0) continue

    // Compute what the header SHOULD be from line items
    let computedSubtotal = 0
    let computedDiscount = 0
    let computedCgst = 0
    let computedSgst = 0
    let computedIgst = 0
    let computedGrossProfit = 0

    for (const item of txn.items) {
      const grossAmount = Math.round(item.quantity * item.unitPrice * 100) / 100
      computedSubtotal = Math.round((computedSubtotal + grossAmount) * 100) / 100
      computedDiscount = Math.round((computedDiscount + (item.discountAmount || 0)) * 100) / 100
      computedCgst = Math.round((computedCgst + (item.cgst || 0)) * 100) / 100
      computedSgst = Math.round((computedSgst + (item.sgst || 0)) * 100) / 100
      computedIgst = Math.round((computedIgst + (item.igst || 0)) * 100) / 100
    }

    // Header taxable = subtotal - discountAmount
    const headerTaxable = Math.round((txn.subtotal - txn.discountAmount) * 100) / 100
    const itemsTaxable = Math.round((computedSubtotal - computedDiscount) * 100) / 100
    const taxableDrift = Math.round((itemsTaxable - headerTaxable) * 100) / 100

    const cgstDrift = Math.round((computedCgst - txn.cgst) * 100) / 100
    const sgstDrift = Math.round((computedSgst - txn.sgst) * 100) / 100
    const igstDrift = Math.round((computedIgst - txn.igst) * 100) / 100

    const isConsistent =
      Math.abs(taxableDrift) < 0.01 &&
      Math.abs(cgstDrift) < 0.01 &&
      Math.abs(sgstDrift) < 0.01 &&
      Math.abs(igstDrift) < 0.01

    if (!isConsistent) {
      inconsistent++
      totalDrift += taxableDrift
      inconsistentTransactions.push({
        id: txn.id,
        type: txn.type,
        invoiceNo: txn.invoiceNo,
        date: txn.date.toISOString().split('T')[0],
        partyId: txn.partyId,
        items: txn.items.length,
        header: {
          subtotal: txn.subtotal,
          discountAmount: txn.discountAmount,
          taxable: headerTaxable,
          cgst: txn.cgst,
          sgst: txn.sgst,
          igst: txn.igst,
        },
        computed: {
          subtotal: computedSubtotal,
          discountAmount: computedDiscount,
          taxable: itemsTaxable,
          cgst: computedCgst,
          sgst: computedSgst,
          igst: computedIgst,
        },
        drift: {
          taxable: taxableDrift,
          cgst: cgstDrift,
          sgst: sgstDrift,
          igst: igstDrift,
        },
      })
    }
  }

  console.log(`📊 Results:`)
  console.log(`  Total transactions scanned: ${transactions.length}`)
  console.log(`  Consistent:                  ${transactions.length - inconsistent}`)
  console.log(`  INCONSISTENT:                ${inconsistent}`)
  console.log(`  Total taxable drift:         ₹${totalDrift.toFixed(2)}`)
  console.log()

  if (inconsistent === 0) {
    console.log('✅ All transactions are consistent. The GSTR-1 reconciliation')
    console.log('   mismatch must be caused by something else (e.g., the per-invoice')
    console.log('   SQL query logic vs the Prisma aggregate logic).')
    return
  }

  // Show the top 20 most inconsistent transactions
  console.log(`📋 Top inconsistent transactions (showing first 20):`)
  console.log('-'.repeat(60))
  for (const t of inconsistentTransactions.slice(0, 20)) {
    console.log(`  ${t.type} | ${t.invoiceNo || t.id.slice(-8)} | ${t.date}`)
    console.log(`    Items: ${t.items}`)
    console.log(`    Header taxable: ₹${t.header.taxable.toFixed(2)} (subtotal=${t.header.subtotal.toFixed(2)}, discount=${t.header.discountAmount.toFixed(2)})`)
    console.log(`    Items taxable:  ₹${t.computed.taxable.toFixed(2)} (subtotal=${t.computed.subtotal.toFixed(2)}, discount=${t.computed.discountAmount.toFixed(2)})`)
    console.log(`    DRIFT: taxable=₹${t.drift.taxable.toFixed(2)}, cgst=₹${t.drift.cgst.toFixed(2)}, sgst=₹${t.drift.sgst.toFixed(2)}, igst=₹${t.drift.igst.toFixed(2)}`)
    console.log()
  }

  if (inconsistent > 20) {
    console.log(`  ... and ${inconsistent - 20} more.`)
    console.log()
  }

  if (!shouldFix) {
    console.log('💡 To repair these transactions, run:')
    console.log('   node scripts/diagnose-gstr-reconciliation.js --fix')
    console.log()
    console.log('   This will recompute header columns (subtotal, discountAmount,')
    console.log('   cgst, sgst, igst, totalAmount) from the stored line items.')
    return
  }

  // === FIX MODE ===
  console.log('🔧 REPAIRING inconsistent transactions...')
  console.log('-'.repeat(60))

  let fixed = 0
  for (const t of inconsistentTransactions) {
    const txn = transactions.find(tx => tx.id === t.id)
    if (!txn) continue

    // Recompute header from line items
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

    // totalAmount = (subtotal - discount) + cgst + sgst + igst + roundOff
    const totalAmount = Math.round((subtotal - discountAmount + cgst + sgst + igst + (txn.roundOff || 0)) * 100) / 100

    await db.transaction.update({
      where: { id: t.id },
      data: { subtotal, discountAmount, cgst, sgst, igst, totalAmount },
    })

    fixed++
    if (fixed <= 10) {
      console.log(`  ✅ Fixed ${t.type} ${t.invoiceNo || t.id.slice(-8)}: taxable ${t.header.taxable.toFixed(2)} → ${(subtotal - discountAmount).toFixed(2)}`)
    }
  }

  if (fixed > 10) {
    console.log(`  ... and ${fixed - 10} more.`)
  }

  console.log()
  console.log(`✅ Repaired ${fixed} transactions.`)
  console.log()
  console.log('🔍 Re-running diagnostic to verify...')
  console.log()

  // Re-verify
  const recheck = await db.transaction.findMany({
    where: {
      deletedAt: null,
      type: { in: ['sale', 'purchase', 'credit-note', 'debit-note'] },
      id: { in: inconsistentTransactions.map(t => t.id) },
    },
    include: { items: true },
  })

  let stillInconsistent = 0
  for (const txn of recheck) {
    let computedSubtotal = 0
    let computedDiscount = 0
    for (const item of txn.items) {
      computedSubtotal = Math.round((computedSubtotal + item.quantity * item.unitPrice) * 100) / 100
      computedDiscount = Math.round((computedDiscount + (item.discountAmount || 0)) * 100) / 100
    }
    const headerTaxable = Math.round((txn.subtotal - txn.discountAmount) * 100) / 100
    const itemsTaxable = Math.round((computedSubtotal - computedDiscount) * 100) / 100
    if (Math.abs(itemsTaxable - headerTaxable) >= 0.01) {
      stillInconsistent++
    }
  }

  if (stillInconsistent === 0) {
    console.log('✅ All previously-inconsistent transactions are now consistent.')
    console.log('   GSTR-1 export should work correctly now.')
  } else {
    console.log(`⚠️  ${stillInconsistent} transactions are still inconsistent after repair.`)
    console.log('   This may indicate a deeper data issue. Contact support.')
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
