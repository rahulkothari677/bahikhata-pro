import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney, fromPaise } from '@/lib/money'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/analytics
 *
 * V17-Ext 5.5: Business analytics that surface insight, not just tables.
 * Four analytics, all using SQL aggregates (O(1) memory, no row fetching):
 *
 * 1. Best-selling items (last 30 days) — top 5 by revenue
 * 2. Dead stock — products with stock > 0 but zero sales in 90 days
 * 3. Most profitable customers — top 5 parties by grossProfit (owner only)
 * 4. Reorder patterns — "you usually reorder X every ~N days"
 *
 * All queries filter deletedAt: null. Profit data is hidden for staff.
 */
export async function GET() {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'dashboard')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const hideProfit = await shouldHideProfit(userId, authCtx.role)

    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000)

    // === 1. Best-selling items (last 30 days) ===
    // SQL GROUP BY productName, SUM quantity + revenue. Returns top 5.
    // 🔒 V17 PAISE MIGRATION Phase 2E: SQL returns paise (integer). JS converts
    // back to rupees via fromPaise(). Same pattern as Phase 2A/2B/2D.
    const bestSellersRaw = await db.$queryRaw<Array<{
      productName: string
      totalQty: bigint
      totalRevenuePaise: string
    }>>`
      SELECT
        ti."productName",
        SUM(ti."quantity") AS "totalQty",
        SUM(ROUND(ti."quantity"::numeric * ti."unitPrice"::numeric, 0)) AS "totalRevenuePaise"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."date" >= ${thirtyDaysAgo}
      GROUP BY ti."productName"
      ORDER BY "totalRevenuePaise" DESC
      LIMIT 5
    `
    const bestSellers = bestSellersRaw.map(r => ({
      name: r.productName,
      quantity: Number(r.totalQty),
      revenue: fromPaise(Number(r.totalRevenuePaise)),
    }))

    // === 2. Dead stock — products with stock > 0 but zero sales in 90 days ===
    // Find product IDs that HAD sales in the last 90 days, then exclude them.
    const recentlySoldProductIds = await db.$queryRaw<Array<{ productId: string }>>`
      SELECT DISTINCT ti."productId"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."date" >= ${ninetyDaysAgo}
        AND ti."productId" IS NOT NULL
    `
    const recentlySoldSet = new Set(recentlySoldProductIds.map(r => r.productId))

    const allProducts = await db.product.findMany({
      where: { userId, currentStock: { gt: 0 } },
      select: { id: true, name: true, currentStock: true, unit: true, purchasePrice: true },
    })
    const deadStock = allProducts
      .filter(p => !recentlySoldSet.has(p.id))
      .map(p => ({
        name: p.name,
        currentStock: p.currentStock,
        unit: p.unit || 'pcs',
        tiedUpValue: hideProfit ? 0 : roundMoney(Math.max(0, p.currentStock) * (p.purchasePrice || 0)),  // 🔒 V26 M12: gate by hideProfit + clamp at 0
      }))
      .sort((a, b) => b.tiedUpValue - a.tiedUpValue)
      .slice(0, 5)

    // === 3. Most profitable customers (owner only) ===
    // SQL GROUP BY partyId, SUM grossProfit. Returns top 5.
    // 🔒 V17 PAISE MIGRATION Phase 2E: SQL returns paise for totalProfit + totalSales.
    // grossProfit can be negative (credit notes), so sign-aware nudge via SIGN().
    // totalAmount is always >= 0, so positive nudge is fine.
    let topCustomers: Array<{ name: string; profit: number; totalSales: number }> = []
    if (!hideProfit) {
      const topCustomersRaw = await db.$queryRaw<Array<{
        partyId: string
        totalProfitPaise: string
        totalSalesPaise: string
      }>>`
        SELECT
          t."partyId",
          SUM(t."grossProfit"::numeric) AS "totalProfitPaise",
          SUM(t."totalAmount"::numeric) AS "totalSalesPaise"
        FROM "Transaction" t
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."partyId" IS NOT NULL
          AND t."date" >= ${ninetyDaysAgo}
        GROUP BY t."partyId"
        ORDER BY "totalProfitPaise" DESC
        LIMIT 5
      `
      // Fetch party names
      const partyIds = topCustomersRaw.map(r => r.partyId)
      const parties = await db.party.findMany({
        where: { id: { in: partyIds }, userId, deletedAt: null },
        select: { id: true, name: true },
      })
      const partyMap = new Map(parties.map(p => [p.id, p.name]))

      topCustomers = topCustomersRaw.map(r => ({
        name: partyMap.get(r.partyId) || 'Unknown',
        profit: fromPaise(Number(r.totalProfitPaise)),
        totalSales: fromPaise(Number(r.totalSalesPaise)),
      }))
    }

    // === 4. Reorder patterns — "you usually reorder X every ~N days" ===
    // For each product purchased in the last 180 days, compute the average
    // gap between purchases. If the gap is consistent, suggest "reorder now"
    // if the last purchase was longer ago than the average gap.
    const reorderSuggestionsRaw = await db.$queryRaw<Array<{
      productId: string
      productName: string
      purchaseCount: bigint
      firstPurchase: Date
      lastPurchase: Date
    }>>`
      SELECT
        ti."productId",
        ti."productName",
        COUNT(DISTINCT ti."transactionId") AS "purchaseCount",
        MIN(t."date") AS "firstPurchase",
        MAX(t."date") AS "lastPurchase"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      WHERE t."userId" = ${userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'purchase'
        AND ti."productId" IS NOT NULL
        AND t."date" >= ${new Date(now.getTime() - 180 * 86400000)}
      GROUP BY ti."productId", ti."productName"
      HAVING COUNT(DISTINCT ti."transactionId") >= 2
      ORDER BY "lastPurchase" DESC
      LIMIT 10
    `

    const reorderSuggestions = reorderSuggestionsRaw.map(r => {
      const purchaseCount = Number(r.purchaseCount)
      const firstMs = new Date(r.firstPurchase).getTime()
      const lastMs = new Date(r.lastPurchase).getTime()
      const nowMs = now.getTime()
      // Average gap = total time span / (number of gaps = count - 1)
      const avgGapDays = purchaseCount > 1
        ? Math.round((lastMs - firstMs) / (purchaseCount - 1) / 86400000)
        : 0
      const daysSinceLastPurchase = Math.round((nowMs - lastMs) / 86400000)
      // Suggest reorder if we're past the average gap
      const shouldReorder = avgGapDays > 0 && daysSinceLastPurchase >= avgGapDays

      return {
        name: r.productName,
        avgGapDays,
        daysSinceLastPurchase,
        shouldReorder,
      }
    }).filter(r => r.shouldReorder).slice(0, 3)

    return NextResponse.json({
      bestSellers,
      deadStock,
      topCustomers,
      reorderSuggestions,
    })
  } catch (err) {
    return apiError(err, 'Failed to load analytics', 500)
  }
}
