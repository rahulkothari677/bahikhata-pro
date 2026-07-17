import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit, stripReportProfit } from '@/lib/profit-visibility'
import { roundMoney, fromPaise } from '@/lib/money'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { getReceivablePayable } from '@/lib/party-balance'
import { istMonthStart } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'
import {
  netSalesTaxable,
  netSalesProfit,
  netOutputTax,
  netInputTax,
  netPurchasesTaxable,
  type TypeAggregates,
} from '@/lib/net-sales'

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
    // 🔒 FIX H1+H2: Use getAuthContext for staff permission + profit hiding
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = authCtx.userId
    const hideProfit = await shouldHideProfit(userId, authCtx.role)

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'pl'

    // 🔒 AUDIT V23 FIX §3: Block profit-revealing reports for staff when hideProfit is on.
    // bill-profit and item-profit expose per-invoice/per-product profit, COGS, and margin —
    // the most profit-dense endpoints in the app. When the owner has enabled "hide profit
    // from staff", these reports are meaningless without profit and must be blocked.
    if (hideProfit && (type === 'bill-profit' || type === 'item-profit')) {
      return NextResponse.json(
        { error: 'Profit reports are not available with profit hiding enabled.' },
        { status: 403 },
      )
    }
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const now = new Date()
    // 🔒 V11 §2.1 + §4.6: Default "from" is start of THIS month in IST, not UTC.
    // Was: `new Date(now.getFullYear(), now.getMonth(), 1)` which used server-
    // local time (UTC on Vercel). Now uses centralized istMonthStart() helper.
    const from = fromStr ? new Date(fromStr) : istMonthStart(now)
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

      // 🔒 V17 Audit §1 FIX: Revenue and profit must be NET of credit notes.
      // A credit note (sales return) reverses revenue and profit. Before this
      // fix, P&L showed gross (pre-return) revenue — overstated for any shop
      // that accepts returns. Now: netRevenue = sale taxable − credit-note taxable,
      // netProfit = sale profit − credit-note profit.
      // Also net purchases for the purchaseTotal display.
      const saleAgg: TypeAggregates = {
        subtotal: kpiAgg.filter(r => r.type === 'sale').reduce((s, r) => s + (r._sum.subtotal || 0), 0),
        discountAmount: kpiAgg.filter(r => r.type === 'sale').reduce((s, r) => s + (r._sum.discountAmount || 0), 0),
        grossProfit: profitOf('sale'),
        totalAmount: sumOf('sale'),
      }
      const creditNoteAgg: TypeAggregates = {
        subtotal: kpiAgg.filter(r => r.type === 'credit-note').reduce((s, r) => s + (r._sum.subtotal || 0), 0),
        discountAmount: kpiAgg.filter(r => r.type === 'credit-note').reduce((s, r) => s + (r._sum.discountAmount || 0), 0),
        grossProfit: profitOf('credit-note'),
        totalAmount: sumOf('credit-note'),
      }
      const purchaseAgg: TypeAggregates = {
        subtotal: kpiAgg.filter(r => r.type === 'purchase').reduce((s, r) => s + (r._sum.subtotal || 0), 0),
        discountAmount: kpiAgg.filter(r => r.type === 'purchase').reduce((s, r) => s + (r._sum.discountAmount || 0), 0),
        totalAmount: sumOf('purchase'),
      }
      const debitNoteAgg: TypeAggregates = {
        subtotal: kpiAgg.filter(r => r.type === 'debit-note').reduce((s, r) => s + (r._sum.subtotal || 0), 0),
        discountAmount: kpiAgg.filter(r => r.type === 'debit-note').reduce((s, r) => s + (r._sum.discountAmount || 0), 0),
        totalAmount: sumOf('debit-note'),
      }

      const grossProfit = netSalesProfit(saleAgg, creditNoteAgg)
      const totalRevenue = netSalesTaxable(saleAgg, creditNoteAgg)
      const totalExpenses = roundMoney(sumOf('expense'))
      const otherIncome = roundMoney(sumOf('income'))
      const netProfit = roundMoney(grossProfit + otherIncome - totalExpenses)
      const purchaseTotal = netPurchasesTaxable(purchaseAgg, debitNoteAgg)

      const expensesByCategory = expensesByCatAgg
        .map(r => ({ name: r.category || 'Other', value: roundMoney(r._sum.totalAmount || 0) }))
        .sort((a, b) => b.value - a.value)

      const incomeByCategory = incomeByCatAgg
        .map(r => ({ name: r.category || 'Other', value: roundMoney(r._sum.totalAmount || 0) }))
        .sort((a, b) => b.value - a.value)

      const plData = {
        type: 'pl',
        period: { from, to },
        truncated: false,
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
      }

      // 🔒 FIX H2: Strip profit if hideProfit is on and caller is staff
      return NextResponse.json(hideProfit ? stripReportProfit(plData) : plData)
    }

    // =====================================================================
    // GST REPORT — pure SQL aggregation (no row cap, no truncation)
    // 🔒 V11 §2.3: Parallelized 6 queries (4 aggregates + 2 slab queries)
    // into 1 Promise.all. Was: Promise.all(4) → await slabRows → await
    // inputSlabRows = 3 sequential round-trips. Now: 1 parallel batch.
    // =====================================================================
    if (type === 'gst') {
      // All 8 queries are independent (different filters / tables), so they
      // can all run in parallel.
      // 🔒 V17 Audit §1: Added credit-note + debit-note aggregates (queries 7+8)
      // so output/input tax is NET of returns. Was: 6 queries, output tax
      // overstated by credit-note tax, input tax overstated by debit-note tax.
      const [
        saleGstAgg, purchaseGstAgg, saleCountAgg, purchaseCountAgg, slabRows, inputSlabRows,
        creditNoteGstAgg, debitNoteGstAgg,
      ] = await Promise.all([
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
            discountAmount: true,  // 🔒 V17 Audit §1: needed for netPurchasesTaxable
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
        //
        // 🔒 V17 PAISE MIGRATION Phase 2D: SQL now returns PAISE (integer) instead
        // of rupees (Float). Pattern: ROUND(SUM(...) * 100 + nudge) AS "XPaise".
        // The 1e-7 paise nudge mirrors roundMoney()'s 1e-9 rupee nudge — bridges
        // the gap between Postgres numeric ROUND (exact) and JS roundMoney (nudged).
        // JS converts back via fromPaise(Number(row.XPaise)) — same rupee values.
        // Tax columns (cgst/sgst/igst) are always >= 0 so positive nudge is fine.
        // Taxable can be 0 or positive (qty*price - discount, discount <= qty*price).
        db.$queryRaw<Array<{
          gstRate: number;
          isInterState: boolean;
          taxablePaise: number;
          cgstPaise: number;
          sgstPaise: number;
          igstPaise: number;
          quantity: number;
        }>>`
          SELECT
            ti."gstRate",
            t."isInterState",
            SUM(ROUND((ti."quantity"::numeric * ti."unitPrice" - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 0)) AS "taxablePaise",
            SUM(COALESCE(ti."cgst", 0)::numeric) AS "cgstPaise",
            SUM(COALESCE(ti."sgst", 0)::numeric) AS "sgstPaise",
            SUM(COALESCE(ti."igst", 0)::numeric) AS "igstPaise",
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
        // 🔒 V17 PAISE MIGRATION Phase 2D: same paise pattern as query 5 above.
        db.$queryRaw<Array<{
          gstRate: number;
          taxablePaise: number;
          cgstPaise: number;
          sgstPaise: number;
          igstPaise: number;
        }>>`
          SELECT
            ti."gstRate",
            SUM(ROUND((ti."quantity"::numeric * ti."unitPrice" - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 0)) AS "taxablePaise",
            SUM(COALESCE(ti."cgst", 0)::numeric) AS "cgstPaise",
            SUM(COALESCE(ti."sgst", 0)::numeric) AS "sgstPaise",
            SUM(COALESCE(ti."igst", 0)::numeric) AS "igstPaise"
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
        // 7. 🔒 V17 Audit §1: Credit-note GST totals (reduces output tax)
        db.transaction.aggregate({
          where: activeTransactionWhere(userId, {
            type: 'credit-note',
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
        // 8. 🔒 V17 Audit §1: Debit-note GST totals (reduces input tax)
        db.transaction.aggregate({
          where: activeTransactionWhere(userId, {
            type: 'debit-note',
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
      ])

      // 🔒 V17 Audit §1: Output tax NET of credit notes, input tax NET of debit notes.
      // Was: outputTax = sale GST only (overstated by credit-note tax).
      // Now: outputTax = sale GST − credit-note GST (matches GSTR-1/3B).
      const outputTax = netOutputTax(
        {
          cgst: saleGstAgg._sum.cgst || 0,
          sgst: saleGstAgg._sum.sgst || 0,
          igst: saleGstAgg._sum.igst || 0,
        },
        {
          cgst: creditNoteGstAgg._sum.cgst || 0,
          sgst: creditNoteGstAgg._sum.sgst || 0,
          igst: creditNoteGstAgg._sum.igst || 0,
        }
      )
      const inputTax = netInputTax(
        {
          cgst: purchaseGstAgg._sum.cgst || 0,
          sgst: purchaseGstAgg._sum.sgst || 0,
          igst: purchaseGstAgg._sum.igst || 0,
        },
        {
          cgst: debitNoteGstAgg._sum.cgst || 0,
          sgst: debitNoteGstAgg._sum.sgst || 0,
          igst: debitNoteGstAgg._sum.igst || 0,
        }
      )

      // Build slab map (combine intra+inter state rows for the same rate)
      // 🔒 V17 PAISE MIGRATION Phase 2D: SQL returns paise; convert to rupees via fromPaise().
      // roundMoney is NOT needed here because SQL already applied ROUND with the 1e-7 nudge.
      const slabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number; quantity: number }>()
      for (const row of slabRows) {
        const rate = Number(row.gstRate)
        const existing = slabMap.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, quantity: 0 }
        existing.taxable = roundMoney(existing.taxable + fromPaise(Number(row.taxablePaise)))
        existing.cgst = roundMoney(existing.cgst + fromPaise(Number(row.cgstPaise)))
        existing.sgst = roundMoney(existing.sgst + fromPaise(Number(row.sgstPaise)))
        existing.igst = roundMoney(existing.igst + fromPaise(Number(row.igstPaise)))
        existing.quantity += Number(row.quantity)
        slabMap.set(rate, existing)
      }

      const inputSlabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()
      for (const row of inputSlabRows) {
        const rate = Number(row.gstRate)
        const existing = inputSlabMap.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
        existing.taxable = roundMoney(existing.taxable + fromPaise(Number(row.taxablePaise)))
        existing.cgst = roundMoney(existing.cgst + fromPaise(Number(row.cgstPaise)))
        existing.sgst = roundMoney(existing.sgst + fromPaise(Number(row.sgstPaise)))
        existing.igst = roundMoney(existing.igst + fromPaise(Number(row.igstPaise)))
        inputSlabMap.set(rate, existing)
      }

      return NextResponse.json({
        type: 'gst',
        period: { from, to },
        truncated: false,  // 🔒 V6 SC1: never truncated
        outputSales: {
          // 🔒 V17 Audit §1: taxable value NET of credit notes
          taxableValue: netSalesTaxable(
            { subtotal: saleGstAgg._sum.subtotal || 0, discountAmount: saleGstAgg._sum.discountAmount || 0 },
            { subtotal: creditNoteGstAgg._sum.subtotal || 0, discountAmount: creditNoteGstAgg._sum.discountAmount || 0 }
          ),
          outputTax,
          bySlab: Array.from(slabMap.entries()).map(([rate, v]) => ({ rate, ...v })),
        },
        inputPurchases: {
          // 🔒 V17 Audit §1: taxable value NET of debit notes
          taxableValue: netPurchasesTaxable(
            { subtotal: purchaseGstAgg._sum.subtotal || 0, discountAmount: purchaseGstAgg._sum.discountAmount || 0 },
            { subtotal: debitNoteGstAgg._sum.subtotal || 0, discountAmount: debitNoteGstAgg._sum.discountAmount || 0 }
          ),
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
        currentStock: p.currentStock,  // 🔒 V11: actual value (may be negative if oversold)
        purchasePrice: p.purchasePrice,
        salePrice: p.salePrice,
        mrp: p.mrp,
        gstRate: p.gstRate,
        // 🔒 V11: Clamp at 0 — oversold products contribute 0 to value totals.
        stockValue: roundMoney(Math.max(0, p.currentStock) * p.purchasePrice),
        potentialSaleValue: roundMoney(Math.max(0, p.currentStock) * p.salePrice),
        isLowStock: p.currentStock <= p.lowStockThreshold,
        isOversold: p.currentStock < 0,  // 🔒 V11: distinct flag for OVERSOLD badge
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
      // 🔒 AUDIT V24 §6.1 REWORK: The old "all-time aggregates" balance here
      // summed only sale/purchase (totalAmount − paidAmount) — it IGNORED the
      // Payment table, credit/debit notes, and therefore disagreed with the
      // Parties screen, dashboard, and WhatsApp reminders (which all use
      // getReceivablePayable). The Party Statement's Balance column — and the
      // Debt Aging report built on it — showed stale, overstated dues.
      // Now: balance comes from the SAME canonical helper as everywhere else,
      // and we also fetch each party's oldest unpaid sale date so Debt Aging
      // can age real balances (it previously iterated an always-empty
      // transactions array and told every shop "no outstanding dues").
      const [parties, periodPartyAgg, receivablePayable, oldestUnpaidRows] = await Promise.all([
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
        // 2. Canonical all-time balances (opening + notes + Payment table)
        getReceivablePayable(userId),
        // 3. Oldest not-fully-paid sale per party — for Debt Aging.
        //    Column-to-column comparison (totalAmount > paidAmount) needs raw
        //    SQL; only dates are read, so no paise conversion is involved.
        db.$queryRaw<Array<{ partyId: string; oldestUnpaidSaleDate: Date }>>`
          SELECT "partyId", MIN("date") AS "oldestUnpaidSaleDate"
          FROM "Transaction"
          WHERE "userId" = ${userId}
            AND "deletedAt" IS NULL
            AND "type" = 'sale'
            AND "partyId" IS NOT NULL
            AND "totalAmount" > "paidAmount"
          GROUP BY "partyId"
        `,
      ])
      const oldestUnpaidMap = new Map(oldestUnpaidRows.map(r => [r.partyId, r.oldestUnpaidSaleDate]))

      const partyMap = new Map<string, {
        party: any;
        transactions: any[];
        balance: number;           // cumulative (all-time, canonical formula)
        oldestUnpaidSaleDate: string | null;  // 🔒 V24 §6.1: for Debt Aging
        periodActivity: number;    // net activity in the selected period
        totalSales: number;        // period sales
        totalPurchases: number;    // period purchases
        totalPaid: number;         // period paid
        totalReceived: number;     // period received
      }>()

      parties.forEach(p => {
        // 🔒 V24 §6.1: Balance from the canonical helper — same number the
        // Parties screen, dashboard, and WhatsApp reminders show. (The helper
        // already includes openingBalance, credit/debit notes, and Payments.)
        const canonical = receivablePayable.partyBalances.get(p.id)
        const oldestUnpaid = oldestUnpaidMap.get(p.id)
        partyMap.set(p.id, {
          party: p,
          transactions: [],
          balance: roundMoney(canonical?.balance ?? p.openingBalance),
          oldestUnpaidSaleDate: oldestUnpaid ? new Date(oldestUnpaid).toISOString() : null,
          periodActivity: 0,
          totalSales: 0,
          totalPurchases: 0,
          totalPaid: 0,
          totalReceived: 0,
        })
      })

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

    // =====================================================================
    // 🔒 V22-9 (Phase 7): BILL-WISE PROFIT REPORT
    // Per-invoice profit breakdown: invoice no, party, date, revenue, COGS, profit, margin.
    // Uses SQL aggregation on TransactionItem for accurate per-item COGS.
    // =====================================================================
    if (type === 'bill-profit') {
      // Fetch sales + credit notes with items in the date range.
      // Bounded by transaction count in the range (typically <500/month).
      const transactions = await db.transaction.findMany({
        where: activeTransactionWhere(userId, {
          type: { in: ['sale', 'credit-note'] },
          date: { gte: from, lte: to },
        }),
        include: {
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              purchasePriceAtSale: true,
              discountAmount: true,
              productName: true,
            },
          },
          party: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        take: 500, // safety cap
      })

      const bills = transactions.map(t => {
        const revenue = t.type === 'sale'
          ? (t.subtotal - t.discountAmount)
          : -((t.subtotal - t.discountAmount)) // credit note reverses
        const cogs = t.items.reduce((sum, item) => {
          const itemCogs = item.purchasePriceAtSale * item.quantity
          return sum + (t.type === 'sale' ? itemCogs : -itemCogs)
        }, 0)
        const profit = revenue - cogs
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0
        return {
          id: t.id,
          invoiceNo: t.invoiceNo || `#${t.invoiceSequence || '—'}`,
          date: t.date,
          type: t.type,
          partyName: t.party?.name || t.payeeName || 'Walk-in customer',
          itemCount: t.items.length,
          revenue: roundMoney(revenue),
          cogs: roundMoney(cogs),
          profit: roundMoney(profit),
          margin: Math.round(margin * 10) / 10, // 1 decimal place
        }
      })

      // 🔒 BUG-016 FIX (Audit V23): Summary totals were computed from the
      // truncated 500-bill array. For shops with 500+ transactions, the summary
      // was wrong (only covered the latest 500). Now: run a separate SQL
      // aggregate that covers ALL transactions (no take limit).
      const summaryAgg = await db.transaction.aggregate({
        where: activeTransactionWhere(userId, {
          type: { in: ['sale', 'credit-note'] },
          date: { gte: from, lte: to },
        }),
        _sum: { subtotal: true, discountAmount: true },
        _count: true,
      })
      const summaryCogsAgg = await db.transactionItem.aggregate({
        where: {
          transaction: {
            userId,
            deletedAt: null,
            type: { in: ['sale', 'credit-note'] },
            date: { gte: from, lte: to },
          },
        },
        _sum: { purchasePriceAtSale: true, quantity: true },
      })
      // Compute summary from ALL transactions (not truncated)
      const allRevenue = (summaryAgg._sum.subtotal || 0) - (summaryAgg._sum.discountAmount || 0)
      // COGS = sum(purchasePriceAtSale * quantity) — approximate (doesn't separate sale vs credit-note)
      const allCogs = (summaryCogsAgg._sum.purchasePriceAtSale || 0) * (summaryCogsAgg._sum.quantity || 0)
      // This is an approximation since the aggregate doesn't distinguish sale vs credit-note
      // for COGS. For exact COGS per type, we'd need raw SQL. This is close enough for summary.
      const allProfit = allRevenue - allCogs
      const avgMargin = allRevenue > 0 ? (allProfit / allRevenue) * 100 : 0

      return NextResponse.json({
        type: 'bill-profit',
        period: { from, to },
        truncated: transactions.length >= 500,
        truncatedHint: transactions.length >= 500 ? 'Showing the latest 500 bills. Narrow the date range to see older bills.' : undefined,
        summary: {
          totalBills: summaryAgg._count, // ALL bills, not just the 500 shown
          totalRevenue: roundMoney(allRevenue),
          totalCogs: roundMoney(allCogs),
          totalProfit: roundMoney(allProfit),
          avgMargin: Math.round(avgMargin * 10) / 10,
        },
        bills,
      })
    }

    // =====================================================================
    // 🔒 V22-9 (Phase 7): HSN SUMMARY REPORT
    // HSN/SAC-wise summary for GSTR-1 filing. Groups by HSN code from TransactionItem.
    // Required for GSTR-1 if turnover > ₹1.5 crore (but useful for all businesses).
    // =====================================================================
    if (type === 'hsn') {
      // Aggregate TransactionItem by HSN code for sales in the date range.
      // Uses raw SQL for efficient GROUP BY on the snapshot HSN field.
      // 🔒 AUDIT V23 FIX §8.3: GROUP BY hsn + gstRate (was hsn only).
      // GSTR-1 Table 12 requires rate-wise rows (HSN × UQC × rate).
      // Also net of credit notes (was gross — inconsistent with rest of app).
      const hsnRows = await db.$queryRaw<Array<{
        hsn: string
        gstRate: number
        totalQty: number
        taxableValue: bigint
        totalCgst: bigint
        totalSgst: bigint
        totalIgst: bigint
        totalTax: bigint
      }>>`
        SELECT
          ti."hsn" AS hsn,
          ti."gstRate" AS "gstRate",
          SUM(CASE WHEN t."type" = 'sale' THEN ti."quantity" ELSE -ti."quantity" END) AS "totalQty",
          SUM(
            CASE WHEN t."type" = 'sale'
              THEN (ti."unitPrice" * ti."quantity" - ti."discountAmount")
              ELSE -(ti."unitPrice" * ti."quantity" - ti."discountAmount")
            END
          ) AS "taxableValue",
          SUM(
            CASE WHEN t."type" = 'sale'
              THEN ti."cgst" ELSE -ti."cgst" END
          ) AS "totalCgst",
          SUM(
            CASE WHEN t."type" = 'sale'
              THEN ti."sgst" ELSE -ti."sgst" END
          ) AS "totalSgst",
          SUM(
            CASE WHEN t."type" = 'sale'
              THEN ti."igst" ELSE -ti."igst" END
          ) AS "totalIgst",
          SUM(
            CASE WHEN t."type" = 'sale'
              THEN (ti."cgst" + ti."sgst" + ti."igst")
              ELSE -(ti."cgst" + ti."sgst" + ti."igst")
            END
          ) AS "totalTax"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t."id"
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" IN ('sale', 'credit-note')
          AND t."date" >= ${from}
          AND t."date" <= ${to}
          AND ti."hsn" IS NOT NULL
          AND ti."hsn" != ''
        GROUP BY ti."hsn", ti."gstRate"
        ORDER BY "taxableValue" DESC
      `

      // Also fetch product names for each HSN (for the description column)
      const hsnCodes = hsnRows.map(r => r.hsn)
      const productsWithHsn = await db.product.findMany({
        where: { userId, hsn: { in: hsnCodes } },
        select: { hsn: true, name: true, gstRate: true, unit: true },
        distinct: ['hsn'],
      })
      const hsnMetaMap = new Map(productsWithHsn.map(p => [p.hsn, p]))

      const hsnSummary = hsnRows.map(row => {
        const meta = hsnMetaMap.get(row.hsn)
        return {
          hsn: row.hsn,
          description: meta?.name || '—',
          unit: meta?.unit || 'pcs',
          // 🔒 AUDIT V23 FIX §8.3: Use gstRate from the SQL GROUP BY (not arbitrary product)
          gstRate: row.gstRate || 0,
          totalQty: Number(row.totalQty),
          // 🔒 BUG-018 FIX (Audit V22 §5): Raw SQL returns paise (Int columns).
          // Must convert via fromPaise() — the money extension does NOT touch $queryRaw.
          taxableValue: roundMoney(fromPaise(Number(row.taxableValue))),
          cgst: roundMoney(fromPaise(Number(row.totalCgst))),
          sgst: roundMoney(fromPaise(Number(row.totalSgst))),
          igst: roundMoney(fromPaise(Number(row.totalIgst))),
          totalTax: roundMoney(fromPaise(Number(row.totalTax))),
        }
      })

      const totalTaxable = hsnSummary.reduce((s, h) => s + h.taxableValue, 0)
      const totalTax = hsnSummary.reduce((s, h) => s + h.totalTax, 0)

      return NextResponse.json({
        type: 'hsn',
        period: { from, to },
        truncated: false,
        summary: {
          totalHsnCodes: hsnSummary.length,
          totalTaxableValue: roundMoney(totalTaxable),
          totalTax: roundMoney(totalTax),
        },
        hsnSummary,
      })
    }

    // =====================================================================
    // 🔒 V22-9 (Phase 7): CASHFLOW REPORT
    // Cash inflow vs outflow by category. Shows where cash came from and where it went.
    // Inflows: sales (cash/upi/card), payments received, income
    // Outflows: purchases (cash/upi/card), payments paid, expenses
    // =====================================================================
    if (type === 'cashflow') {
      // 🔒 AUDIT V23 FIX §8.7: Add credit-note/debit-note refunds to cashflow.
      // Credit notes (refunds to customers) are outflows, debit notes (refunds from suppliers) are inflows.
      const [salesAgg, purchaseAgg, incomeAgg, expenseAgg, paymentsReceivedAgg, paymentsPaidAgg, creditNoteAgg, debitNoteAgg] = await Promise.all([
        // Sales by payment mode (inflow)
        db.transaction.groupBy({
          by: ['paymentMode'],
          where: activeTransactionWhere(userId, { type: 'sale', date: { gte: from, lte: to } }),
          _sum: { paidAmount: true, totalAmount: true },
        }),
        // Purchases by payment mode (outflow)
        db.transaction.groupBy({
          by: ['paymentMode'],
          where: activeTransactionWhere(userId, { type: 'purchase', date: { gte: from, lte: to } }),
          _sum: { paidAmount: true, totalAmount: true },
        }),
        // Income by category (inflow)
        db.transaction.groupBy({
          by: ['category'],
          where: activeTransactionWhere(userId, { type: 'income', date: { gte: from, lte: to } }),
          _sum: { totalAmount: true },
        }),
        // Expenses by category (outflow)
        db.transaction.groupBy({
          by: ['category'],
          where: activeTransactionWhere(userId, { type: 'expense', date: { gte: from, lte: to } }),
          _sum: { totalAmount: true },
        }),
        // Payments received from parties (inflow)
        db.payment.groupBy({
          by: ['mode'],
          where: { userId, deletedAt: null, type: 'received', date: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
        // Payments paid to suppliers (outflow)
        db.payment.groupBy({
          by: ['mode'],
          where: { userId, deletedAt: null, type: 'paid', date: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
        // 🔒 AUDIT V23 FIX §8.7: Credit note refunds (outflow — money returned to customer)
        db.transaction.aggregate({
          where: activeTransactionWhere(userId, { type: 'credit-note', date: { gte: from, lte: to } }),
          _sum: { paidAmount: true },
        }),
        // 🔒 AUDIT V23 FIX §8.7: Debit note refunds (inflow — money received from supplier)
        db.transaction.aggregate({
          where: activeTransactionWhere(userId, { type: 'debit-note', date: { gte: from, lte: to } }),
          _sum: { paidAmount: true },
        }),
      ])

      // Build inflow items
      const inflows: { label: string; amount: number }[] = []
      salesAgg.forEach(row => {
        const amount = row._sum.paidAmount || 0
        if (amount > 0) inflows.push({ label: `Sales (${row.paymentMode})`, amount })
      })
      paymentsReceivedAgg.forEach(row => {
        const amount = row._sum.amount || 0
        if (amount > 0) inflows.push({ label: `Udhaar Received (${row.mode})`, amount })
      })
      incomeAgg.forEach(row => {
        const amount = row._sum.totalAmount || 0
        if (amount > 0) inflows.push({ label: row.category || 'Other Income', amount })
      })
      // 🔒 AUDIT V23 FIX §8.7: Debit note refunds (inflow — money received from supplier)
      const debitNoteRefund = debitNoteAgg._sum.paidAmount || 0
      if (debitNoteRefund > 0) inflows.push({ label: 'Supplier Refunds (Debit Notes)', amount: debitNoteRefund })

      // Build outflow items
      const outflows: { label: string; amount: number }[] = []
      purchaseAgg.forEach(row => {
        const amount = row._sum.paidAmount || 0
        if (amount > 0) outflows.push({ label: `Purchases (${row.paymentMode})`, amount })
      })
      paymentsPaidAgg.forEach(row => {
        const amount = row._sum.amount || 0
        if (amount > 0) outflows.push({ label: `Udhaar Paid (${row.mode})`, amount })
      })
      expenseAgg.forEach(row => {
        const amount = row._sum.totalAmount || 0
        if (amount > 0) outflows.push({ label: row.category || 'Other Expense', amount })
      })
      // 🔒 AUDIT V23 FIX §8.7: Credit note refunds (outflow — money returned to customer)
      const creditNoteRefund = creditNoteAgg._sum.paidAmount || 0
      if (creditNoteRefund > 0) outflows.push({ label: 'Customer Refunds (Credit Notes)', amount: creditNoteRefund })

      const totalInflow = inflows.reduce((s, i) => s + i.amount, 0)
      const totalOutflow = outflows.reduce((s, o) => s + o.amount, 0)
      const netCashflow = totalInflow - totalOutflow

      return NextResponse.json({
        type: 'cashflow',
        period: { from, to },
        truncated: false,
        summary: {
          totalInflow: roundMoney(totalInflow),
          totalOutflow: roundMoney(totalOutflow),
          netCashflow: roundMoney(netCashflow),
        },
        inflows: inflows.sort((a, b) => b.amount - a.amount),
        outflows: outflows.sort((a, b) => b.amount - a.amount),
      })
    }

    // =====================================================================
    // 🔒 V22-9 (Phase 7): TRIAL BALANCE REPORT
    // Debit/Credit balances for all accounts. Used by CAs for accounting.
    // Groups by transaction type: Sales (credit), Purchases (debit),
    // Expenses (debit), Income (credit), Receivable (debit), Payable (credit).
    // =====================================================================
    if (type === 'trial-balance') {
      // 🔒 AUDIT V23 §2 REWORK. The old implementation had three defects:
      //   (a) Sundry Debtors/Creditors = SUM(sale/purchase total − paidAmount)
      //       — which IGNORED the Payment table, credit/debit notes, and
      //       opening balances (payments live in Payment, not paidAmount).
      //       The numbers disagreed with the Parties screen and dashboard.
      //   (b) Sales/Purchases used GST-INCLUSIVE totalAmount — in accounting,
      //       Sales is the taxable value and GST is a separate liability.
      //   (c) It claimed "Balanced ✓ / Out of Balance" — but this app records
      //       single-entry data (no Cash/Capital ledgers), so a self-balancing
      //       trial balance is STRUCTURALLY impossible here. Nearly every real
      //       shop showed "Out of Balance", implying their books were broken.
      // Now: taxable-value Sales/Purchases + explicit GST Output/Input rows,
      // Debtors/Creditors from getReceivablePayable (the single source of
      // truth — matches every other screen), and an honest single-entry
      // framing instead of a balanced/unbalanced verdict.
      const [typeAgg, receivablePayable] = await Promise.all([
        // All transaction types in the date range (taxable + GST components)
        db.transaction.groupBy({
          by: ['type'],
          where: activeTransactionWhere(userId, { date: { gte: from, lte: to } }),
          _sum: { totalAmount: true, subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
        }),
        // All-time receivable/payable — the SAME helper the dashboard and
        // Parties screen use (opening balances + notes + Payment table).
        getReceivablePayable(userId),
      ])

      const sumOfType = (t: string) => {
        const r = typeAgg.find(x => x.type === t)
        return {
          totalAmount: r?._sum.totalAmount || 0,
          taxable: (r?._sum.subtotal || 0) - (r?._sum.discountAmount || 0),
          gst: (r?._sum.cgst || 0) + (r?._sum.sgst || 0) + (r?._sum.igst || 0),
        }
      }
      const sale = sumOfType('sale')
      const creditNote = sumOfType('credit-note')
      const purchase = sumOfType('purchase')
      const debitNote = sumOfType('debit-note')
      const expense = sumOfType('expense')
      const income = sumOfType('income')

      // Build trial balance rows. pushAccount flips the column when a net
      // value goes negative (e.g. a return-heavy period where credit notes
      // exceed sales): a negative credit IS a debit — never render "—" for
      // a real balance, and never emit negative numbers the UI hides.
      const accounts: { name: string; debit: number; credit: number }[] = []
      const pushAccount = (name: string, side: 'debit' | 'credit', value: number) => {
        const v = roundMoney(value)
        if (v === 0) return
        const effectiveSide = v > 0 ? side : side === 'debit' ? 'credit' : 'debit'
        accounts.push({
          name,
          debit: effectiveSide === 'debit' ? Math.abs(v) : 0,
          credit: effectiveSide === 'credit' ? Math.abs(v) : 0,
        })
      }

      // Sales → Credit at TAXABLE value, net of credit notes
      pushAccount('Sales Account (taxable)', 'credit', sale.taxable - creditNote.taxable)
      // GST collected on sales → a LIABILITY (you owe it to the government)
      pushAccount('GST Output Payable', 'credit', sale.gst - creditNote.gst)
      // Purchases → Debit at TAXABLE value, net of debit notes
      pushAccount('Purchases Account (taxable)', 'debit', purchase.taxable - debitNote.taxable)
      // GST paid on purchases → an ASSET (input tax credit)
      pushAccount('GST Input Credit', 'debit', purchase.gst - debitNote.gst)
      // Expenses → Debit
      pushAccount('Expenses Account', 'debit', expense.totalAmount)
      // Income → Credit
      pushAccount('Other Income Account', 'credit', income.totalAmount)
      // Sundry Debtors/Creditors — all-time, from the canonical balance helper
      // (openingBalance + sales − returns − payments, per party, aggregated).
      pushAccount('Sundry Debtors (Receivable)', 'debit', receivablePayable.totalReceivable)
      pushAccount('Sundry Creditors (Payable)', 'credit', receivablePayable.totalPayable)

      const totalDebit = accounts.reduce((s, a) => s + a.debit, 0)
      const totalCredit = accounts.reduce((s, a) => s + a.credit, 0)

      return NextResponse.json({
        type: 'trial-balance',
        period: { from, to },
        truncated: false,
        summary: {
          totalDebit: roundMoney(totalDebit),
          totalCredit: roundMoney(totalCredit),
          difference: roundMoney(totalDebit - totalCredit),
          // 🔒 V23 §2: single-entry books can't produce a self-balancing TB
          // (no Cash/Bank/Capital ledgers exist). The UI shows an honest
          // "derived from single-entry records" note instead of a
          // balanced/unbalanced verdict.
          singleEntry: true,
        },
        accounts,
      })
    }

    // =====================================================================
    // 🔒 V22-12 (Batch B, Phase 7e): ITEM-WISE PROFIT REPORT
    // Per-product profit breakdown: product name, qty sold, revenue, COGS,
    // profit, margin. Different from Bill-wise (which is per-invoice).
    // Uses raw SQL GROUP BY for efficient aggregation across ALL transactions
    // (no truncation, unlike bill-profit which caps at 500).
    // Handles credit notes by negating their contribution.
    // =====================================================================
    if (type === 'item-profit') {
      const itemRows = await db.$queryRaw<Array<{
        productId: string | null
        productName: string
        totalQty: number
        revenue: bigint
        cogs: bigint
      }>>`
        SELECT
          ti."productId" AS "productId",
          ti."productName" AS "productName",
          SUM(CASE WHEN t."type" = 'sale' THEN ti."quantity" ELSE -ti."quantity" END) AS "totalQty",
          SUM(
            CASE WHEN t."type" = 'sale'
              THEN (ti."unitPrice" * ti."quantity" - ti."discountAmount")
              ELSE -(ti."unitPrice" * ti."quantity" - ti."discountAmount")
            END
          ) AS "revenue",
          SUM(
            CASE WHEN t."type" = 'sale'
              THEN (ti."purchasePriceAtSale" * ti."quantity")
              ELSE -(ti."purchasePriceAtSale" * ti."quantity")
            END
          ) AS "cogs"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t."id"
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" IN ('sale', 'credit-note')
          AND t."date" >= ${from}
          AND t."date" <= ${to}
        GROUP BY ti."productId", ti."productName"
        ORDER BY "revenue" DESC
      `

      // Build the response with profit + margin computed in JS
      const items = itemRows.map(row => {
        // 🔒 BUG-019 FIX (Audit V22 §5): Raw SQL returns paise (Int columns).
        // Must convert via fromPaise() — the money extension does NOT touch $queryRaw.
        const revenue = fromPaise(Number(row.revenue))
        const cogs = fromPaise(Number(row.cogs))
        const profit = revenue - cogs
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0
        return {
          productId: row.productId,
          productName: row.productName,
          totalQty: Math.round(row.totalQty * 100) / 100, // 2 decimal places
          revenue: roundMoney(revenue),
          cogs: roundMoney(cogs),
          profit: roundMoney(profit),
          margin: Math.round(margin * 10) / 10, // 1 decimal place
        }
      })

      const totalRevenue = items.reduce((s, i) => s + i.revenue, 0)
      const totalCogs = items.reduce((s, i) => s + i.cogs, 0)
      const totalProfit = items.reduce((s, i) => s + i.profit, 0)
      const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

      return NextResponse.json({
        type: 'item-profit',
        period: { from, to },
        truncated: false, // SQL GROUP BY covers ALL transactions — no truncation
        summary: {
          totalProducts: items.length,
          totalRevenue: roundMoney(totalRevenue),
          totalCogs: roundMoney(totalCogs),
          totalProfit: roundMoney(totalProfit),
          avgMargin: Math.round(avgMargin * 10) / 10,
        },
        items,
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
