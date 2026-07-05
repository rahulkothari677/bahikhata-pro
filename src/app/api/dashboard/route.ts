import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { roundMoney } from '@/lib/money'
import { getReceivablePayable } from '@/lib/party-balance'

// ⚡ PERFORMANCE (V6 SC3): KPIs + charts are now computed via SQL aggregate
// queries. Was: a single findMany loaded range + previous-range transactions
// WITH ITEMS into memory and reduced in JS. At kirana scale that's fine, but
// "This Year" or "All time" ranges on a busy shop loaded ~24 months of
// transactions with line items into a serverless function → slow + memory
// pressure. Now: constant memory regardless of range/volume. The DB returns
// only the computed sums/totals, never the raw rows.
//
// We still fetch the latest 8 transactions (for the "recent" widget) with
// items — that's bounded at 8 rows and never grows with scale.
//
// Aggregation strategy:
//   - KPIs (today/range/prev-range): db.transaction.groupBy({ by: ['type'] })
//     with date filters — one round-trip per date window, O(1) memory.
//   - Sales trend: raw SQL date_trunc('day'|'week'|'month', date) GROUP BY.
//   - Top products: raw SQL GROUP BY productId with SUM.
//   - Category breakdown: raw SQL JOIN Product GROUP BY category.
//   - Payment mode: db.transaction.groupBy({ by: ['paymentMode'] }).
//   - GST summary: db.transaction.aggregate (sum of cgst/sgst/igst).

// GET /api/dashboard?from=&to= - returns aggregated stats for dashboard with date filtering
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const now = new Date()
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    // Date range for filtering analytics (defaults to this month)
    const rangeFrom = fromStr ? new Date(fromStr) : startOfMonth
    const rangeTo = toStr ? new Date(toStr) : now

    // Previous range (for growth % calculation)
    const prevRangeDuration = rangeTo.getTime() - rangeFrom.getTime()
    const prevRangeFrom = new Date(rangeFrom.getTime() - prevRangeDuration)
    const prevRangeTo = new Date(rangeFrom.getTime() - 1)

    // Parallel batch 1: bounded fetches + KPI aggregates (all SQL-side, O(1) memory each)
    // 🔒 V7.2 BUG FIX: Connection pool exhaustion. Was running 10 queries in
    // a single Promise.all, but Neon serverless uses connection_limit=1
    // (correct for serverless — each function instance holds 1 connection).
    // 10 parallel queries competing for 1 connection → "Timed out fetching
    // a new connection from the connection pool" → HTTP 500.
    //
    // Now: run queries in SEQUENTIAL BATCHES of 2-3 at a time. Each batch
    // waits for the previous to complete before starting. This keeps the
    // connection pool happy (never more than 2-3 queries in flight) while
    // still using parallelism within each batch for speed.
    //
    // Batch 1: Static data (recent txns, products, parties, setting) — 4 queries
    // Batch 2: KPI aggregates (today, range, prev-range) — 3 queries
    // Batch 3: GST + payment mode aggregates — 3 queries

    // === BATCH 1: Static data ===
    const [recentTransactions, allProducts, allParties, setting] = await Promise.all([
      // Always fetch latest 8 transactions (for "recent transactions" widget).
      // Bounded at 8 rows — never grows with scale.
      db.transaction.findMany({
        where: activeTransactionWhere(userId),
        include: { items: true, party: true },
        orderBy: { date: 'desc' },
        take: 8,
      }),
      // Products: only fetch fields needed for stock calc + low-stock list.
      db.product.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          category: true,
          purchasePrice: true,
          salePrice: true,
          currentStock: true,
          lowStockThreshold: true,
        },
      }),
      // Parties: only fetch id for the partyCount KPI.
      db.party.findMany({
        where: { userId, deletedAt: null },
        select: { id: true },
      }),
      db.setting.findUnique({ where: { userId } }),
    ])

    // === BATCH 2: KPI aggregates (today / range / prev-range) ===
    const [todayKpiAgg, rangeKpiAgg, prevRangeKpiAgg] = await Promise.all([
      // Today's KPIs — grouped by type, filtered to today + non-deleted.
      db.transaction.groupBy({
        by: ['type'],
        where: activeTransactionWhere(userId, {
          date: { gte: startOfToday, lte: now },
        }),
        _sum: { totalAmount: true, grossProfit: true },
        _count: true,
      }),
      // Range KPIs — grouped by type, filtered to selected range.
      db.transaction.groupBy({
        by: ['type'],
        where: activeTransactionWhere(userId, {
          date: { gte: rangeFrom, lte: rangeTo },
        }),
        _sum: { totalAmount: true, grossProfit: true },
        _count: true,
      }),
      // Previous-range KPIs (for growth %).
      db.transaction.groupBy({
        by: ['type'],
        where: activeTransactionWhere(userId, {
          date: { gte: prevRangeFrom, lte: prevRangeTo },
        }),
        _sum: { totalAmount: true, grossProfit: true },
        _count: true,
      }),
    ])

    // === BATCH 3: GST + payment mode aggregates ===
    const [saleGstAgg, purchaseGstAgg, rangePaymentAgg] = await Promise.all([
      // GST summary — sales
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, {
          type: 'sale',
          date: { gte: rangeFrom, lte: rangeTo },
        }),
        _sum: { subtotal: true, discountAmount: true, cgst: true, sgst: true, igst: true },
      }),
      // GST summary — purchases (input tax)
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, {
          type: 'purchase',
          date: { gte: rangeFrom, lte: rangeTo },
        }),
        _sum: { cgst: true, sgst: true, igst: true },
      }),
      // === Payment mode split via groupBy ===
      db.transaction.groupBy({
        by: ['paymentMode'],
        where: activeTransactionWhere(userId, {
          type: 'sale',
          date: { gte: rangeFrom, lte: rangeTo },
        }),
        _sum: { totalAmount: true },
      }),
    ])

    // Helper: extract a sum from a groupBy result for a specific type
    const sumOf = (agg: Array<{ type: string; _sum: { totalAmount: number | null; grossProfit: number | null } }>, type: string) =>
      agg.filter(r => r.type === type).reduce((s, r) => s + (r._sum.totalAmount || 0), 0)
    const profitOf = (agg: Array<{ type: string; _sum: { totalAmount: number | null; grossProfit: number | null } }>, type: string) =>
      agg.filter(r => r.type === type).reduce((s, r) => s + (r._sum.grossProfit || 0), 0)
    const countOf = (agg: Array<{ type: string; _count: number }>, type: string) =>
      agg.filter(r => r.type === type).reduce((s, r) => s + r._count, 0)

    // === Compute KPIs from groupBy results ===
    const todayRevenue = roundMoney(sumOf(todayKpiAgg as any, 'sale'))
    const todayProfit = roundMoney(profitOf(todayKpiAgg as any, 'sale'))
    const todayTxnCount = countOf(todayKpiAgg as any, 'sale')

    const rangeRevenue = roundMoney(sumOf(rangeKpiAgg as any, 'sale'))
    const rangeProfit = roundMoney(profitOf(rangeKpiAgg as any, 'sale'))
    const rangeExpenses = roundMoney(sumOf(rangeKpiAgg as any, 'expense'))
    const rangePurchases = roundMoney(sumOf(rangeKpiAgg as any, 'purchase'))
    const rangeIncome = roundMoney(sumOf(rangeKpiAgg as any, 'income'))
    const rangeTxnCount = countOf(rangeKpiAgg as any, 'sale')

    const prevRangeRevenue = roundMoney(sumOf(prevRangeKpiAgg as any, 'sale'))
    const prevRangeProfit = roundMoney(profitOf(prevRangeKpiAgg as any, 'sale'))

    const revenueGrowth = prevRangeRevenue > 0
      ? ((rangeRevenue - prevRangeRevenue) / prevRangeRevenue) * 100
      : 0
    const profitGrowth = prevRangeProfit > 0
      ? ((rangeProfit - prevRangeProfit) / prevRangeProfit) * 100
      : 0

    // 🔒 V7 H1: Use shared helper for receivable/payable. Was: only summed
    // openingBalance (WRONG — ignored all credit sales/purchases). Now uses
    // getReceivablePayable() which computes the correct balance from
    // openingBalance + sales - purchases (filtered deletedAt: null).
    // This is the SAME logic used by parties/route.ts and parties/[id]/route.ts
    // so all three screens now agree.
    const { totalReceivable, totalPayable } = await getReceivablePayable(userId)

    // === GST summary from aggregate results ===
    const rangeTaxableSales = roundMoney((saleGstAgg._sum.subtotal || 0) - (saleGstAgg._sum.discountAmount || 0))
    const rangeCGST = roundMoney(saleGstAgg._sum.cgst || 0)
    const rangeSGST = roundMoney(saleGstAgg._sum.sgst || 0)
    const rangeIGST = roundMoney(saleGstAgg._sum.igst || 0)
    const rangeInputTax = roundMoney(
      (purchaseGstAgg._sum.cgst || 0) + (purchaseGstAgg._sum.sgst || 0) + (purchaseGstAgg._sum.igst || 0)
    )
    const netGSTPayable = roundMoney((rangeCGST + rangeSGST + rangeIGST) - rangeInputTax)

    // === Payment mode split from groupBy ===
    const paymentModeSplit = rangePaymentAgg.map(r => ({
      name: (r.paymentMode || 'cash').toUpperCase(),
      value: roundMoney(r._sum.totalAmount || 0),
    }))

    // === Sales trend via raw SQL date_trunc (O(buckets) memory, not O(rows)) ===
    const daysInRange = Math.ceil((rangeTo.getTime() - rangeFrom.getTime()) / 86400000)
    let truncUnit: 'day' | 'week' | 'month'
    let maxBuckets: number
    if (daysInRange <= 31) {
      truncUnit = 'day'
      maxBuckets = 14
    } else if (daysInRange <= 180) {
      truncUnit = 'week'
      maxBuckets = 14
    } else {
      truncUnit = 'month'
      maxBuckets = 12
    }

    // 🔒 V6.1 BUG FIX: All column names are now quoted. Was: `date` and `type`
    // used unquoted — but `date` is also a PostgreSQL data type name, which
    // caused ambiguity (Postgres could interpret `date` as the type, not the
    // column). This caused a SQL error → catch block returned empty data →
    // dashboard showed "Welcome to EkBook" empty state for existing users.
    // 🔒 V7.1 BUG FIX: DATE_TRUNC's first argument must be a text literal,
    // not a parameterized value. Prisma's $queryRaw treats ${truncUnit} as
    // a parameter ($1), which causes: "function date_trunc(text, timestamp)
    // does not exist" or similar errors. Use Prisma.raw to inline the unit
    // safely (it's a hardcoded string — 'day'|'week'|'month' — not user input,
    // so no SQL injection risk).
    const truncUnitLiteral = Prisma.raw(`'${truncUnit}'`)  // quoted string literal, safe (hardcoded value)

    const salesTrendRows = await db.$queryRaw<Array<{ bucketStart: Date; revenue: number; profit: number }>>`
      SELECT
        DATE_TRUNC(${truncUnitLiteral}, "date") AS "bucketStart",
        COALESCE(SUM("totalAmount"), 0) AS revenue,
        COALESCE(SUM("grossProfit"), 0) AS profit
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
        AND "type" = 'sale'
        AND "date" >= ${rangeFrom}
        AND "date" <= ${rangeTo}
      GROUP BY DATE_TRUNC(${truncUnitLiteral}, "date")
      ORDER BY "bucketStart" ASC
    `

    // Build the chart data, filling missing buckets with zeros.
    // We generate the bucket boundaries in JS (deterministic) and overlay
    // the SQL rows (which only exist for buckets that have data).
    const salesTrend: { date: string; revenue: number; profit: number; label: string }[] = []
    const trendMap = new Map<string, { revenue: number; profit: number }>()
    for (const row of salesTrendRows) {
      const key = new Date(row.bucketStart).toISOString()
      trendMap.set(key, {
        revenue: roundMoney(Number(row.revenue)),
        profit: roundMoney(Number(row.profit)),
      })
    }

    // Generate bucket boundaries in JS
    const generateBuckets = (): { start: Date; label: string; key: string }[] => {
      const buckets: { start: Date; label: string; key: string }[] = []
      if (truncUnit === 'day') {
        const days = Math.min(daysInRange + 1, maxBuckets)
        for (let i = days - 1; i >= 0; i--) {
          const start = new Date(rangeTo)
          start.setDate(start.getDate() - i)
          start.setHours(0, 0, 0, 0)
          buckets.push({
            start,
            label: start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
            key: start.toISOString(),
          })
        }
      } else if (truncUnit === 'week') {
        const weeks = Math.min(Math.ceil(daysInRange / 7), maxBuckets)
        for (let i = weeks - 1; i >= 0; i--) {
          const end = new Date(rangeTo)
          end.setDate(end.getDate() - i * 7)
          const start = new Date(end)
          start.setDate(start.getDate() - 6)
          start.setHours(0, 0, 0, 0)
          buckets.push({
            start,
            label: start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
            key: start.toISOString(),
          })
        }
      } else {
        const months = Math.min(Math.ceil(daysInRange / 30), maxBuckets)
        for (let i = months - 1; i >= 0; i--) {
          const start = new Date(rangeTo.getFullYear(), rangeTo.getMonth() - i, 1)
          buckets.push({
            start,
            label: start.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
            key: start.toISOString(),
          })
        }
      }
      return buckets
    }

    for (const bucket of generateBuckets()) {
      const data = trendMap.get(bucket.key) || { revenue: 0, profit: 0 }
      salesTrend.push({
        date: bucket.key,
        revenue: data.revenue,
        profit: data.profit,
        label: bucket.label,
      })
    }

    // === Top products via raw SQL (O(top N) memory, not O(all items)) ===
    // 🔒 V6.1 BUG FIX: Quote all column names (type, date, quantity, etc.)
    // to avoid SQL ambiguity. `date` is a Postgres type name — unquoted use
    // caused the dashboard to crash silently.
    const topProductsRows = await db.$queryRaw<Array<{ productName: string; productId: string | null; totalQuantity: bigint; totalRevenue: string }>>`
      SELECT
        ti."productName",
        ti."productId",
        SUM(ti."quantity") AS "totalQuantity",
        SUM(ROUND(ti."quantity" * ti."unitPrice", 2)) AS "totalRevenue"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."date" >= ${rangeFrom}
        AND t."date" <= ${rangeTo}
      GROUP BY ti."productName", ti."productId"
      ORDER BY "totalRevenue" DESC
      LIMIT 5
    `

    // Compute profit per top product (needs purchasePrice from the in-memory products list)
    const topProducts = topProductsRows.map(row => {
      const product = row.productId ? allProducts.find(p => p.id === row.productId) : null
      const purchasePrice = product?.purchasePrice || 0
      const quantity = Number(row.totalQuantity)
      const revenue = roundMoney(Number(row.totalRevenue))
      // Profit estimate: (unitPrice - purchasePrice) * qty. Since we don't have
      // per-item unitPrice in the aggregate, we approximate using average unitPrice.
      const avgUnitPrice = quantity > 0 ? revenue / quantity : 0
      const profit = roundMoney((avgUnitPrice - purchasePrice) * quantity)
      return {
        name: row.productName,
        quantity,
        revenue,
        profit,
      }
    })

    // === Category breakdown via raw SQL (JOIN Product, GROUP BY category) ===
    // 🔒 V6.1 BUG FIX: Quote all column names.
    const categoryRows = await db.$queryRaw<Array<{ category: string | null; totalValue: string }>>`
      SELECT
        COALESCE(p."category", 'Other') AS category,
        SUM(ROUND(ti."quantity" * ti."unitPrice", 2)) AS "totalValue"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      LEFT JOIN "Product" p ON ti."productId" = p.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."date" >= ${rangeFrom}
        AND t."date" <= ${rangeTo}
      GROUP BY COALESCE(p."category", 'Other')
      ORDER BY "totalValue" DESC
    `

    const categoryBreakdown = categoryRows.map(row => ({
      name: row.category || 'Other',
      value: roundMoney(Number(row.totalValue)),
    }))

    // === Inventory stats (not range-dependent) — read currentStock column directly (V3 N2) ===
    const lowStockProducts = allProducts
      .filter(p => p.currentStock <= p.lowStockThreshold)
      .sort((a, b) => a.currentStock - b.currentStock)

    const totalStockValue = roundMoney(
      allProducts.reduce((s, p) => s + p.currentStock * p.purchasePrice, 0)
    )

    // === Recent transactions (not range-dependent, always latest) ===
    const recentTransactionsData = recentTransactions.map(t => ({
      id: t.id,
      type: t.type,
      invoiceNo: t.invoiceNo,
      date: t.date,
      partyId: t.partyId,
      partyName: t.party?.name || 'Walk-in Customer',
      totalAmount: t.totalAmount,
      paidAmount: t.paidAmount,
      profit: t.grossProfit,
      paymentMode: t.paymentMode,
      itemsCount: t.items.length,
      items: t.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item?.unitPrice,
        gstRate: item.gstRate,
        unit: (item as any)?.unit || 'pcs',
      })),
    }))

    return withCache({
      setting: setting || { shopName: 'My Shop' },
      dateRange: { from: rangeFrom, to: rangeTo },
      kpis: {
        todayRevenue,
        todayProfit,
        todayTxnCount,
        rangeRevenue,
        rangeProfit,
        rangeExpenses,
        rangePurchases,
        rangeIncome,
        revenueGrowth,
        profitGrowth,
        netProfit: roundMoney(rangeProfit + rangeIncome - rangeExpenses),
        totalReceivable,
        totalPayable,
        totalStockValue,
        productCount: allProducts.length,
        partyCount: allParties.length,
        rangeTxnCount,
      },
      salesTrend,
      topProducts,
      categoryBreakdown,
      paymentModeSplit,
      lowStockProducts,
      gstSummary: {
        taxableSales: rangeTaxableSales,
        cgst: rangeCGST,
        sgst: rangeSGST,
        igst: rangeIGST,
        outputTax: roundMoney(rangeCGST + rangeSGST + rangeIGST),
        inputTax: rangeInputTax,
        netPayable: netGSTPayable,
      },
      recentTransactions: recentTransactionsData,
    }, { maxAge: 30, swr: 300 })
  } catch (error) {
    // 🔒 V7.1 BUG FIX: Was returning all-zeros with HTTP 200 on ANY error →
    // the dashboard showed the "Welcome to EkBook" empty state for existing
    // users, hiding the real SQL/DB error. Now: return 500 with the error
    // message so the founder can see exactly what failed in Vercel logs,
    // and the UI shows an error state instead of a fake empty dashboard.
    console.error('Dashboard API error:', error)
    if (error instanceof Error) {
      console.error('Dashboard API error stack:', error.stack)
      console.error('Dashboard API error message:', error.message)
    }
    return NextResponse.json(
      {
        error: 'Failed to load dashboard',
        message: error instanceof Error ? error.message : 'Unknown error',
        detail: error instanceof Error ? String(error).slice(0, 500) : String(error).slice(0, 500),
      },
      { status: 500 },
    )
  }
}
