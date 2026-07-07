import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { roundMoney } from '@/lib/money'
import { getReceivablePayable } from '@/lib/party-balance'
import { istDayStart, istMonthStart, getISTDateParts, IST_OFFSET_MS } from '@/lib/timezone'

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
    // 🔒 V11 §2.1 + §4.6: Use centralized IST helpers. Was: inline
    // `startOfToday.setHours(0,0,0,0)` which used server-local time (UTC on
    // Vercel) → "Today" started at 5:30 AM IST instead of 12 AM IST.
    const startOfToday = istDayStart(now)
    const startOfMonth = istMonthStart(now)

    // Date range for filtering analytics (defaults to this month)
    const rangeFrom = fromStr ? new Date(fromStr) : startOfMonth
    const rangeTo = toStr ? new Date(toStr) : now

    // Previous range (for growth % calculation)
    const prevRangeDuration = rangeTo.getTime() - rangeFrom.getTime()
    const prevRangeFrom = new Date(rangeFrom.getTime() - prevRangeDuration)
    const prevRangeTo = new Date(rangeFrom.getTime() - 1)

    // 🔒 V8 PERFORMANCE FIX: The 23s load was caused by 6 SEQUENTIAL queries
    // after the initial batch. Each query paid ~1.5-2s on a cold Neon DB.
    // 6 × 2s = 12s + 9s cold start = ~21s.
    //
    // Fix: 2-BATCH strategy:
    //   Batch 1: 4 small queries (wakes the DB if cold — ~9s on cold, ~1s warm)
    //   Batch 2: 6 queries in ONE Promise.all (DB is warm, each ~200ms = ~1.2s)
    //   Total: ~10s cold, ~2-3s warm
    //
    // Why this doesn't cause the V7.2 timeout: V7.2 fired 10 queries at once
    // on a COLD DB. The first query took 9s (waking Neon), and the other 9
    // queued behind it. By the time the 7th query tried to acquire the
    // connection, 10s+ had passed → pool timeout (10s).
    //
    // With the 2-batch approach: Batch 1 wakes the DB. By the time Batch 2
    // fires, the DB is warm. Each query in Batch 2 takes ~200ms, so the max
    // wait for any query is 5 × 200ms = 1s — well within the 10s timeout.

    // Compute truncUnit BEFORE queries (it's just date math, no DB needed)
    const daysInRange = Math.ceil((rangeTo.getTime() - rangeFrom.getTime()) / 86400000)
    let truncUnit: 'day' | 'week' | 'month'
    if (daysInRange <= 31) {
      truncUnit = 'day'
    } else if (daysInRange <= 180) {
      truncUnit = 'week'
    } else {
      truncUnit = 'month'
    }
    const truncUnitLiteral = Prisma.raw(`'${truncUnit}'`)

    // 🔒 V8 M2: Compute the effective range end = GREATEST(rangeTo, now).
    // If the user selects a past date range (e.g. "last month"), today's
    // transactions fall outside the window and "Today's Revenue" shows ₹0.
    // Using the greater of rangeTo/now ensures today's KPIs are always
    // included in the query, regardless of the selected range.
    const effectiveRangeEnd = rangeTo > now ? rangeTo : now

    // === BATCH 1: Static data (4 small queries — wakes the DB if cold) ===
    // 🔒 V8.1: Wrapped in withConnectionRetry — if the DB is cold (Neon
    // scale-to-zero), the first query may timeout. Retrying after 2s gives
    // Neon time to wake up.
    const [recentTransactions, allProducts, allParties, setting] = await withConnectionRetry(() =>
      Promise.all([
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
    )

    // === BATCH 2: ALL remaining queries in ONE Promise.all (DB is warm) ===
    // 🔒 V8.1: Also wrapped in withConnectionRetry for safety.
    const [
      kpiRows,
      receivablePayable,
      rangePaymentAgg,
      salesTrendRows,
      topProductsRows,
      categoryRows,
    ] = await withConnectionRetry(() => Promise.all([
      // 1. ALL KPIs + GST in one raw SQL (SUM(CASE WHEN ...) conditional aggregation)
      db.$queryRaw<Array<{
        today_revenue: string; today_profit: string; today_count: bigint;
        range_revenue: string; range_profit: string; range_expenses: string;
        range_purchases: string; range_income: string; range_sale_count: bigint;
        prev_revenue: string; prev_profit: string;
        sale_subtotal: string; sale_discount: string;
        sale_cgst: string; sale_sgst: string; sale_igst: string;
        purchase_cgst: string; purchase_sgst: string; purchase_igst: string;
      }>>`
        SELECT
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${startOfToday} AND "date" <= ${now} THEN "totalAmount" ELSE 0 END), 0)::numeric AS today_revenue,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${startOfToday} AND "date" <= ${now} THEN "grossProfit" ELSE 0 END), 0)::numeric AS today_profit,
          COUNT(CASE WHEN "type" = 'sale' AND "date" >= ${startOfToday} AND "date" <= ${now} THEN 1 END) AS today_count,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_revenue,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "grossProfit" ELSE 0 END), 0)::numeric AS range_profit,
          COALESCE(SUM(CASE WHEN "type" = 'expense' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_expenses,
          COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_purchases,
          COALESCE(SUM(CASE WHEN "type" = 'income' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS range_income,
          COUNT(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN 1 END) AS range_sale_count,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${prevRangeFrom} AND "date" <= ${prevRangeTo} THEN "totalAmount" ELSE 0 END), 0)::numeric AS prev_revenue,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${prevRangeFrom} AND "date" <= ${prevRangeTo} THEN "grossProfit" ELSE 0 END), 0)::numeric AS prev_profit,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "subtotal" ELSE 0 END), 0)::numeric AS sale_subtotal,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "discountAmount" ELSE 0 END), 0)::numeric AS sale_discount,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "cgst" ELSE 0 END), 0)::numeric AS sale_cgst,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "sgst" ELSE 0 END), 0)::numeric AS sale_sgst,
          COALESCE(SUM(CASE WHEN "type" = 'sale' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "igst" ELSE 0 END), 0)::numeric AS sale_igst,
          COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "cgst" ELSE 0 END), 0)::numeric AS purchase_cgst,
          COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "sgst" ELSE 0 END), 0)::numeric AS purchase_sgst,
          COALESCE(SUM(CASE WHEN "type" = 'purchase' AND "date" >= ${rangeFrom} AND "date" <= ${rangeTo} THEN "igst" ELSE 0 END), 0)::numeric AS purchase_igst
        FROM "Transaction"
        WHERE "userId" = ${userId}
          AND "deletedAt" IS NULL
          AND "date" >= ${prevRangeFrom}
          AND "date" <= ${effectiveRangeEnd}
      `,

      // 2. Receivable/Payable (shared helper — 1 raw SQL with LEFT JOIN)
      getReceivablePayable(userId),

      // 3. Payment mode split (1 groupBy)
      db.transaction.groupBy({
        by: ['paymentMode'],
        where: activeTransactionWhere(userId, {
          type: 'sale',
          date: { gte: rangeFrom, lte: rangeTo },
        }),
        _sum: { totalAmount: true },
      }),

      // 4. Sales trend (raw SQL date_trunc)
      // 🔒 V10 FIX: Group by IST day/week/month, not UTC. Was: DATE_TRUNC(unit, "date")
      // which groups by UTC day → a sale at 2 AM IST on July 6 appears on the
      // July 5 bar (shifted by 5.5 hours). Now: "date" AT TIME ZONE 'Asia/Kolkata'
      // converts the UTC timestamp to IST local time before truncating, so the
      // grouping matches the user's local day. Since this is an Indian app
      // (100% Indian users), hardcoding IST is the right call.
      db.$queryRaw<Array<{ bucketStart: Date; revenue: number; profit: number }>>`
        SELECT
          DATE_TRUNC(${truncUnitLiteral}, "date" AT TIME ZONE 'Asia/Kolkata') AS "bucketStart",
          COALESCE(SUM("totalAmount"), 0) AS revenue,
          COALESCE(SUM("grossProfit"), 0) AS profit
        FROM "Transaction"
        WHERE "userId" = ${userId}
          AND "deletedAt" IS NULL
          AND "type" = 'sale'
          AND "date" >= ${rangeFrom}
          AND "date" <= ${rangeTo}
        GROUP BY DATE_TRUNC(${truncUnitLiteral}, "date" AT TIME ZONE 'Asia/Kolkata')
        ORDER BY "bucketStart" ASC
      `,

      // 5. Top products (raw SQL)
      db.$queryRaw<Array<{ productName: string; productId: string | null; totalQuantity: bigint; totalRevenue: string }>>`
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
      `,

      // 6. Category breakdown (raw SQL)
      db.$queryRaw<Array<{ category: string | null; totalValue: string }>>`
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
      `,
    ]))

    // === Process Batch 2 results (all in JS — no more DB queries) ===

    // KPIs from the consolidated query
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

    // Receivable/Payable
    const { totalReceivable, totalPayable } = receivablePayable

    // GST summary
    const rangeTaxableSales = roundMoney(Number(kpi.sale_subtotal) - Number(kpi.sale_discount))
    const rangeCGST = roundMoney(Number(kpi.sale_cgst))
    const rangeSGST = roundMoney(Number(kpi.sale_sgst))
    const rangeIGST = roundMoney(Number(kpi.sale_igst))
    const rangeInputTax = roundMoney(
      Number(kpi.purchase_cgst) + Number(kpi.purchase_sgst) + Number(kpi.purchase_igst)
    )
    const netGSTPayable = roundMoney((rangeCGST + rangeSGST + rangeIGST) - rangeInputTax)

    // Payment mode split
    const paymentModeSplit = rangePaymentAgg.map(r => ({
      name: (r.paymentMode || 'cash').toUpperCase(),
      value: roundMoney(r._sum.totalAmount || 0),
    }))

    // Sales trend (fill missing buckets with zeros)
    // 🔒 V10 FIX: The SQL now groups by IST day (via AT TIME ZONE 'Asia/Kolkata').
    // The bucketStart is a naive timestamp at IST midnight, which JS interprets
    // as UTC. So "2026-07-06 00:00:00 IST" becomes ISO "2026-07-06T00:00:00.000Z".
    // The JS bucket generation below must produce the same keys — so it uses
    // Date.UTC() to create UTC-midnight timestamps that match the SQL output.
    const salesTrend: { date: string; revenue: number; profit: number; label: string }[] = []
    const trendMap = new Map<string, { revenue: number; profit: number }>()
    for (const row of salesTrendRows) {
      // row.bucketStart is a naive timestamp (IST midnight interpreted as UTC by JS).
      // Convert to ISO string for the key — matches the JS-generated bucket keys below.
      const key = new Date(row.bucketStart).toISOString()
      trendMap.set(key, {
        revenue: roundMoney(Number(row.revenue)),
        profit: roundMoney(Number(row.profit)),
      })
    }

    // Generate bucket boundaries in JS
    // 🔒 V10 FIX: Generate buckets aligned to IST day boundaries (not UTC).
    // The SQL groups by IST day, so the JS buckets must also use IST dates
    // for the keys to match. Without this, late-night IST transactions
    // (12 AM - 5:30 AM) would appear on the previous day's bar.
    // 🔒 V11 §4.6: IST_OFFSET_MS and getISTDateParts now imported from @/lib/timezone.
    const generateBuckets = (): { start: Date; label: string; key: string }[] => {
      const buckets: { start: Date; label: string; key: string }[] = []
      if (truncUnit === 'day') {
        const maxBuckets = 14
        const days = Math.min(daysInRange + 1, maxBuckets)
        // Start from the IST "today" (derived from rangeTo)
        const istParts = getISTDateParts(rangeTo)
        const todayIST = new Date(Date.UTC(istParts.year, istParts.month, istParts.day))
        for (let i = days - 1; i >= 0; i--) {
          const start = new Date(todayIST)
          start.setUTCDate(start.getUTCDate() - i)
          buckets.push({
            start,
            label: start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
            key: start.toISOString(),
          })
        }
      } else if (truncUnit === 'week') {
        const maxBuckets = 14
        const weeks = Math.min(Math.ceil(daysInRange / 7), maxBuckets)
        const istParts = getISTDateParts(rangeTo)
        const todayIST = new Date(Date.UTC(istParts.year, istParts.month, istParts.day))
        for (let i = weeks - 1; i >= 0; i--) {
          const end = new Date(todayIST)
          end.setUTCDate(end.getUTCDate() - i * 7)
          const start = new Date(end)
          start.setUTCDate(start.getUTCDate() - 6)
          buckets.push({
            start,
            label: start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
            key: start.toISOString(),
          })
        }
      } else {
        const maxBuckets = 12
        const months = Math.min(Math.ceil(daysInRange / 30), maxBuckets)
        // For month buckets, use IST date parts to determine the current month
        const istParts = getISTDateParts(rangeTo)
        for (let i = months - 1; i >= 0; i--) {
          const start = new Date(Date.UTC(istParts.year, istParts.month - i, 1))
          buckets.push({
            start,
            label: start.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
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

    // Top products
    const topProducts = topProductsRows.map(row => {
      const product = row.productId ? allProducts.find(p => p.id === row.productId) : null
      const purchasePrice = product?.purchasePrice || 0
      const quantity = Number(row.totalQuantity)
      const revenue = roundMoney(Number(row.totalRevenue))
      const avgUnitPrice = quantity > 0 ? revenue / quantity : 0
      const profit = roundMoney((avgUnitPrice - purchasePrice) * quantity)
      return {
        name: row.productName,
        quantity,
        revenue,
        profit,
      }
    })

    // Category breakdown
    const categoryBreakdown = categoryRows.map(row => ({
      name: row.category || 'Other',
      value: roundMoney(Number(row.totalValue)),
    }))

    // === Inventory stats (not range-dependent) — read currentStock column directly (V3 N2) ===
    const lowStockProducts = allProducts
      .filter(p => p.currentStock <= p.lowStockThreshold)
      .sort((a, b) => a.currentStock - b.currentStock)

    // 🔒 V11: Clamp each product's stock value at 0 before summing. Was:
    // `p.currentStock * p.purchasePrice` which went negative when stock was
    // oversold, making the dashboard "Stock Value" KPI go negative. Now:
    // oversold products contribute 0 to the total (their value is already
    // realized through sales, not sitting in inventory).
    const totalStockValue = roundMoney(
      allProducts.reduce((s, p) => s + Math.max(0, p.currentStock) * p.purchasePrice, 0)
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
    // 🔒 V9 2.5 FIX: Log full error server-side only (Sentry captures it too).
    // Was: returning error.message + String(error) to the client — leaked
    // Prisma/Postgres internals (table names, column names, constraint
    // messages) to any client. Now: return a generic message + error ID
    // so the founder can find the real error in Vercel logs.
    const errorId = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    console.error(`[Dashboard API error ${errorId}]:`, error)
    if (error instanceof Error) {
      console.error(`[Dashboard API error ${errorId}] stack:`, error.stack)
    }
    return NextResponse.json(
      {
        error: 'Failed to load dashboard',
        message: 'An internal error occurred. Please try refreshing.',
        errorId,  // client can show this to support for log lookup
      },
      { status: 500 },
    )
  }
}
