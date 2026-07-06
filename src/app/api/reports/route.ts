import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { activeTransactionWhere } from '@/lib/query-helpers'

// ⏱️ Vercel serverless timeout — reports can aggregate thousands of
// transactions and generate large responses. Set explicit maxDuration.
// (Audit fix Phase 1.3)
export const maxDuration = 60

// 🔒 AUDIT FIX V6 SC1: Reports now use SQL aggregation instead of loading
// rows into JS. Was: `findMany` with `take: 5000` + `truncated` flag — at
// scale a busy shop or wide date range produced an under-reported GST/P&L
// that looked authoritative. The V6 auditor flagged this as a compliance
// risk: "a truncated tax number is a compliance risk if the UI doesn't
// hard-stop the user."
//
// Now: P&L and GST reports compute ALL totals via SQL aggregate queries
// (`db.transaction.aggregate`, `db.transaction.groupBy`, raw SQL `GROUP BY`).
// The DB returns only the computed sums — never the raw rows — so there is
// no row cap and no truncation. Memory is constant regardless of how many
// transactions are in the date range. This also makes reports faster.
//
// The `stock` and `party` report types still use `findMany` (bounded by
// product count / party count, which are always small per shop). They don't
// have the truncation problem.

// GET /api/reports?type=pl|gst|stock|party&from=&to=
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'pl'
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const now = new Date()
    // 🔒 V11 §2.1 FIX: Default "from" is start of THIS month in IST, not UTC.
    // Was: `new Date(now.getFullYear(), now.getMonth(), 1)` which uses server-
    // local time (UTC on Vercel). On the 1st of the month before 5:30 AM IST,
    // this gave "last month" instead of "this month." Now uses IST boundary.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
    const istWall = new Date(now.getTime() + IST_OFFSET_MS)
    const from = fromStr
      ? new Date(fromStr)
      : new Date(Date.UTC(istWall.getUTCFullYear(), istWall.getUTCMonth(), 1) - IST_OFFSET_MS)
    const to = toStr ? new Date(toStr) : now

    // =====================================================================
    // P&L REPORT — pure SQL aggregation (no row cap, no truncation)
    // 🔒 V11 §2.3: Parallelized 3 sequential queries into 1 Promise.all.
    // Was: kpiAgg (await) → expensesByCatAgg (await) → incomeByCatAgg (await)
    // = 3 sequential DB round-trips. On a cold Neon connection each is 1-2s,
    // so 3-6s total. Now: 1 parallel batch = ~max(slowest query) = ~1-2s.
    // =====================================================================
    if (type === 'pl') {
      // All 3 aggregates are independent (different groupBy columns / filters),
      // so they can run in parallel.
      const [kpiAgg, expensesByCatAgg, incomeByCatAgg] = await Promise.all([
        // Single groupBy over all transaction types in the date range.
        // Returns one row per type with sum + count. O(1) memory (4 rows max).
        db.transaction.groupBy({
          by: ['type'],
          where: activeTransactionWhere(userId, { date: { gte: from, lte: to } }),
          _sum: { totalAmount: true, grossProfit: true, subtotal: true, discountAmount: true },
          _count: true,
        }),
        // Expenses by category
        db.transaction.groupBy({
          by: ['category'],
          where: activeTransactionWhere(userId, {
            type: 'expense',
            date: { gte: from, lte: to },
          }),
          _sum: { totalAmount: true },
        }),
        // Income by category
        db.transaction.groupBy({
          by: ['category'],
          where: activeTransactionWhere(userId, {
            type: 'income',
            date: { gte: from, lte: to },
          }),
          _sum: { totalAmount: true },
        }),
      ])

      const sumOf = (t: string) => kpiAgg.filter(r => r.type === t).reduce((s, r) => s + (r._sum.totalAmount || 0), 0)
      const profitOf = (t: string) => kpiAgg.filter(r => r.type === t).reduce((s, r) => s + (r._sum.grossProfit || 0), 0)
      const countOf = (t: string) => kpiAgg.filter(r => r.type === t).reduce((s, r) => s + r._count, 0)
      const taxableOf = (t: string) => kpiAgg.filter(r => r.type === t).reduce((s, r) => s + ((r._sum.subtotal || 0) - (r._sum.discountAmount || 0)), 0)

      const grossProfit = roundMoney(profitOf('sale'))
      const totalRevenue = roundMoney(taxableOf('sale'))
      const totalExpenses = roundMoney(sumOf('expense'))
      const otherIncome = roundMoney(sumOf('income'))
      const netProfit = roundMoney(grossProfit + otherIncome - totalExpenses)
      const purchaseTotal = roundMoney(sumOf('purchase'))

      const expensesByCategory = expensesByCatAgg
        .map(r => ({ name: r.category || 'Other', value: roundMoney(r._sum.totalAmount || 0) }))
        .sort((a, b) => b.value - a.value)

      const incomeByCategory = incomeByCatAgg
        .map(r => ({ name: r.category || 'Other', value: roundMoney(r._sum.totalAmount || 0) }))
        .sort((a, b) => b.value - a.value)

      return NextResponse.json({
        type: 'pl',
        period: { from, to },
        truncated: false,  // 🔒 V6 SC1: never truncated — SQL aggregation has no row cap
        summary: {
          totalRevenue,
          grossProfit,
          totalExpenses,
          otherIncome,
          netProfit,
          profitMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
        },
        expensesByCategory,
        incomeByCategory,
        salesCount: countOf('sale'),
        purchaseTotal,
      })
    }

    // =====================================================================
    // GST REPORT — pure SQL aggregation (no row cap, no truncation)
    // 🔒 V11 §2.3: Parallelized 6 queries (4 aggregates + 2 slab queries)
    // into 1 Promise.all. Was: Promise.all(4) → await slabRows → await
    // inputSlabRows = 3 sequential round-trips. Now: 1 parallel batch.
    // =====================================================================
    if (type === 'gst') {
      // All 6 queries are independent (different filters / tables), so they
      // can all run in parallel.
      const [saleGstAgg, purchaseGstAgg, saleCountAgg, purchaseCountAgg, slabRows, inputSlabRows] = await Promise.all([
        // 1. Sale GST totals
        db.transaction.aggregate({
          where: activeTransactionWhere(userId, {
            type: 'sale',
            date: { gte: from, lte: to },
          }),
          _sum: {
            subtotal: true,
            discountAmount: true,
            cgst: true,
            sgst: true,
            igst: true,
          },
          _count: true,
        }),
        // 2. Purchase GST totals
        db.transaction.aggregate({
          where: activeTransactionWhere(userId, {
            type: 'purchase',
            date: { gte: from, lte: to },
          }),
          _sum: {
            subtotal: true,
            cgst: true,
            sgst: true,
            igst: true,
          },
          _count: true,
        }),
        // 3. Sale count
        db.transaction.count({
          where: activeTransactionWhere(userId, {
            type: 'sale',
            date: { gte: from, lte: to },
          }),
        }),
        // 4. Purchase count
        db.transaction.count({
          where: activeTransactionWhere(userId, {
            type: 'purchase',
            date: { gte: from, lte: to },
          }),
        }),
        // 5. Sale slab breakdown — 🔒 V10 §2.2: aggregate STORED per-item CGST/SGST/IGST
        // (single source of truth). Was: recompute GST in SQL with
        // `ROUND(taxable × rate / 100)` — different rounding path from write-time
        // splitGst() → for odd-paise GST, stored (cgst=4.51, sgst=4.50) disagreed
        // with recomputed (cgst=4.51, sgst=4.51) → CA reconciliation fails.
        // Now: every read path aggregates the stored per-item values, so the
        // slab breakdown, the header outputTax, the GSTR per-invoice, and the
        // dashboard are byte-identical to the values stored at write time.
        db.$queryRaw<Array<{
          gstRate: number;
          isInterState: boolean;
          taxable: number;
          cgst: number;
          sgst: number;
          igst: number;
          quantity: number;
        }>>`
          SELECT
            ti."gstRate",
            t."isInterState",
            SUM(ROUND((ti."quantity"::numeric * ti."unitPrice" - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 2)) AS taxable,
            SUM(COALESCE(ti."cgst", 0)::numeric) AS cgst,
            SUM(COALESCE(ti."sgst", 0)::numeric) AS sgst,
            SUM(COALESCE(ti."igst", 0)::numeric) AS igst,
            SUM(ti."quantity") AS quantity
          FROM "TransactionItem" ti
          JOIN "Transaction" t ON ti."transactionId" = t.id
          WHERE t."userId" = ${userId}
            AND t."deletedAt" IS NULL
            AND t."type" = 'sale'
            AND t."date" >= ${from}
            AND t."date" <= ${to}
          GROUP BY ti."gstRate", t."isInterState"
          ORDER BY ti."gstRate" ASC
        `,
        // 6. Input slab breakdown (purchases) — 🔒 V10 §2.2: aggregate STORED per-item values
        db.$queryRaw<Array<{
          gstRate: number;
          taxable: number;
          cgst: number;
          sgst: number;
          igst: number;
        }>>`
          SELECT
            ti."gstRate",
            SUM(ROUND((ti."quantity"::numeric * ti."unitPrice" - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 2)) AS taxable,
            SUM(COALESCE(ti."cgst", 0)::numeric) AS cgst,
            SUM(COALESCE(ti."sgst", 0)::numeric) AS sgst,
            SUM(COALESCE(ti."igst", 0)::numeric) AS igst
          FROM "TransactionItem" ti
          JOIN "Transaction" t ON ti."transactionId" = t.id
          WHERE t."userId" = ${userId}
            AND t."deletedAt" IS NULL
            AND t."type" = 'purchase'
            AND t."date" >= ${from}
            AND t."date" <= ${to}
          GROUP BY ti."gstRate"
          ORDER BY ti."gstRate" ASC
        `,
      ])

      const outputTax = roundMoney(
        (saleGstAgg._sum.cgst || 0) + (saleGstAgg._sum.sgst || 0) + (saleGstAgg._sum.igst || 0)
      )
      const inputTax = roundMoney(
        (purchaseGstAgg._sum.cgst || 0) + (purchaseGstAgg._sum.sgst || 0) + (purchaseGstAgg._sum.igst || 0)
      )

      // Build slab map (combine intra+inter state rows for the same rate)
      const slabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number; quantity: number }>()
      for (const row of slabRows) {
        const rate = Number(row.gstRate)
        const existing = slabMap.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, quantity: 0 }
        existing.taxable = roundMoney(existing.taxable + Number(row.taxable))
        existing.cgst = roundMoney(existing.cgst + Number(row.cgst))
        existing.sgst = roundMoney(existing.sgst + Number(row.sgst))
        existing.igst = roundMoney(existing.igst + Number(row.igst))
        existing.quantity += Number(row.quantity)
        slabMap.set(rate, existing)
      }

      const inputSlabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()
      for (const row of inputSlabRows) {
        const rate = Number(row.gstRate)
        const existing = inputSlabMap.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
        existing.taxable = roundMoney(existing.taxable + Number(row.taxable))
        existing.cgst = roundMoney(existing.cgst + Number(row.cgst))
        existing.sgst = roundMoney(existing.sgst + Number(row.sgst))
        existing.igst = roundMoney(existing.igst + Number(row.igst))
        inputSlabMap.set(rate, existing)
      }

      return NextResponse.json({
        type: 'gst',
        period: { from, to },
        truncated: false,  // 🔒 V6 SC1: never truncated
        outputSales: {
          taxableValue: roundMoney((saleGstAgg._sum.subtotal || 0) - (saleGstAgg._sum.discountAmount || 0)),
          outputTax,
          bySlab: Array.from(slabMap.entries()).map(([rate, v]) => ({ rate, ...v })),
        },
        inputPurchases: {
          taxableValue: roundMoney(purchaseGstAgg._sum.subtotal || 0),
          inputTax,
          bySlab: Array.from(inputSlabMap.entries()).map(([rate, v]) => ({ rate, ...v })),
        },
        netGSTPayable: roundMoney(outputTax - inputTax),
        totalInvoices: saleCountAgg,
        totalPurchaseBills: purchaseCountAgg,
      })
    }

    // =====================================================================
    // STOCK REPORT — reads currentStock column (V3 N2), no row cap needed
    // =====================================================================
    if (type === 'stock') {
      const products = await db.product.findMany({ where: { userId } })

      const stockReport = products.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        hsn: p.hsn,
        unit: p.unit,
        currentStock: p.currentStock,
        purchasePrice: p.purchasePrice,
        salePrice: p.salePrice,
        mrp: p.mrp,
        gstRate: p.gstRate,
        stockValue: roundMoney(p.currentStock * p.purchasePrice),
        potentialSaleValue: roundMoney(p.currentStock * p.salePrice),
        isLowStock: p.currentStock <= p.lowStockThreshold,
      }))

      const totalStockValue = roundMoney(stockReport.reduce((s, p) => s + p.stockValue, 0))
      const totalPotentialValue = roundMoney(stockReport.reduce((s, p) => s + p.potentialSaleValue, 0))

      return NextResponse.json({
        type: 'stock',
        period: { from, to },
        truncated: false,
        products: stockReport.sort((a, b) => b.stockValue - a.stockValue),
        totalStockValue,
        totalPotentialValue,
        potentialProfit: roundMoney(totalPotentialValue - totalStockValue),
        lowStockCount: stockReport.filter(p => p.isLowStock).length,
      })
    }

    // =====================================================================
    // PARTY REPORT — bounded by party count (always small per shop)
    // 🔒 V7 M3: Balance is now CUMULATIVE (all-time), not range-only.
    // Was: balance computed from date-filtered transactions → selecting
    // "This Month" excluded last month's unpaid invoices from the balance.
    // The party detail page (correct) showed all-time balance, so the two
    // screens disagreed. Now: balance uses all-time aggregates (no date
    // filter), activity columns (totalSales, totalPurchases) stay date-
    // filtered for the period summary.
    // =====================================================================
    if (type === 'party') {
      // 🔒 V11 §2.3: Parallelized parties findMany with the 2 groupBy queries.
      // Was: parties (await) → Promise.all([periodPartyAgg, allTimePartyAgg])
      // = 2 sequential round-trips. Now: 1 parallel batch of 3 queries.
      // (The groupBy queries don't depend on the parties list — they filter
      // by userId directly, not by party IDs.)
      const [parties, periodPartyAgg, allTimePartyAgg] = await Promise.all([
        db.party.findMany({ where: { userId, deletedAt: null } }),
        // 1. Period activity (date-filtered) — for totalSales/totalPurchases columns
        db.transaction.groupBy({
          by: ['partyId', 'type'],
          where: activeTransactionWhere(userId, {
            partyId: { not: null },
            date: { gte: from, lte: to },
          }),
          _sum: { totalAmount: true, paidAmount: true },
          _count: true,
        }),
        // 2. 🔒 V7 M3: All-time aggregates for the correct cumulative balance
        db.transaction.groupBy({
          by: ['partyId', 'type'],
          where: activeTransactionWhere(userId, {
            partyId: { not: null },
          }),
          _sum: { totalAmount: true, paidAmount: true },
        }),
      ])

      const partyMap = new Map<string, {
        party: any;
        transactions: any[];
        balance: number;           // cumulative (all-time)
        periodActivity: number;    // net activity in the selected period
        totalSales: number;        // period sales
        totalPurchases: number;    // period purchases
        totalPaid: number;         // period paid
        totalReceived: number;     // period received
      }>()

      parties.forEach(p => {
        partyMap.set(p.id, {
          party: p,
          transactions: [],
          balance: p.openingBalance,  // start with opening; all-time agg adds to this
          periodActivity: 0,
          totalSales: 0,
          totalPurchases: 0,
          totalPaid: 0,
          totalReceived: 0,
        })
      })

      // Apply ALL-TIME aggregates → cumulative balance
      for (const row of allTimePartyAgg) {
        if (!row.partyId) continue
        const entry = partyMap.get(row.partyId)
        if (!entry) continue
        const totalAmount = row._sum.totalAmount || 0
        const paidAmount = row._sum.paidAmount || 0
        if (row.type === 'sale') {
          entry.balance = roundMoney(entry.balance + (totalAmount - paidAmount))
        } else if (row.type === 'purchase') {
          entry.balance = roundMoney(entry.balance - (totalAmount - paidAmount))
        }
      }

      // Apply PERIOD aggregates → activity columns
      for (const row of periodPartyAgg) {
        if (!row.partyId) continue
        const entry = partyMap.get(row.partyId)
        if (!entry) continue
        const totalAmount = row._sum.totalAmount || 0
        const paidAmount = row._sum.paidAmount || 0
        if (row.type === 'sale') {
          entry.totalSales = roundMoney(entry.totalSales + totalAmount)
          entry.periodActivity = roundMoney(entry.periodActivity + (totalAmount - paidAmount))
          entry.totalReceived = roundMoney(entry.totalReceived + paidAmount)
        } else if (row.type === 'purchase') {
          entry.totalPurchases = roundMoney(entry.totalPurchases + totalAmount)
          entry.periodActivity = roundMoney(entry.periodActivity - (totalAmount - paidAmount))
          entry.totalPaid = roundMoney(entry.totalPaid + paidAmount)
        }
      }

      return NextResponse.json({
        type: 'party',
        period: { from, to },
        truncated: false,
        // 🔒 V7 M3: balance is now cumulative (matches party detail page).
        // periodActivity is the net change in the selected period.
        parties: Array.from(partyMap.values())
          .filter(p => p.totalSales > 0 || p.totalPurchases > 0 || p.party.openingBalance !== 0 || p.balance !== 0)
          .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
      })
    }

    return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
  } catch (error) {
    // 🔒 V11 FIX: Log the actual error with context so we can debug. Was:
    // just 'Reports error:' + generic 500. Now: includes the report type
    // and date range so the founder can reproduce.
    const url = new URL(req.url)
    console.error('Reports error:', {
      type: url.searchParams.get('type'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { error: 'Failed to generate report. The database might be warming up — please try again.' },
      { status: 500 },
    )
  }
}
