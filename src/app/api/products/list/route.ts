import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { roundMoney } from '@/lib/money'
import { itemIdsSoldInPeriod, itemSalesInPeriod } from '@/lib/insights-queries'
import { abcGroups } from '@/lib/insights'
import { focusParam, parseItemsFocus } from '@/lib/list-focus'
import { rangeWindow } from '@/lib/period'
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
 * Insights and the reports use — the same per-item query as Insights' Items
 * section (lib/insights-queries.ts), with profit for the profit sort.
 */

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
    const asked = ((ITEM_SORTS as readonly string[]).includes(sp.get('sort') ?? '') ? sp.get('sort') : 'sales') as ItemSort
    const offset = Math.max(0, parseInt(sp.get('offset') || '0') || 0)
    const search = (sp.get('search') || '').slice(0, 100)
    const category = sp.get('category') || null
    const now = new Date()
    const monthStart = istMonthStart(now)
    // Phase 5e-4b: opened from an Insights group (lib/list-focus.ts), counted over the period Insights showed.
    const focus = parseItemsFocus(sp.get('focus'))
    const fw = focus ? rangeWindow(sp.get('from'), sp.get('to'), now) : null
    if (focus && !fw) return NextResponse.json({ error: 'Bad period' }, { status: 400 })

    const [hideProfit, setting, products, sold, month, focusSales, soldInWindow] = await Promise.all([
      shouldHideProfit(userId, authCtx.role),
      db.setting.findUnique({ where: { userId }, select: { compositionCategory: true, gstRegistered: true } }),
      withConnectionRetry(() => db.product.findMany({ where: { userId } })),
      db.$queryRaw<Array<{ pid: string; last: Date }>>`
        SELECT ti."productId" AS "pid", MAX(t."date") AS "last"
        FROM "TransactionItem" ti JOIN "Transaction" t ON t."id" = ti."transactionId"
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'sale' AND ti."productId" IS NOT NULL
        GROUP BY ti."productId"`,
      // This month's sales, quantity and profit per item — the query Insights' Items section uses (lib/insights-queries.ts).
      itemSalesInPeriod(userId, monthStart, now),
      focus?.kind === 'abc' && fw ? itemSalesInPeriod(userId, fw.from, fw.to) : Promise.resolve(null),
      focus?.kind === 'unsold' && fw ? itemIdsSoldInPeriod(userId, fw.from, fw.to) : Promise.resolve(null),
    ])
    const lastMap = new Map(sold.map((r) => [r.pid, new Date(r.last).toISOString()]))
    const monthMap = new Map(month.map((r) => [r.id, r]))
    const rows = products.map((p) => ({
      ...withStockView(p, hideProfit),
      lastSoldAt: lastMap.get(p.id) ?? null,
      salesNow: roundMoney(monthMap.get(p.id)?.sales ?? 0),
      qtyNow: Math.round((monthMap.get(p.id)?.qty ?? 0) * 100) / 100,
      // Never for staff who may not see profit: undefined, so the profit sort is refused below.
      profitNow: hideProfit ? undefined : roundMoney(monthMap.get(p.id)?.profit ?? 0),
    })) as unknown as ItemRow[]
    // Staff who may not see profit cannot order by it (nor by stock value, which is at cost): best sellers instead.
    const sort: ItemSort = hideProfit && (asked === 'profit' || asked === 'value') ? 'sales' : asked
    // Who is in the focused group — Insights' own rules over every item (never ids from the phone).
    let focusIds: Set<string> | null = null
    if (focus?.kind === 'abc' && focusSales) {
      const { classOf } = abcGroups(focusSales, products.length)
      focusIds = new Set(products.filter((p) => (classOf.get(p.id) ?? 'none') === focus.id).map((p) => p.id))
    } else if (focus?.kind === 'unsold' && soldInWindow) {
      // Insights' "not sold this period": goods in stock today with no sale inside the period.
      focusIds = new Set(products.filter((p) => p.tracksInventory === true && p.currentStock > 0 && !soldInWindow.has(p.id)).map((p) => p.id))
    }
    const list = itemsList(rows, { chip, search, category, sort, offset, now, focusIds })
    // What the stock would earn if sold at today's prices — the shared unit-profit rule (price before GST
    // for a GST shop). Never for staff who may not see profit.
    const profitOpts = { chargesGst: chargesGstOnSales(gstStatus(setting)) }
    const potentialProfit = hideProfit ? null : roundMoney(products.reduce((s, p) => s + stockPotentialProfit(p, profitOpts), 0))
    return noStore({ chip, sort, offset, category, focus: focus ? focusParam(focus) : null, ...list, totals: { ...list.totals, potentialProfit } })
  } catch (err) {
    return apiError(err, 'Failed to load items', 503)
  }
}
