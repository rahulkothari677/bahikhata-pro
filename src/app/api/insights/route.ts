import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'

// GET /api/insights - AI-powered smart insights and alerts
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [products, parties, transactions] = await Promise.all([
      db.product.findMany({ where: { userId } }),
      db.party.findMany({ where: { userId } }),
      db.transaction.findMany({ where: { userId }, include: { items: true, party: true } }),
    ])

    const insights: any[] = []
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)

    // Compute current stock
    const stockMap = new Map<string, number>()
    products.forEach(p => stockMap.set(p.id, p.openingStock))
    transactions.forEach(t => {
      t.items.forEach(item => {
        if (item.productId) {
          const current = stockMap.get(item.productId) || 0
          if (t.type === 'purchase') stockMap.set(item.productId, current + item.quantity)
          else if (t.type === 'sale') stockMap.set(item.productId, current - item.quantity)
        }
      })
    })

    // 1. Stock-out predictions based on sales velocity
    products.forEach(p => {
      const stock = stockMap.get(p.id) || 0
      if (stock <= 0) return
      const recentSales = transactions.filter(t => t.type === 'sale' && t.date >= sevenDaysAgo)
      let soldIn7Days = 0
      recentSales.forEach(t => {
        t.items.forEach(item => {
          if (item.productId === p.id) soldIn7Days += item.quantity
        })
      })
      if (soldIn7Days > 0) {
        const dailyVelocity = soldIn7Days / 7
        const daysUntilOut = Math.floor(stock / dailyVelocity)
        if (daysUntilOut <= 7) {
          insights.push({
            id: `stock-${p.id}`,
            type: daysUntilOut <= 3 ? 'critical' : 'warning',
            category: 'stock',
            title: `${p.name} will run out in ${daysUntilOut} days`,
            description: `Selling ${dailyVelocity.toFixed(1)} ${p.unit}/day, current stock: ${stock} ${p.unit}. Reorder soon!`,
            action: 'reorder',
            actionLabel: 'Record Purchase',
            productId: p.id,
          })
        }
      }
    })

    // 2. Out of stock alerts
    products.forEach(p => {
      const stock = stockMap.get(p.id) || 0
      if (stock <= 0) {
        insights.push({
          id: `out-${p.id}`,
          type: 'critical',
          category: 'stock',
          title: `${p.name} is OUT OF STOCK`,
          description: `Restock immediately — you're losing sales.`,
          action: 'reorder',
          actionLabel: 'Record Purchase',
          productId: p.id,
        })
      } else if (stock <= p.lowStockThreshold) {
        insights.push({
          id: `low-${p.id}`,
          type: 'warning',
          category: 'stock',
          title: `${p.name} is below threshold`,
          description: `Stock: ${stock} ${p.unit} (threshold: ${p.lowStockThreshold}). Consider reordering.`,
          action: 'reorder',
          actionLabel: 'Record Purchase',
          productId: p.id,
        })
      }
    })

    // 3. Outstanding dues alerts
    parties.forEach(p => {
      const sales = transactions.filter(t => t.type === 'sale' && t.partyId === p.id)
      const purchases = transactions.filter(t => t.type === 'purchase' && t.partyId === p.id)
      const salesOutstanding = sales.reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0)
      const purchaseOutstanding = purchases.reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0)
      const balance = p.openingBalance + salesOutstanding - purchaseOutstanding

      if (balance > 500) {
        // Find oldest unpaid sale
        const unpaidSales = sales.filter(t => t.totalAmount - t.paidAmount > 0).sort((a, b) => a.date.getTime() - b.date.getTime())
        const oldest = unpaidSales[0]
        const daysOverdue = oldest ? Math.floor((now.getTime() - oldest.date.getTime()) / 86400000) : 0
        insights.push({
          id: `due-${p.id}`,
          type: daysOverdue > 15 ? 'critical' : daysOverdue > 7 ? 'warning' : 'info',
          category: 'dues',
          title: `${p.name} owes you ₹${balance.toFixed(0)}`,
          description: daysOverdue > 0
            ? `Oldest unpaid: ${daysOverdue} days ago. Send a reminder?`
            : `Outstanding balance: ₹${balance.toFixed(0)}`,
          action: 'remind',
          actionLabel: 'Send Reminder',
          partyId: p.id,
          amount: balance,
        })
      }
    })

    // 4. Profit margin insights
    const last30Sales = transactions.filter(t => t.type === 'sale' && t.date >= thirtyDaysAgo)
    const prev30Sales = transactions.filter(t => t.type === 'sale' && t.date < thirtyDaysAgo && t.date >= new Date(thirtyDaysAgo.getTime() - 30 * 86400000))

    if (last30Sales.length > 0 && prev30Sales.length > 0) {
      const lastMargin = last30Sales.reduce((s, t) => s + t.grossProfit, 0) / last30Sales.reduce((s, t) => s + t.totalAmount, 0) * 100
      const prevMargin = prev30Sales.reduce((s, t) => s + t.grossProfit, 0) / prev30Sales.reduce((s, t) => s + t.totalAmount, 0) * 100
      const marginChange = lastMargin - prevMargin

      if (marginChange < -3) {
        insights.push({
          id: 'margin-drop',
          type: 'warning',
          category: 'profit',
          title: `Profit margin dropped ${Math.abs(marginChange).toFixed(1)}%`,
          description: `Current: ${lastMargin.toFixed(1)}% vs previous: ${prevMargin.toFixed(1)}%. Review pricing or costs.`,
          action: 'reports',
          actionLabel: 'View P&L Report',
        })
      } else if (marginChange > 3) {
        insights.push({
          id: 'margin-up',
          type: 'success',
          category: 'profit',
          title: `Profit margin improved ${marginChange.toFixed(1)}%`,
          description: `Current: ${lastMargin.toFixed(1)}% vs previous: ${prevMargin.toFixed(1)}%. Keep it up!`,
          action: 'reports',
          actionLabel: 'View Details',
        })
      }
    }

    // 5. Top performer insights
    const productPerfMap = new Map<string, { name: string; revenue: number; profit: number; qty: number }>()
    last30Sales.forEach(t => {
      t.items.forEach(item => {
        const key = item.productId || item.productName
        const existing = productPerfMap.get(key) || { name: item.productName, revenue: 0, profit: 0, qty: 0 }
        existing.revenue += item.unitPrice * item.quantity
        existing.qty += item.quantity
        const product = products.find(p => p.id === item.productId)
        if (product) existing.profit += (item.unitPrice - product.purchasePrice) * item.quantity
        productPerfMap.set(key, existing)
      })
    })

    const topProduct = Array.from(productPerfMap.values()).sort((a, b) => b.revenue - a.revenue)[0]
    if (topProduct) {
      insights.push({
        id: 'top-product',
        type: 'info',
        category: 'sales',
        title: `${topProduct.name} is your bestseller`,
        description: `₹${topProduct.revenue.toFixed(0)} revenue from ${topProduct.qty} units sold in last 30 days.`,
        action: 'inventory',
        actionLabel: 'View Product',
      })
    }

    // 6. Dead stock detection
    const deadStock = products.filter(p => {
      const stock = stockMap.get(p.id) || 0
      if (stock <= 0) return false
      const recentSales = transactions.filter(t => t.type === 'sale' && t.date >= thirtyDaysAgo)
      let soldIn30Days = 0
      recentSales.forEach(t => {
        t.items.forEach(item => {
          if (item.productId === p.id) soldIn30Days += item.quantity
        })
      })
      return soldIn30Days === 0
    })

    if (deadStock.length > 0) {
      const deadStockValue = deadStock.reduce((s, p) => s + (stockMap.get(p.id) || 0) * p.purchasePrice, 0)
      insights.push({
        id: 'dead-stock',
        type: 'warning',
        category: 'stock',
        title: `${deadStock.length} products with no sales in 30 days`,
        description: `Dead stock worth ₹${deadStockValue.toFixed(0)}. Consider discounting to clear.`,
        action: 'inventory',
        actionLabel: 'View Products',
      })
    }

    // Sort: critical first, then warning, then info/success
    const typeOrder = { critical: 0, warning: 1, info: 2, success: 3 }
    insights.sort((a, b) => typeOrder[a.type as keyof typeof typeOrder] - typeOrder[b.type as keyof typeof typeOrder])

    return NextResponse.json({
      insights,
      summary: {
        total: insights.length,
        critical: insights.filter(i => i.type === 'critical').length,
        warnings: insights.filter(i => i.type === 'warning').length,
      },
    })
  } catch (error) {
    console.error('Insights error:', error)
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 })
  }
}
