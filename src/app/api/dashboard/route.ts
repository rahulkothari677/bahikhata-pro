import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/dashboard - returns aggregated stats for dashboard
export async function GET() {
  try {
    const now = new Date()
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)

    const [
      allTransactions,
      allProducts,
      allParties,
      setting,
    ] = await Promise.all([
      db.transaction.findMany({
        include: { items: true, party: true },
        orderBy: { date: 'desc' },
      }),
      db.product.findMany(),
      db.party.findMany(),
      db.setting.findUnique({ where: { id: 'default' } }),
    ])

    const sales = allTransactions.filter(t => t.type === 'sale')
    const purchases = allTransactions.filter(t => t.type === 'purchase')
    const incomes = allTransactions.filter(t => t.type === 'income')
    const expenses = allTransactions.filter(t => t.type === 'expense')

    const todaySales = sales.filter(t => t.date >= startOfToday)
    const todayRevenue = todaySales.reduce((s, t) => s + t.totalAmount, 0)
    const todayProfit = todaySales.reduce((s, t) => s + t.grossProfit, 0)
    const todayTxnCount = todaySales.length

    const monthSales = sales.filter(t => t.date >= startOfMonth)
    const monthRevenue = monthSales.reduce((s, t) => s + t.totalAmount, 0)
    const monthProfit = monthSales.reduce((s, t) => s + t.grossProfit, 0)
    const monthExpenses = expenses.filter(t => t.date >= startOfMonth).reduce((s, t) => s + t.totalAmount, 0)
    const monthPurchases = purchases.filter(t => t.date >= startOfMonth).reduce((s, t) => s + t.totalAmount, 0)
    const monthIncome = incomes.filter(t => t.date >= startOfMonth).reduce((s, t) => s + t.totalAmount, 0)

    const prevMonthSales = sales.filter(t => t.date >= startOfPrevMonth && t.date < startOfMonth)
    const prevMonthRevenue = prevMonthSales.reduce((s, t) => s + t.totalAmount, 0)
    const prevMonthProfit = prevMonthSales.reduce((s, t) => s + t.grossProfit, 0)

    const revenueGrowth = prevMonthRevenue > 0
      ? ((monthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100
      : 0
    const profitGrowth = prevMonthProfit > 0
      ? ((monthProfit - prevMonthProfit) / prevMonthProfit) * 100
      : 0

    const totalReceivable = allParties.reduce((s, p) => s + (p.openingBalance > 0 ? p.openingBalance : 0), 0)
    const totalPayable = allParties.reduce((s, p) => s + (p.openingBalance < 0 ? -p.openingBalance : 0), 0)

    const salesTrend: { date: string; revenue: number; profit: number; label: string }[] = []
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now)
      dayStart.setDate(dayStart.getDate() - i)
      dayStart.setHours(0, 0, 0, 0)
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

    const monthlyTrend: { month: string; revenue: number; profit: number; expenses: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const monthLabel = monthStart.toLocaleDateString('en-IN', { month: 'short' })
      const mSales = sales.filter(t => t.date >= monthStart && t.date < monthEnd)
      const mExp = expenses.filter(t => t.date >= monthStart && t.date < monthEnd)
      monthlyTrend.push({
        month: monthLabel,
        revenue: mSales.reduce((s, t) => s + t.totalAmount, 0),
        profit: mSales.reduce((s, t) => s + t.grossProfit, 0),
        expenses: mExp.reduce((s, t) => s + t.totalAmount, 0),
      })
    }

    const productSalesMap = new Map<string, { name: string; quantity: number; revenue: number; profit: number }>()
    sales.filter(t => t.date >= thirtyDaysAgo).forEach(t => {
      t.items.forEach(item => {
        const key = item.productId || item.productName
        const existing = productSalesMap.get(key) || { name: item.productName, quantity: 0, revenue: 0, profit: 0 }
        existing.quantity += item.quantity
        existing.revenue += item.unitPrice * item.quantity
        existing.profit += (item.unitPrice - (allProducts.find(p => p.id === item.productId)?.purchasePrice || 0)) * item.quantity
        productSalesMap.set(key, existing)
      })
    })
    const topProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    const categoryMap = new Map<string, number>()
    sales.filter(t => t.date >= thirtyDaysAgo).forEach(t => {
      t.items.forEach(item => {
        const product = allProducts.find(p => p.id === item.productId)
        const category = product?.category || 'Other'
        categoryMap.set(category, (categoryMap.get(category) || 0) + item.unitPrice * item.quantity)
      })
    })
    const categoryBreakdown = Array.from(categoryMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    const paymentModeMap = new Map<string, number>()
    sales.filter(t => t.date >= thirtyDaysAgo).forEach(t => {
      paymentModeMap.set(t.paymentMode, (paymentModeMap.get(t.paymentMode) || 0) + t.totalAmount)
    })
    const paymentModeSplit = Array.from(paymentModeMap.entries())
      .map(([name, value]) => ({ name: name.toUpperCase(), value }))

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

    const monthTaxableSales = monthSales.reduce((s, t) => s + (t.subtotal - t.discountAmount), 0)
    const monthCGST = monthSales.reduce((s, t) => s + t.cgst, 0)
    const monthSGST = monthSales.reduce((s, t) => s + t.sgst, 0)
    const monthIGST = monthSales.reduce((s, t) => s + t.igst, 0)
    const monthInputTax = purchases.filter(t => t.date >= startOfMonth).reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0)
    const netGSTPayable = (monthCGST + monthSGST + monthIGST) - monthInputTax

    const recentTransactions = allTransactions.slice(0, 8).map(t => ({
      id: t.id,
      type: t.type,
      invoiceNo: t.invoiceNo,
      date: t.date,
      partyName: t.party?.name || 'Walk-in Customer',
      totalAmount: t.totalAmount,
      profit: t.grossProfit,
      paymentMode: t.paymentMode,
      itemsCount: t.items.length,
    }))

    return NextResponse.json({
      setting: setting || { shopName: 'My Shop' },
      kpis: {
        todayRevenue,
        todayProfit,
        todayTxnCount,
        monthRevenue,
        monthProfit,
        monthExpenses,
        monthPurchases,
        monthIncome,
        revenueGrowth,
        profitGrowth,
        netProfit: monthProfit + monthIncome - monthExpenses,
        totalReceivable,
        totalPayable,
        totalStockValue,
        productCount: allProducts.length,
        partyCount: allParties.length,
      },
      salesTrend,
      monthlyTrend,
      topProducts,
      categoryBreakdown,
      paymentModeSplit,
      lowStockProducts,
      gstSummary: {
        taxableSales: monthTaxableSales,
        cgst: monthCGST,
        sgst: monthSGST,
        igst: monthIGST,
        outputTax: monthCGST + monthSGST + monthIGST,
        inputTax: monthInputTax,
        netPayable: netGSTPayable,
      },
      recentTransactions,
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
