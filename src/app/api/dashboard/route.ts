import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'

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
      rangeTransactions,
      allProducts,
      allParties,
      setting,
    ] = await Promise.all([
      // Always fetch latest 8 transactions (for "recent transactions" widget)
      // Needs items + party for display
      db.transaction.findMany({
        where: { userId },
        include: { items: true, party: true },
        orderBy: { date: 'desc' },
        take: 8,
      }),
      // Fetch transactions in the last 13 months for KPIs, charts, comparisons.
      // PERFORMANCE: only select fields we actually use for aggregation —
      // skip notes, invoiceNo, payeeName, payeePhone, isInterState, etc.
      // and skip the items/party includes (we only need items for top products
      // + category breakdown, which we fetch separately below if in range).
      db.transaction.findMany({
        where: {
          userId,
          date: { gte: thirteenMonthsAgo },
        },
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
          // Items: only fetch the fields needed for top-products + category breakdown
          items: {
            select: {
              productId: true,
              productName: true,
              quantity: true,
              unitPrice: true,
              gstRate: true,
              discountAmount: true,
              total: true,
            },
          },
        },
        orderBy: { date: 'desc' },
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

    // Combine: use rangeTransactions for analytics, but fall back to recentTransactions
    // for the "recent" widget (in case some recent txns are outside the 13-month window,
    // which shouldn't happen but just to be safe).
    const allTransactions = rangeTransactions

    const sales = allTransactions.filter(t => t.type === 'sale')
    const purchases = allTransactions.filter(t => t.type === 'purchase')
    const incomes = allTransactions.filter(t => t.type === 'income')
    const expenses = allTransactions.filter(t => t.type === 'expense')

    // === KPIs (Today is always "today", month KPIs respect the date range) ===
    const todaySales = sales.filter(t => t.date >= startOfToday)
    const todayRevenue = todaySales.reduce((s, t) => s + t.totalAmount, 0)
    const todayProfit = todaySales.reduce((s, t) => s + t.grossProfit, 0)
    const todayTxnCount = todaySales.length

    // Range-filtered sales (for the main KPIs based on selected date range)
    const rangeSales = sales.filter(t => t.date >= rangeFrom && t.date <= rangeTo)
    const rangeRevenue = rangeSales.reduce((s, t) => s + t.totalAmount, 0)
    const rangeProfit = rangeSales.reduce((s, t) => s + t.grossProfit, 0)
    const rangeExpenses = expenses.filter(t => t.date >= rangeFrom && t.date <= rangeTo).reduce((s, t) => s + t.totalAmount, 0)
    const rangePurchases = purchases.filter(t => t.date >= rangeFrom && t.date <= rangeTo).reduce((s, t) => s + t.totalAmount, 0)
    const rangeIncome = incomes.filter(t => t.date >= rangeFrom && t.date <= rangeTo).reduce((s, t) => s + t.totalAmount, 0)

    // Previous range for comparison (same length before rangeFrom)
    const rangeDuration = rangeTo.getTime() - rangeFrom.getTime()
    const prevRangeFrom = new Date(rangeFrom.getTime() - rangeDuration)
    const prevRangeTo = new Date(rangeFrom.getTime() - 1)
    const prevRangeSales = sales.filter(t => t.date >= prevRangeFrom && t.date <= prevRangeTo)
    const prevRangeRevenue = prevRangeSales.reduce((s, t) => s + t.totalAmount, 0)
    const prevRangeProfit = prevRangeSales.reduce((s, t) => s + t.grossProfit, 0)

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
    const stockMap = new Map<string, number>()
    allProducts.forEach(p => stockMap.set(p.id, p.openingStock))
    allTransactions.forEach(t => {
      t.items.forEach(item => {
        if (item.productId) {
          const current = stockMap.get(item.productId) || 0
          if (t.type === 'purchase') stockMap.set(item.productId, current + item.quantity)
          else if (t.type === 'sale') stockMap.set(item.productId, current - item.quantity)
        }
      })
    })

    const lowStockProducts = allProducts
      .map(p => ({ ...p, currentStock: stockMap.get(p.id) || 0 }))
      .filter(p => p.currentStock <= p.lowStockThreshold)
      .sort((a, b) => a.currentStock - b.currentStock)

    const totalStockValue = allProducts.reduce((s, p) => {
      const stock = stockMap.get(p.id) || 0
      return s + stock * p.purchasePrice
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
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
