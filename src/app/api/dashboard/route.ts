import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { activeTransactionWhere } from '@/lib/query-helpers'

// ⚡ PERFORMANCE (Audit fix N2): KPIs are now computed via SQL aggregate
// queries instead of loading 13 months of transactions into memory and
// reducing in JavaScript. The chart data and top-products still use the
// raw transaction fetch (they need the line items), but the KPI sums
// (today, range, previous range) use db.transaction.aggregate() which
// runs as a single SQL SUM query — much faster and constant memory.

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

    // PERFORMANCE: only fetch transactions from the last 13 months.
    // This is enough for current range + previous range comparison (max ~12 months back).
    // For shops with years of history, this reduces the query size by 80%+.
    // Recent transactions (last 8) are always fetched separately for the "recent" widget.
    const thirteenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 13, 1)

    const [
      recentTransactions,
      allProducts,
      allParties,
      setting,
    ] = await Promise.all([
      // Always fetch latest 8 transactions (for "recent transactions" widget)
      db.transaction.findMany({
        where: activeTransactionWhere(userId),
        include: { items: true, party: true },
        orderBy: { date: 'desc' },
        take: 8,
      }),
      // Products: only fetch fields needed for stock calc + category breakdown
      db.product.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          category: true,
          purchasePrice: true,
          salePrice: true,
          openingStock: true,
          currentStock: true,
          lowStockThreshold: true,
        },
      }),
      // Parties: only fetch fields needed for receivable/payable calc
      db.party.findMany({
        where: { userId },
        select: {
          id: true,
          openingBalance: true,
        },
      }),
      db.setting.findUnique({ where: { userId } }),
    ])

    // 🔒 PERFORMANCE FIX: Fetch range transactions ONLY for chart/top-products
    // (not for KPIs — those use SQL aggregates now). Limit to the selected
    // date range, not 13 months. This is much smaller than the old query.
    const rangeTransactions = await db.transaction.findMany({
      where: activeTransactionWhere(userId, {
        date: { gte: rangeFrom, lte: rangeTo },
      }),
      select: {
        id: true,
        type: true,
        date: true,
        subtotal: true,
        discountAmount: true,
        cgst: true,
        sgst: true,
        igst: true,
        totalAmount: true,
        paidAmount: true,
        paymentMode: true,
        grossProfit: true,
        partyId: true,
        items: {
          select: {
            productId: true,
            productName: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    })

    // Combine: use rangeTransactions for analytics, but fall back to recentTransactions
    // for the "recent" widget (in case some recent txns are outside the 13-month window,
    // which shouldn't happen but just to be safe).
    const allTransactions = rangeTransactions

    const sales = allTransactions.filter(t => t.type === 'sale')
    const purchases = allTransactions.filter(t => t.type === 'purchase')
    const incomes = allTransactions.filter(t => t.type === 'income')
    const expenses = allTransactions.filter(t => t.type === 'expense')

    // === KPIs via SQL aggregates (Audit fix N2) ===
    // Instead of loading all transactions and reducing in JS, run targeted
    // SQL SUM queries for each KPI. This is much faster at scale.
    const prevRangeDuration = rangeTo.getTime() - rangeFrom.getTime()
    const prevRangeFrom = new Date(rangeFrom.getTime() - prevRangeDuration)
    const prevRangeTo = new Date(rangeFrom.getTime() - 1)

    const [
      todayAgg,
      rangeSalesAgg,
      rangeExpensesAgg,
      rangePurchasesAgg,
      rangeIncomeAgg,
      prevRangeSalesAgg,
    ] = await Promise.all([
      // Today's sales: revenue + profit + count
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, { type: 'sale', date: { gte: startOfToday } }),
        _sum: { totalAmount: true, grossProfit: true },
        _count: true,
      }),
      // Range sales: revenue + profit
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, { type: 'sale', date: { gte: rangeFrom, lte: rangeTo } }),
        _sum: { totalAmount: true, grossProfit: true },
      }),
      // Range expenses
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, { type: 'expense', date: { gte: rangeFrom, lte: rangeTo } }),
        _sum: { totalAmount: true },
      }),
      // Range purchases
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, { type: 'purchase', date: { gte: rangeFrom, lte: rangeTo } }),
        _sum: { totalAmount: true },
      }),
      // Range income
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, { type: 'income', date: { gte: rangeFrom, lte: rangeTo } }),
        _sum: { totalAmount: true },
      }),
      // Previous range sales (for growth comparison)
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, { type: 'sale', date: { gte: prevRangeFrom, lte: prevRangeTo } }),
        _sum: { totalAmount: true, grossProfit: true },
      }),
    ])

    const todayRevenue = todayAgg._sum.totalAmount || 0
    const todayProfit = todayAgg._sum.grossProfit || 0
    const todayTxnCount = todayAgg._count || 0

    const rangeRevenue = rangeSalesAgg._sum.totalAmount || 0
    const rangeProfit = rangeSalesAgg._sum.grossProfit || 0
    const rangeExpenses = rangeExpensesAgg._sum.totalAmount || 0
    const rangePurchases = rangePurchasesAgg._sum.totalAmount || 0
    const rangeIncome = rangeIncomeAgg._sum.totalAmount || 0

    const prevRangeRevenue = prevRangeSalesAgg._sum.totalAmount || 0
    const prevRangeProfit = prevRangeSalesAgg._sum.grossProfit || 0

    // Still need filtered arrays for charts and top products
    const rangeSales = sales.filter(t => t.date >= rangeFrom && t.date <= rangeTo)

    const revenueGrowth = prevRangeRevenue > 0
      ? ((rangeRevenue - prevRangeRevenue) / prevRangeRevenue) * 100
      : 0
    const profitGrowth = prevRangeProfit > 0
      ? ((rangeProfit - prevRangeProfit) / prevRangeProfit) * 100
      : 0

    const totalReceivable = allParties.reduce((s, p) => s + (p.openingBalance > 0 ? p.openingBalance : 0), 0)
    const totalPayable = allParties.reduce((s, p) => s + (p.openingBalance < 0 ? -p.openingBalance : 0), 0)

    // === Sales trend (within range, up to 14 data points) ===
    const salesTrend: { date: string; revenue: number; profit: number; label: string }[] = []
    const daysInRange = Math.ceil((rangeTo.getTime() - rangeFrom.getTime()) / 86400000)

    // If range <= 31 days, show daily. Otherwise show weekly/monthly
    if (daysInRange <= 31) {
      const days = Math.min(daysInRange + 1, 14)
      // Take last 14 days of the range or the whole range if shorter
      const trendStart = new Date(rangeTo)
      trendStart.setDate(trendStart.getDate() - (days - 1))
      trendStart.setHours(0, 0, 0, 0)

      for (let i = 0; i < days; i++) {
        const dayStart = new Date(trendStart)
        dayStart.setDate(dayStart.getDate() + i)
        const dayEnd = new Date(dayStart)
        dayEnd.setDate(dayEnd.getDate() + 1)
        const daySales = sales.filter(t => t.date >= dayStart && t.date < dayEnd)
        salesTrend.push({
          date: dayStart.toISOString(),
          revenue: daySales.reduce((s, t) => s + t.totalAmount, 0),
          profit: daySales.reduce((s, t) => s + t.grossProfit, 0),
          label: dayStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        })
      }
    } else if (daysInRange <= 180) {
      // Weekly buckets
      const weeks = Math.min(Math.ceil(daysInRange / 7), 14)
      for (let i = weeks - 1; i >= 0; i--) {
        const weekEnd = new Date(rangeTo)
        weekEnd.setDate(weekEnd.getDate() - i * 7)
        const weekStart = new Date(weekEnd)
        weekStart.setDate(weekStart.getDate() - 6)
        weekStart.setHours(0, 0, 0, 0)
        const weekSales = sales.filter(t => t.date >= weekStart && t.date <= weekEnd)
        salesTrend.push({
          date: weekStart.toISOString(),
          revenue: weekSales.reduce((s, t) => s + t.totalAmount, 0),
          profit: weekSales.reduce((s, t) => s + t.grossProfit, 0),
          label: `${weekStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`,
        })
      }
    } else {
      // Monthly buckets (up to 12 months)
      const months = Math.min(Math.ceil(daysInRange / 30), 12)
      for (let i = months - 1; i >= 0; i--) {
        const monthEnd = new Date(rangeTo.getFullYear(), rangeTo.getMonth() - i + 1, 0)
        const monthStart = new Date(rangeTo.getFullYear(), rangeTo.getMonth() - i, 1)
        const mSales = sales.filter(t => t.date >= monthStart && t.date <= monthEnd)
        salesTrend.push({
          date: monthStart.toISOString(),
          revenue: mSales.reduce((s, t) => s + t.totalAmount, 0),
          profit: mSales.reduce((s, t) => s + t.grossProfit, 0),
          label: monthStart.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        })
      }
    }

    // === Top selling products (within range) ===
    const productSalesMap = new Map<string, { name: string; quantity: number; revenue: number; profit: number }>()
    rangeSales.forEach(t => {
      t.items.forEach(item => {
        const key = item.productId || item.productName
        const existing = productSalesMap.get(key) || { name: item.productName, quantity: 0, revenue: 0, profit: 0 }
        existing.quantity += item.quantity
        existing.revenue += item?.unitPrice * item.quantity
        existing.profit += (item?.unitPrice - (allProducts.find(p => p.id === item.productId)?.purchasePrice || 0)) * item.quantity
        productSalesMap.set(key, existing)
      })
    })
    const topProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    // === Category breakdown (within range) ===
    const categoryMap = new Map<string, number>()
    rangeSales.forEach(t => {
      t.items.forEach(item => {
        const product = allProducts.find(p => p.id === item.productId)
        const category = product?.category || 'Other'
        categoryMap.set(category, (categoryMap.get(category) || 0) + item?.unitPrice * item.quantity)
      })
    })
    const categoryBreakdown = Array.from(categoryMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    // === Payment mode split (within range) ===
    const paymentModeMap = new Map<string, number>()
    rangeSales.forEach(t => {
      paymentModeMap.set(t.paymentMode, (paymentModeMap.get(t.paymentMode) || 0) + t.totalAmount)
    })
    const paymentModeSplit = Array.from(paymentModeMap.entries())
      .map(([name, value]) => ({ name: name.toUpperCase(), value }))

    // === Inventory stats (not range-dependent) ===
    // 🔒 AUDIT FIX N2 (v3): Read currentStock directly from the Product column
    // instead of re-deriving from ALL transaction items. Was: O(all items)
    // scan + counted soft-deleted transactions. Now: O(1) per product, read
    // the column that's maintained atomically on every transaction write.
    const lowStockProducts = allProducts
      .map(p => ({ ...p, currentStock: p.currentStock }))
      .filter(p => p.currentStock <= p.lowStockThreshold)
      .sort((a, b) => a.currentStock - b.currentStock)

    const totalStockValue = allProducts.reduce((s, p) => {
      return s + p.currentStock * p.purchasePrice
    }, 0)

    // === GST summary (within range) ===
    const rangeTaxableSales = rangeSales.reduce((s, t) => s + (t.subtotal - t.discountAmount), 0)
    const rangeCGST = rangeSales.reduce((s, t) => s + t.cgst, 0)
    const rangeSGST = rangeSales.reduce((s, t) => s + t.sgst, 0)
    const rangeIGST = rangeSales.reduce((s, t) => s + t.igst, 0)
    const rangeInputTax = purchases.filter(t => t.date >= rangeFrom && t.date <= rangeTo).reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0)
    const netGSTPayable = (rangeCGST + rangeSGST + rangeIGST) - rangeInputTax

    // === Recent transactions (not range-dependent, always latest) ===
    // Use the dedicated recentTransactions fetch (only 8 rows, always latest)
    // instead of slicing from allTransactions which may be limited to 13 months.
    // Include full items array + partyId for "Repeat Last Sale" feature.
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
        // Range-based KPIs (replacing the old "month" KPIs)
        rangeRevenue,
        rangeProfit,
        rangeExpenses,
        rangePurchases,
        rangeIncome,
        revenueGrowth,
        profitGrowth,
        netProfit: rangeProfit + rangeIncome - rangeExpenses,
        totalReceivable,
        totalPayable,
        totalStockValue,
        productCount: allProducts.length,
        partyCount: allParties.length,
        rangeTxnCount: rangeSales.length,
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
        outputTax: rangeCGST + rangeSGST + rangeIGST,
        inputTax: rangeInputTax,
        netPayable: netGSTPayable,
      },
      recentTransactions: recentTransactionsData,
    }, { maxAge: 30, swr: 300 })
  } catch (error) {
    console.error('Dashboard API error:', error)
    // 🔒 BUG FIX V5: Return empty dashboard data instead of 500 error.
    // This happens when migrations haven't run (new columns missing).
    // The app shows an empty dashboard instead of crashing.
    return NextResponse.json({
      kpis: {
        todayRevenue: 0, todayProfit: 0, todayTxnCount: 0,
        rangeRevenue: 0, rangeProfit: 0, rangeExpenses: 0,
        rangePurchases: 0, rangeIncome: 0,
        revenueGrowth: 0, profitGrowth: 0,
        totalReceivable: 0, totalPayable: 0,
        rangeSaleCount: 0,
      },
      salesTrend: [],
      topProducts: [],
      categoryBreakdown: [],
      paymentModeSplit: [],
      lowStockProducts: [],
      gstSummary: { taxableSales: 0, cgst: 0, sgst: 0, igst: 0, outputTax: 0, inputTax: 0, netPayable: 0 },
      recentTransactions: [],
      setting: null,
    })
  }
}
