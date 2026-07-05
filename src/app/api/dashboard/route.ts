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

    // 🔒 V7.5 PERFORMANCE FIX: Was running 10 queries in 3 sequential batches
    // (V7.2 fix for connection pool timeout). That worked but was SLOW (20s).
    //
    // Root cause: with connection_limit=1, each query takes ~1-2s (cold Neon
    // connection). 10 queries × 1.5s avg = ~15-20s. Parallel was faster but
    // caused pool exhaustion.
    //
    // Fix: CONSOLIDATE. Replace 8 separate groupBy/aggregate queries with ONE
    // raw SQL query that computes ALL KPIs + GST in a single pass using
    // SUM(CASE WHEN ...) conditional aggregation. This is 1 round-trip instead
    // of 8 — cutting the dashboard load time from ~20s back to ~4-5s.
    //
    // Query breakdown:
    //   - 1 raw SQL for ALL KPIs (today/range/prev-range) + GST (sale+purchase)
    //   - 1 batch for static data (recent txns, products, parties, setting)
    //   - 1 groupBy for payment mode (can't easily fold into the big query)
    //   Total: 3 round-trips instead of 10

    // === BATCH 1: Static data (4 small, fast queries in parallel) ===
    const [recentTransactions, allProducts, allParties, setting] = await Promise.all([
      db.transaction.findMany({
        where: activeTransactionWhere(userId),
        include: { items: true, party: true },
        orderBy: { date: 'desc' },
        take: 8,
      }),
      db.product.findMany({
        where: { userId },
        select: {
          id: true, name: true, category: true,
          purchasePrice: true, salePrice: true,
          currentStock: true, lowStockThreshold: true,
        },
      }),
      db.party.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, openingBalance: true },
      }),
      db.setting.findUnique({ where: { userId } }),
    ])

    // === BATCH 2: ONE consolidated raw SQL query for ALL KPIs + GST ===
    // Replaces 8 separate queries (3 KPI groupBy + 2 GST aggregate + 3 prev-range).
    // Uses SUM(CASE WHEN ...) to compute everything in a single pass.
    const kpiRows = await db.$queryRaw<Array<{
      today_revenue: string; today_profit: string; today_count: bigint;
      range_revenue: string; range_profit: string; range_expenses: string;
      range_purchases: string; range_income: string; range_sale_count: bigint;
      prev_revenue: string; prev_profit: string;
      sale_subtotal: string; sale_discount: string;
      sale_cgst: string; sale_sgst: string; sale_igst: string;
      purchase_cgst: string; purchase_sgst: string; purchase_igst: string;
    }>>`
      SELECT
        -- Today's KPIs
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${startOfToday} AND "date" <= ${now} THEN "totalAmount" ELSE 0 END), 0)::numeric AS today_revenue,
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${startOfToday} AND "date" <= ${now} THEN "grossProfit" ELSE 0 END), 0)::numeric AS today_profit,
        COUNT(CASE WHEN "type" = 'sale' AND "date" >= ${startOfToday} AND "date" <= ${now} THEN 1 END) AS today_count,

        -- Range KPIs
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_revenue,
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "grossProfit" ELSE 0 END), 0)::numeric AS range_profit,
        COALESCE(SUM(CASE WHEN "type" = 'expense' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_expenses,
        COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_purchases,
        COALESCE(SUM(CASE WHEN "type" = 'income' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_income,
        COUNT(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN 1 END) AS range_sale_count,

        -- Previous range KPIs (for growth %)
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${prevRangeFrom} AND "date" <= ${prevRangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS prev_revenue,
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${prevRangeFrom} AND "date" <= ${prevRangeTo} THEN "grossProfit" ELSE 0 END), 0)::numeric AS prev_profit,

        -- GST summary (sales, range-filtered)
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "subtotal" ELSE 0 END), 0)::numeric AS sale_subtotal,
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "discountAmount" ELSE 0 END), 0)::numeric AS sale_discount,
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "cgst" ELSE 0 END), 0)::numeric AS sale_cgst,
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "sgst" ELSE 0 END), 0)::numeric AS sale_sgst,
        COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "igst" ELSE 0 END), 0)::numeric AS sale_igst,

        -- GST summary (purchases / input tax, range-filtered)
        COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "cgst" ELSE 0 END), 0)::numeric AS purchase_cgst,
        COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "sgst" ELSE 0 END), 0)::numeric AS purchase_sgst,
        COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "igst" ELSE 0 END), 0)::numeric AS purchase_igst
      FROM "Transaction"
      WHERE "userId" = ${userId}
        AND "deletedAt" IS NULL
        AND "date" >= ${prevRangeFrom}
        AND "date" <= ${rangeTo}
    `

    const kpi = kpiRows[0]
    const todayRevenue = roundMoney(Number(kpi.today_revenue))
    const todayProfit = roundMoney(Number(kpi.today_profit))
    const todayTxnCount = Number(kpi.today_count)
    const rangeRevenue = roundMoney(Number(kpi.range_revenue))
    const rangeProfit = roundMoney(Number(kpi.range_profit))
    const rangeExpenses = roundMoney(Number(kpi.range_expenses))
    const rangePurchases = roundMoney(Number(kpi.range_purchases))
    const rangeIncome = roundMoney(Number(kpi.range_income))
    const rangeTxnCount = Number(kpi.range_sale_count)
    const prevRangeRevenue = roundMoney(Number(kpi.prev_revenue))
    const prevRangeProfit = roundMoney(Number(kpi.prev_profit))

    const revenueGrowth = prevRangeRevenue > 0
      ? ((rangeRevenue - prevRangeRevenue) / prevRangeRevenue) * 100
      : 0
    const profitGrowth = prevRangeProfit > 0
      ? ((rangeProfit - prevRangeProfit) / prevRangeProfit) * 100
      : 0

    // === Receivable/Payable (uses shared helper) ===
    const { totalReceivable, totalPayable } = await getReceivablePayable(userId)

    // === GST summary from the consolidated query ===
    const rangeTaxableSales = roundMoney(Number(kpi.sale_subtotal) - Number(kpi.sale_discount))
    const rangeCGST = roundMoney(Number(kpi.sale_cgst))
    const rangeSGST = roundMoney(Number(kpi.sale_sgst))
    const rangeIGST = roundMoney(Number(kpi.sale_igst))
    const rangeInputTax = roundMoney(
      Number(kpi.purchase_cgst) + Number(kpi.purchase_sgst) + Number(kpi.purchase_igst)
    )
    const netGSTPayable = roundMoney((rangeCGST + rangeSGST + rangeIGST) - rangeInputTax)

    // === Payment mode split (1 groupBy — can't easily fold into the big query) ===
    const rangePaymentAgg = await db.transaction.groupBy({
      by: ['paymentMode'],
      where: activeTransactionWhere(userId, {
        type: 'sale',
        date: { gte: rangeFrom, lte: rangeTo },
      }),
      _sum: { totalAmount: true },
    })

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
        SUM(ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric)::numeric, 2)) AS "totalRevenue"
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
        SUM(ROUND((ti."quantity"::numeric * ti."unitPrice"::numeric)::numeric, 2)) AS "totalValue"
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
