import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { fromPaise, roundMoney } from '@/lib/money'
import { LINE_TAXABLE_SQL } from '@/lib/line-taxable-sql'
import { istMonthStart } from '@/lib/timezone'
import { withStockView } from '@/lib/product-stock'
import { stockPotentialProfit } from '@/lib/unit-profit'
import { chargesGstOnSales, gstStatus } from '@/lib/shop-tax'
import { itemsList, ITEM_CHIPS, ITEM_SORTS, type ItemChip, type ItemRow, type ItemSort } from '@/lib/items-list'

/**
 * GET /api/products/list?chip&search&category&sort&offset
 *
 * Phase 5e-2: the Items screen's list, 60 items at a time, with every chip's
 * count, the categories and the totals worked out over ALL the shop's items
 * (lib/items-list.ts). The screen used to load up to 5,000 products and work
 * these out itself. /api/products stays as it is for the pickers and exports;
 * both use the same stock view (lib/product-stock.ts).
 *
 * Sales are this month's (IST), before GST, net of returns — the line value
 * Insights and the reports use (LINE_TAXABLE_SQL).
 */
type Num = unknown
const p2r = (v: Num) => roundMoney(fromPaise(Number(v ?? 0)))

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'inventory')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = authCtx.userId
    const sp = new URL(req.url).searchParams
    const chip = ((ITEM_CHIPS as readonly string[]).includes(sp.get('chip') ?? '') ? sp.get('chip') : 'all') as ItemChip
    const sort = ((ITEM_SORTS as readonly string[]).includes(sp.get('sort') ?? '') ? sp.get('sort') : 'sales') as ItemSort
    const offset = Math.max(0, parseInt(sp.get('offset') || '0') || 0)
    const search = (sp.get('search') || '').slice(0, 100)
    const category = sp.get('category') || null
    const now = new Date()
    const monthStart = istMonthStart(now)

    const [hideProfit, setting, products, sold, month] = await Promise.all([
      shouldHideProfit(userId, authCtx.role),
      db.setting.findUnique({ where: { userId }, select: { compositionCategory: true, gstRegistered: true } }),
      withConnectionRetry(() => db.product.findMany({ where: { userId } })),
      db.$queryRaw<Array<{ pid: string; last: Date }>>`
        SELECT ti."productId" AS "pid", MAX(t."date") AS "last"
        FROM "TransactionItem" ti JOIN "Transaction" t ON t."id" = ti."transactionId"
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'sale' AND ti."productId" IS NOT NULL
        GROUP BY ti."productId"`,
      db.$queryRaw<Array<{ pid: string; sales: Num; qty: Num }>>`
        SELECT ti."productId" AS "pid",
               SUM(CASE WHEN t."type" = 'sale' THEN ${LINE_TAXABLE_SQL} ELSE -${LINE_TAXABLE_SQL} END)::numeric AS "sales",
               SUM(CASE WHEN t."type" = 'sale' THEN ti."quantity" ELSE -ti."quantity" END)::numeric AS "qty"
        FROM "TransactionItem" ti JOIN "Transaction" t ON t."id" = ti."transactionId"
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" IN ('sale', 'credit-note')
          AND t."date" >= ${monthStart} AND t."date" <= ${now} AND ti."productId" IS NOT NULL
        GROUP BY ti."productId"`,
    ])
    const lastMap = new Map(sold.map((r) => [r.pid, new Date(r.last).toISOString()]))
    const monthMap = new Map(month.map((r) => [r.pid, { sales: p2r(r.sales), qty: Number(r.qty ?? 0) }]))
    const rows = products.map((p) => ({
      ...withStockView(p, hideProfit),
      lastSoldAt: lastMap.get(p.id) ?? null,
      salesNow: monthMap.get(p.id)?.sales ?? 0,
      qtyNow: Math.round((monthMap.get(p.id)?.qty ?? 0) * 100) / 100,
    })) as unknown as ItemRow[]
    const list = itemsList(rows, { chip, search, category, sort, offset, now })
    // What the stock would earn if sold at today's prices — the shared unit-profit rule (price before GST
    // for a GST shop). Never for staff who may not see profit.
    const profitOpts = { chargesGst: chargesGstOnSales(gstStatus(setting)) }
    const potentialProfit = hideProfit ? null : roundMoney(products.reduce((s, p) => s + stockPotentialProfit(p, profitOpts), 0))
    return noStore({ chip, sort, offset, category, ...list, totals: { ...list.totals, potentialProfit } })
  } catch (err) {
    return apiError(err, 'Failed to load items', 503)
  }
}
