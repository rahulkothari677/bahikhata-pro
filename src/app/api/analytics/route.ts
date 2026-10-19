import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { fromPaise } from '@/lib/money'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/analytics
 *
 * V17-Ext 5.5: Business analytics that surface insight, not just tables.
 * Four analytics, all using SQL aggregates (O(1) memory, no row fetching):
 *
 * (Phase 5c-4: best sellers and dead stock were removed with the Business
 *  Analytics card — #240, one engine. Top items come from the dashboard route,
 *  dead stock from the insights engine and Inventory Aging, lib/stock-aging.ts.)
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
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000)

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
      topCustomers,
      reorderSuggestions,
    })
  } catch (err) {
    return apiError(err, 'Failed to load analytics', 500)
  }
}
