import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { buildConsolidatedReport } from '@/lib/consolidated-reports'

/**
 * GET /api/reports/consolidated?from=&to=
 *
 * 🔒 V17 Audit Phase 7: Returns a consolidated report across ALL shops.
 * Per-shop breakdown + consolidated total. Covers P&L, GST, and stock.
 *
 * Auth: owner or CA (reports module). Staff with reports permission can access.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const now = new Date()
    const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1)
    const to = toStr ? new Date(toStr) : now

    // Fetch all shops for this user
    const shops = await db.shop.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    })

    // If only 1 shop, still return the report (it's the same as per-shop, but
    // structured for the consolidated UI)
    if (shops.length === 0) {
      return NextResponse.json({
        shops: [],
        total: null,
        message: 'No shops found. Create a shop in Settings first.',
      })
    }

    // Fetch all transactions for the user in the date range (all shops)
    // shopId is on Transaction — null means "all shops" (backward compat)
    const transactions = await db.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        date: { gte: from, lte: to },
      },
      select: {
        shopId: true,
        type: true,
        subtotal: true,
        discountAmount: true,
        grossProfit: true,
        totalAmount: true,
        cgst: true,
        sgst: true,
        igst: true,
        paymentMode: true,
        deletedAt: true,
      },
    })

    // Fetch all products for the user (all shops)
    const products = await db.product.findMany({
      where: { userId },
      select: {
        shopId: true,
        currentStock: true,
        purchasePrice: true,
      },
    })

    // Build the consolidated report
    const report = buildConsolidatedReport(shops, transactions, products, from, to)

    return NextResponse.json(report)
  } catch (err) {
    return apiError(err, 'Failed to generate consolidated report', 500)
  }
}
