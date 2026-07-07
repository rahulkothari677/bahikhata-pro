import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { getReceivablePayable } from '@/lib/party-balance'

// ⏱️ Vercel serverless timeout — insights aggregates dashboard data and
// may call AI for smart alerts. Set explicit maxDuration.
// (Audit fix Phase 1.3)
export const maxDuration = 60

// GET /api/insights - AI-powered smart insights and alerts
//
// 🔒 AUDIT FIX V7 M1: Was loading ALL transactions (with items + party)
// into memory and re-deriving stock from openingStock + Σ(purchases) − Σ(sales).
// Two problems:
//   1. Scale: unbounded findMany → slow + memory-heavy at scale
//   2. Consistency: re-derived stock disagreed with the `currentStock`
//      column used by dashboard/reports (the single source of truth)
//
// Now: reads `currentStock` from the Product column (O(1)), uses bounded
// queries (last 30 days) for sales-velocity insights, and uses the shared
// getReceivablePayable() helper for outstanding dues. No more loading
// all-time transactions.
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('dashboard')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000)  // for 30-day comparison

    // 🔒 V7 M1: Bounded queries — only fetch what we need, only last 60 days max.
    // Was: db.transaction.findMany({ where: activeTransactionWhere(userId), include: { items, party } })
    // with NO date filter → loaded ALL transactions for the user.
    const [products, salesVelocityRows, topProductRows, productsWithSales30d, recentTransactions, receivablePayable] = await Promise.all([
      // Products — read currentStock column directly (no re-derivation)
      db.product.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          unit: true,
          purchasePrice: true,
          currentStock: true,  // 🔒 V7 M1: use the column, not openingStock
          lowStockThreshold: true,
        },
      }),
      // 🔒 FIX M16: Was `findMany({ include: { items: true } })` loading 60 days
      // of transactions with all items into memory (30K rows at scale → OOM).
      // Now: two targeted queries:
      // 1. SQL GROUP BY for per-product 7-day sales velocity (stock-out predictions)
      // 2. findMany WITHOUT items + take:5000 for header-only needs (dues, margin)
      db.$queryRaw<Array<{ productId: string; totalQty: number }>>`
        SELECT ti."productId", SUM(ti."quantity") AS "totalQty"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."date" >= ${sevenDaysAgo}
        GROUP BY ti."productId"
      `,
      // 🔒 FIX M16: Top product (last 30 days) — SQL aggregate instead of JS loop
      db.$queryRaw<Array<{ productName: string; productId: string | null; totalRevenue: number; totalQty: number }>>`
        SELECT
          ti."productName",
          ti."productId",
          SUM(ROUND(ti."quantity"::numeric * ti."unitPrice"::numeric, 2)) AS "totalRevenue",
          SUM(ti."quantity") AS "totalQty"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."date" >= ${thirtyDaysAgo}
        GROUP BY ti."productName", ti."productId"
        ORDER BY "totalRevenue" DESC
        LIMIT 1
      `,
      // 🔒 FIX M16: Products that had sales in 30 days (for dead-stock detection)
      db.$queryRaw<Array<{ productId: string }>>`
        SELECT DISTINCT ti."productId"
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."date" >= ${thirtyDaysAgo}
          AND ti."productId" IS NOT NULL
      `,
      db.transaction.findMany({
        where: activeTransactionWhere(userId, {
          type: 'sale',
          date: { gte: sixtyDaysAgo },
        }),
        orderBy: { date: 'desc' },
        take: 5000,  // 🔒 FIX M16: defensive cap — prevents OOM at scale
      }),
      // 🔒 V7 H1+H2: Use shared helper for receivable/payable (correct balances)
      getReceivablePayable(userId),
    ])

    const insights: any[] = []

    // Split recent sales into last-30-days and prev-30-days for margin comparison
    const last30Sales = recentTransactions.filter(t => t.date >= thirtyDaysAgo)
    const prev30Sales = recentTransactions.filter(t => t.date < thirtyDaysAgo && t.date >= sixtyDaysAgo)

    // 1. Stock-out predictions based on sales velocity (last 7 days)
    // 🔒 FIX M16: Was O(products × transactions × items) JS loop. Now uses
    // pre-computed SQL GROUP BY result (O(products) lookup).
    const velocityMap = new Map<string, number>()
    for (const row of salesVelocityRows) {
      if (row.productId) velocityMap.set(row.productId, Number(row.totalQty))
    }

    for (const p of products) {
      const stock = p.currentStock  // read the column directly
      if (stock <= 0) continue

      const soldIn7Days = velocityMap.get(p.id) || 0

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
    }

    // 2. Out of stock + low stock alerts (uses currentStock column)
    for (const p of products) {
      const stock = p.currentStock
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
    }

    // 3. Outstanding dues alerts (uses shared helper — correct balances)
    for (const [partyId, balanceInfo] of receivablePayable.partyBalances) {
      const balance = balanceInfo.balance
      if (balance > 500) {
        // Find oldest unpaid sale in the bounded window for the overdue calculation.
        // Note: this is approximate (only looks at last 60 days) — if the oldest
        // unpaid sale is older than 60 days, daysOverdue will be 0. Acceptable
        // for an insights widget; the party detail page has the exact date.
        const partySales = recentTransactions.filter(t => t.partyId === partyId)
        const unpaidSales = partySales
          .filter(t => t.totalAmount - t.paidAmount > 0)
          .sort((a, b) => a.date.getTime() - b.date.getTime())
        const oldest = unpaidSales[0]
        const daysOverdue = oldest ? Math.floor((now.getTime() - oldest.date.getTime()) / 86400000) : 0

        // Get party name (need to fetch — the helper only returns balances)
        // For efficiency, we skip the name lookup here and let the frontend
        // resolve it. If the frontend needs the name, it can fetch the party.
        // For now, use a generic label.
        insights.push({
          id: `due-${partyId}`,
          type: daysOverdue > 15 ? 'critical' : daysOverdue > 7 ? 'warning' : 'info',
          category: 'dues',
          title: `Outstanding: ₹${balance.toFixed(0)}`,
          description: daysOverdue > 0
            ? `Oldest unpaid: ${daysOverdue} days ago. Send a reminder?`
            : `Outstanding balance: ₹${balance.toFixed(0)}`,
          action: 'remind',
          actionLabel: 'Send Reminder',
          partyId,
          amount: balance,
        })
      }
    }

    // 4. Profit margin insights (last 30 days vs prev 30 days)
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

    // 5. Top performer insights (last 30 days) — 🔒 FIX M16: uses SQL aggregate
    const topProduct = topProductRows[0]
    if (topProduct) {
      insights.push({
        id: 'top-product',
        type: 'info',
        category: 'sales',
        title: `${topProduct.productName} is your bestseller`,
        description: `₹${Number(topProduct.totalRevenue).toFixed(0)} revenue from ${Number(topProduct.totalQty)} units sold in last 30 days.`,
        action: 'inventory',
        actionLabel: 'View Product',
      })
    }

    // 6. Dead stock detection (no sales in 30 days, but has stock)
    // 🔒 FIX M16: Was O(products × transactions × items) JS loop. Now uses
    // pre-computed SQL DISTINCT result — O(products) set lookup.
    const productsSold30d = new Set(productsWithSales30d.map(r => r.productId))
    const deadStock = products.filter(p =>
      p.currentStock > 0 && !productsSold30d.has(p.id)
    )

    if (deadStock.length > 0) {
      const deadStockValue = roundMoney(deadStock.reduce((s, p) => s + p.currentStock * p.purchasePrice, 0))
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
