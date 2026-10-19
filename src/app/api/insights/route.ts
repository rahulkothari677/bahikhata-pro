import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { fromPaise, roundMoney } from '@/lib/money'
import { LINE_TAXABLE_SQL } from '@/lib/line-taxable-sql'
import { istLocal } from '@/lib/ist-sql'
import { getReceivablePayable } from '@/lib/party-balance'
import { netSalesProfit, netSalesTaxable, netSalesTotal } from '@/lib/net-sales'
import { rangeWindow } from '@/lib/period'
import { trendBuckets } from '@/lib/trend-buckets'
import { abcGroups, customerGroups, remainder, split, TYPED_IN, udhaarAge, UNMATCHED } from '@/lib/insights'
import { oldestDueSaleSql } from '@/lib/invoice-due-sql'
import { WALK_IN_PARTY_NAME } from '@/lib/walk-in-party'
import { DEAD_DAYS } from '@/lib/stock-aging'

/**
 * GET /api/insights?section=sales|items|customers|udhaar|profit[&from&to]
 *
 * Phase 5c (ledger model v4 §2–3): the ONE insights engine. It replaces the
 * old alert feed here (critical/warning cards — the v3 "feed of insight cards"
 * that v4 removed) and, in 5c-4, the client rules in SmartInsights.tsx (#240:
 * two engines describing one thing).
 *
 * Read-only. The database does every sum and count; lib/insights.ts only
 * arranges the totals it returns into groups that add up to the whole. The
 * same definitions as Home and Reports: sales = sale − credit-note
 * totalAmount; item sales = line value before GST (the shared line-taxable
 * SQL) net of returns; profit = stored grossProfit, per line the same
 * line-items.ts rule through purchasePriceAtSale. Group rows summed from lines
 * add up to the bills' own totals; any gap is its own row (`remainder`).
 * Lists are top 10; every group carries its count, so a list is never mistaken
 * for the whole. Profit follows the hide-profit setting.
 */

export const maxDuration = 60
const SECTIONS = ['sales', 'items', 'customers', 'udhaar', 'profit'] as const
type Section = (typeof SECTIONS)[number]
const TOP = 10

type Num = unknown
const p2r = (v: Num) => fromPaise(Number(v ?? 0))

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'dashboard')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = authCtx.userId
    const { searchParams } = new URL(req.url)
    const section = (searchParams.get('section') ?? 'sales') as Section
    if (!SECTIONS.includes(section)) return NextResponse.json({ error: 'Unknown section' }, { status: 400 })
    const now = new Date()
    const w = rangeWindow(searchParams.get('from'), searchParams.get('to'), now)
    if (!w) return NextResponse.json({ error: 'Bad period' }, { status: 400 })
    const hideProfit = await shouldHideProfit(userId, authCtx.role)
    if (section === 'profit' && hideProfit) return NextResponse.json({ error: 'Profit is hidden for this account' }, { status: 403 })

    const ctx = { userId, w, now, hideProfit }
    const body: object = await withConnectionRetry((): Promise<object> => (
      section === 'sales' ? salesSection(ctx)
        : section === 'items' ? itemsSection(ctx)
        : section === 'customers' ? customersSection(ctx)
        : section === 'udhaar' ? udhaarSection(ctx)
        : profitSection(ctx)
    ))
    return noStore({ section, from: w.from, to: w.to, ...body })
  } catch (error) {
    return apiError(error, 'Failed to load insights', 500)
  }
}

interface Ctx { userId: string; w: NonNullable<ReturnType<typeof rangeWindow>>; now: Date; hideProfit: boolean }

/** Sums by type in a window (the net-sales helpers' inputs). */
async function sumsByType(userId: string, from: Date, to: Date, types: string[]) {
  const rows = await db.transaction.groupBy({
    by: ['type'],
    where: activeTransactionWhere(userId, { type: { in: types }, date: { gte: from, lte: to } }),
    _sum: { totalAmount: true, subtotal: true, discountAmount: true, grossProfit: true, paidAmount: true },
    _count: { _all: true },
  })
  return (type: string) => {
    const r = rows.find((x) => x.type === type)
    return {
      totalAmount: r?._sum.totalAmount ?? 0, subtotal: r?._sum.subtotal ?? 0, discountAmount: r?._sum.discountAmount ?? 0,
      grossProfit: r?._sum.grossProfit ?? 0, paidAmount: r?._sum.paidAmount ?? 0, count: r?._count._all ?? 0,
    }
  }
}

/** Per-line value before GST, signed: + for a sale, − for a return. Table aliases ti / t. */
const SIGNED_LINE = Prisma.sql`(CASE WHEN t."type" = 'sale' THEN ${LINE_TAXABLE_SQL} ELSE -${LINE_TAXABLE_SQL} END)`
/**
 * Per-line profit, signed — exactly what lib/line-items.ts booked on the line:
 * value − Math.round(qty × cost at sale). FLOOR(x + 0.5) on the float product
 * is Math.round to the bit (both IEEE doubles); ROUND on a numeric would round
 * 100.49999999999999 up, and ROUND on a double rounds 50.5 to even.
 * A typed-in line (no item) booked no profit, so it is 0 here too.
 */
const SIGNED_PROFIT = Prisma.sql`(CASE WHEN ti."productId" IS NULL THEN 0 WHEN t."type" = 'sale' THEN 1 ELSE -1 END) * (${LINE_TAXABLE_SQL} - FLOOR(ti."quantity"::float8 * ti."purchasePriceAtSale"::float8 + 0.5::float8)::numeric)`
/** What a bill left unpaid at the counter (never below 0). One rule for Sales → udhaar and Udhaar → given on credit. */
const UNPAID_ON_BILL = Prisma.sql`GREATEST("totalAmount" - "paidAmount", 0)`
const SALE_LINES = (userId: string, from: Date, to: Date) => Prisma.sql`
  FROM "TransactionItem" ti
  JOIN "Transaction" t ON t."id" = ti."transactionId"
  LEFT JOIN "Product" p ON p."id" = ti."productId"
  WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL
    AND t."type" IN ('sale', 'credit-note')
    AND t."date" >= ${from} AND t."date" <= ${to}`

// ─── Sales ──────────────────────────────────────────────────────────────

async function salesSection({ userId, w }: Ctx) {
  const [sums, prevSums, modes, days, hours, cats] = await Promise.all([
    sumsByType(userId, w.from, w.to, ['sale', 'credit-note']),
    sumsByType(userId, w.prevFrom, w.prevTo, ['sale', 'credit-note']),
    // Each bill splits exactly: paid at the counter (up to its total), and the rest unpaid —
    // on a customer's khata (udhaar), or on no khata at all (a walk-in bill left unpaid).
    db.$queryRaw<Array<{ mode: string | null; paid: Num; udhaar: Num; nobody: Num }>>`
      SELECT "paymentMode" AS "mode",
             COALESCE(SUM(LEAST("paidAmount", "totalAmount")), 0)::numeric AS "paid",
             COALESCE(SUM(${UNPAID_ON_BILL}) FILTER (WHERE "partyId" IS NOT NULL), 0)::numeric AS "udhaar",
             COALESCE(SUM(${UNPAID_ON_BILL}) FILTER (WHERE "partyId" IS NULL), 0)::numeric AS "nobody"
      FROM "Transaction"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "type" = 'sale'
        AND "date" >= ${w.from} AND "date" <= ${w.to}
      GROUP BY 1`,
    w.days <= 62 ? db.$queryRaw<Array<{ day: Date; paise: Num }>>`
      SELECT DATE_TRUNC('day', ${istLocal('"date"')}) AS "day",
             SUM(CASE WHEN "type" = 'sale' THEN "totalAmount" ELSE -"totalAmount" END)::numeric AS "paise"
      FROM "Transaction"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "type" IN ('sale', 'credit-note')
        AND "date" >= ${w.from} AND "date" <= ${w.to}
      GROUP BY 1` : Promise.resolve([]),
    db.$queryRaw<Array<{ hour: number; paise: Num; bills: bigint }>>`
      SELECT EXTRACT(HOUR FROM ${istLocal('"date"')})::int AS "hour", SUM("totalAmount")::numeric AS "paise", COUNT(*)::bigint AS "bills"
      FROM "Transaction"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "type" = 'sale'
        AND "date" >= ${w.from} AND "date" <= ${w.to}
      GROUP BY 1`,
    db.$queryRaw<Array<{ category: string | null; paise: Num }>>`
      SELECT p."category" AS "category", SUM(${SIGNED_LINE})::numeric AS "paise"
      ${SALE_LINES(userId, w.from, w.to)}
      GROUP BY p."category"`,
  ])
  const sale = sums('sale'), ret = sums('credit-note')
  const sales = netSalesTotal(sale, ret)
  const bills = sale.count
  // How bills were paid — shares of the bills' value; the rows add up to it to the paisa.
  // A paid part beyond a bill's total is change or an advance, not part of the bill.
  const byMode = new Map<string, number>()
  let udhaar = 0, nobody = 0
  for (const m of modes) {
    const mode = ['cash', 'upi', 'card', 'bank'].includes(m.mode ?? '') ? m.mode! : 'other'
    byMode.set(mode, roundMoney((byMode.get(mode) ?? 0) + p2r(m.paid)))
    udhaar = roundMoney(udhaar + p2r(m.udhaar))
    nobody = roundMoney(nobody + p2r(m.nobody))
  }
  const payments = split([...[...byMode].map(([id, amount]) => ({ id, amount })), { id: 'udhaar', amount: udhaar }, { id: 'nobody', amount: nobody }])
  const dayMap = new Map<string, number>(days.map((d) => [new Date(d.day).toISOString(), p2r(d.paise)] as [string, number]))
  const calendar = w.days <= 62 ? trendBuckets(w.from, w.to, 'day').map((b) => ({ day: b.key, label: b.label, amount: dayMap.get(b.key) ?? 0 })) : []
  const hourRows = Array.from({ length: 24 }, (_, h) => {
    const r = hours.find((x) => Number(x.hour) === h)
    return { hour: h, perDay: r ? roundMoney(p2r(r.paise) / w.days) : 0, bills: r ? Number(r.bills) : 0 }
  })
  // Categories split the sales before GST; their rows add up to the bills' own figure, any gap its own row.
  const beforeGst = netSalesTaxable(sale, ret)
  const catRows = cats.map((c) => ({ id: c.category || '', amount: p2r(c.paise) }))
  const unmatched = remainder(beforeGst, catRows.map((c) => c.amount))
  if (unmatched !== 0) catRows.push({ id: UNMATCHED, amount: unmatched })
  return {
    totals: { sales, bills, averageBill: bills > 0 ? roundMoney(sales / bills) : 0, returns: ret.totalAmount, previous: netSalesTotal(prevSums('sale'), prevSums('credit-note')) },
    payments, billsValue: sale.totalAmount, calendar, hours: hourRows,
    categories: split(catRows), beforeGst, unmatched,
  }
}

// ─── Items ──────────────────────────────────────────────────────────────

async function itemsSection({ userId, w, now, hideProfit }: Ctx) {
  // Dead stock: the shared rule (lib/stock-aging.ts) — no sale in DEAD_DAYS, and on the books that long.
  const since90 = new Date(now.getTime() - DEAD_DAYS * 86_400_000)
  const [perItem, productStats, notSold, productCount] = await Promise.all([
    db.$queryRaw<Array<{ id: string; name: string; sales: Num; qty: Num; profit: Num }>>`
      SELECT ti."productId" AS "id", MAX(p."name") AS "name",
             SUM(${SIGNED_LINE})::numeric AS "sales",
             SUM(CASE WHEN t."type" = 'sale' THEN ti."quantity" ELSE -ti."quantity" END)::numeric AS "qty",
             SUM(${SIGNED_PROFIT})::numeric AS "profit"
      ${SALE_LINES(userId, w.from, w.to)} AND ti."productId" IS NOT NULL
      GROUP BY ti."productId"`,
    db.$queryRaw<Array<{ outCount: bigint; lowCount: bigint; stockPaise: Num }>>`
      SELECT
        COUNT(*) FILTER (WHERE "tracksInventory" = true AND "currentStock" <= 0)::bigint AS "outCount",
        COUNT(*) FILTER (WHERE "tracksInventory" = true AND "currentStock" > 0 AND "currentStock" <= "lowStockThreshold")::bigint AS "lowCount",
        COALESCE(SUM(ROUND(GREATEST("currentStock", 0)::numeric * "purchasePrice"::numeric)) FILTER (WHERE "tracksInventory" = true), 0)::numeric AS "stockPaise"
      FROM "Product" WHERE "userId" = ${userId}`,
    // Goods in stock today with no sale inside the period, and with none in the last 90 days, with the stock they hold.
    // Inside the period, not "last sale before it": viewing September in October, an item sold only in
    // October was not sold in September (5c-3 fix — the old test looked only at the last sale).
    db.$queryRaw<Array<{ periodCount: bigint; periodPaise: Num; d90Count: bigint; d90Paise: Num }>>`
      WITH sp AS (
        SELECT DISTINCT ti."productId" AS pid
        FROM "TransactionItem" ti JOIN "Transaction" t ON t."id" = ti."transactionId"
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'sale'
          AND t."date" >= ${w.from} AND t."date" <= ${w.to} AND ti."productId" IS NOT NULL
      ), s90 AS (
        SELECT DISTINCT ti."productId" AS pid
        FROM "TransactionItem" ti JOIN "Transaction" t ON t."id" = ti."transactionId"
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'sale'
          AND t."date" >= ${since90} AND ti."productId" IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE sp.pid IS NULL)::bigint AS "periodCount",
        COALESCE(SUM(ROUND(GREATEST(p."currentStock", 0)::numeric * p."purchasePrice"::numeric)) FILTER (WHERE sp.pid IS NULL), 0)::numeric AS "periodPaise",
        COUNT(*) FILTER (WHERE s90.pid IS NULL AND p."createdAt" < ${since90})::bigint AS "d90Count",
        COALESCE(SUM(ROUND(GREATEST(p."currentStock", 0)::numeric * p."purchasePrice"::numeric)) FILTER (WHERE s90.pid IS NULL AND p."createdAt" < ${since90}), 0)::numeric AS "d90Paise"
      FROM "Product" p LEFT JOIN sp ON sp.pid = p."id" LEFT JOIN s90 ON s90.pid = p."id"
      WHERE p."userId" = ${userId} AND p."tracksInventory" = true AND p."currentStock" > 0`,
    db.product.count({ where: { userId } }),
  ])
  const items = perItem.map((r) => ({ id: r.id, name: r.name ?? '—', sales: p2r(r.sales), qty: Number(r.qty ?? 0), profit: p2r(r.profit) }))
  const { groups } = abcGroups(items, productCount)
  const sold = items.filter((x) => x.sales > 0).length
  const st = productStats[0], ns = notSold[0]
  const top = (key: 'sales' | 'qty' | 'profit') => [...items].filter((x) => x[key] > 0)
    .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, TOP)
    .map((x) => ({ id: x.id, name: x.name, sales: x.sales, qty: Math.round(x.qty * 100) / 100, profit: hideProfit ? null : x.profit }))
  return {
    totals: { sold, items: productCount, stockValue: p2r(st?.stockPaise), outOfStock: Number(st?.outCount ?? 0) },
    abc: groups,
    stock: {
      out: Number(st?.outCount ?? 0), low: Number(st?.lowCount ?? 0),
      notSoldPeriod: { count: Number(ns?.periodCount ?? 0), stockValue: p2r(ns?.periodPaise) },
      notSold90: { count: Number(ns?.d90Count ?? 0), stockValue: p2r(ns?.d90Paise) },
    },
    top: { sales: top('sales'), qty: top('qty'), profit: hideProfit ? [] : top('profit') },
  }
}

// ─── Customers ──────────────────────────────────────────────────────────

async function customersSection({ userId, w, hideProfit }: Ctx) {
  const [activity, customerCount, walkIn] = await Promise.all([
    db.$queryRaw<Array<{ id: string; name: string; billsNow: bigint; salesNow: Num; profitNow: Num; billsPrev: bigint; salesPrev: Num; firstBill: Date | null }>>`
      WITH a AS (
        SELECT t."partyId" AS pid,
          COUNT(*) FILTER (WHERE t."type" = 'sale' AND t."date" >= ${w.from} AND t."date" <= ${w.to})::bigint AS "billsNow",
          COALESCE(SUM(CASE WHEN t."type" = 'sale' THEN t."totalAmount" ELSE -t."totalAmount" END) FILTER (WHERE t."date" >= ${w.from} AND t."date" <= ${w.to}), 0)::numeric AS "salesNow",
          COALESCE(SUM(t."grossProfit") FILTER (WHERE t."date" >= ${w.from} AND t."date" <= ${w.to}), 0)::numeric AS "profitNow",
          COUNT(*) FILTER (WHERE t."type" = 'sale' AND t."date" >= ${w.prevFrom} AND t."date" <= ${w.prevTo})::bigint AS "billsPrev",
          COALESCE(SUM(CASE WHEN t."type" = 'sale' THEN t."totalAmount" ELSE -t."totalAmount" END) FILTER (WHERE t."date" >= ${w.prevFrom} AND t."date" <= ${w.prevTo}), 0)::numeric AS "salesPrev"
        FROM "Transaction" t
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" IN ('sale', 'credit-note')
          AND t."partyId" IS NOT NULL AND t."date" >= ${w.prevFrom} AND t."date" <= ${w.to}
        GROUP BY t."partyId"
      )
      SELECT a.pid AS "id", p."name" AS "name", a."billsNow", a."salesNow", a."profitNow", a."billsPrev", a."salesPrev",
        (SELECT MIN(t2."date") FROM "Transaction" t2 WHERE t2."userId" = ${userId} AND t2."partyId" = a.pid AND t2."deletedAt" IS NULL AND t2."type" = 'sale') AS "firstBill"
      FROM a JOIN "Party" p ON p."id" = a.pid AND p."deletedAt" IS NULL AND LOWER(p."name") <> LOWER(${WALK_IN_PARTY_NAME})`,
    db.party.count({ where: { userId, deletedAt: null, type: { in: ['customer', 'both'] }, NOT: { name: { equals: WALK_IN_PARTY_NAME, mode: 'insensitive' } } } }),
    sumsByType(userId, w.from, w.to, ['sale', 'credit-note']).then(async (all) => {
      const named = await db.transaction.groupBy({
        by: ['type'],
        where: activeTransactionWhere(userId, { type: { in: ['sale', 'credit-note'] }, partyId: { not: null }, party: { NOT: { name: { equals: WALK_IN_PARTY_NAME, mode: 'insensitive' } } }, date: { gte: w.from, lte: w.to } }),
        _sum: { totalAmount: true },
      })
      const n = (t: string) => ({ totalAmount: named.find((x) => x.type === t)?._sum.totalAmount ?? 0 })
      return { total: netSalesTotal(all('sale'), all('credit-note')), named: netSalesTotal(n('sale'), n('credit-note')) }
    }),
  ])
  const rows = activity.map((r) => ({
    id: r.id, name: r.name, billsNow: Number(r.billsNow), salesNow: p2r(r.salesNow), profitNow: p2r(r.profitNow),
    billsPrev: Number(r.billsPrev), salesPrev: p2r(r.salesPrev), firstBill: r.firstBill ? new Date(r.firstBill) : null,
  }))
  const groups = customerGroups(rows, w.from)
  // Customers with no bill in either period are not in `activity`; they are inactive.
  const counted = groups.reduce((s, g) => s + g.count, 0)
  const inactive = groups.find((g) => g.id === 'inactive')!
  inactive.count += Math.max(0, customerCount - counted)
  const bought = rows.filter((r) => r.billsNow > 0).length
  const walkInSales = roundMoney(walkIn.total - walkIn.named)
  const top = (key: 'salesNow' | 'profitNow' | 'billsNow') => rows.filter((r) => r[key] > 0)
    .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, TOP)
    .map((r) => ({ id: r.id, name: r.name, sales: r.salesNow, bills: r.billsNow, profit: hideProfit ? null : r.profitNow }))
  const namedVsWalkIn = split([{ id: 'named', amount: walkIn.named }, { id: 'walkin', amount: walkInSales }])
  return {
    totals: { bought, customers: Math.max(customerCount, counted), newCount: groups.find((g) => g.id === 'new')!.count, walkInShare: namedVsWalkIn.find((g) => g.id === 'walkin')?.share ?? 0 },
    groups,
    namedVsWalkIn,
    top: { sales: top('salesNow'), bills: top('billsNow'), profit: hideProfit ? [] : top('profitNow') },
  }
}

// ─── Udhaar (as of today) ───────────────────────────────────────────────

async function udhaarSection({ userId, w, now }: Ctx) {
  const [rp, oldest, collected, given] = await Promise.all([
    getReceivablePayable(userId),
    // Oldest bill still due — computeInvoiceDue's rule in SQL (lib/invoice-due-sql.ts):
    // payments settled against a bill later count, so a cleared bill is not "old udhaar".
    db.$queryRaw<Array<{ partyId: string; oldest: Date }>>(oldestDueSaleSql(userId)),
    db.payment.aggregate({ where: { userId, deletedAt: null, type: 'received', date: { gte: w.from, lte: w.to } }, _sum: { amount: true } }),
    db.$queryRaw<Array<{ paise: Num }>>`
      SELECT COALESCE(SUM(${UNPAID_ON_BILL}), 0)::numeric AS "paise"
      FROM "Transaction"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "type" = 'sale' AND "partyId" IS NOT NULL
        AND "date" >= ${w.from} AND "date" <= ${w.to}`,
  ])
  const oldestMap = new Map(oldest.map((r) => [r.partyId, new Date(r.oldest)]))
  const balances = [...rp.partyBalances].map(([id, b]) => ({ id, balance: b.balance, oldestUnpaid: oldestMap.get(id) ?? null }))
  const age = udhaarAge(balances, now)
  const owing = balances.filter((b) => b.balance > 0).sort((a, b) => b.balance - a.balance)
  const owed = balances.filter((b) => b.balance < 0).sort((a, b) => a.balance - b.balance)
  const ids = [...owing.slice(0, TOP), ...owed.slice(0, 5)].map((b) => b.id)
  const names = new Map((await db.party.findMany({ where: { id: { in: ids }, userId }, select: { id: true, name: true } })).map((p) => [p.id, p.name]))
  return {
    totals: { toCollect: rp.totalReceivable, customers: owing.length, collected: roundMoney(collected._sum.amount ?? 0), given: p2r(given[0]?.paise) },
    age,
    biggest: owing.slice(0, TOP).map((b) => ({ id: b.id, name: names.get(b.id) ?? '—', balance: b.balance, oldestUnpaid: b.oldestUnpaid })),
    toPay: { total: rp.totalPayable, suppliers: owed.length, biggest: owed.slice(0, 5).map((b) => ({ id: b.id, name: names.get(b.id) ?? '—', balance: -b.balance })) },
  }
}

// ─── Profit ─────────────────────────────────────────────────────────────

async function profitSection({ userId, w }: Ctx) {
  const [sums, prevSums, cats, perItem, costUp] = await Promise.all([
    sumsByType(userId, w.from, w.to, ['sale', 'credit-note', 'income', 'expense']),
    sumsByType(userId, w.prevFrom, w.prevTo, ['sale', 'credit-note']),
    // Every line, by the item's category; typed-in lines (no item, no cost price) as their own row.
    db.$queryRaw<Array<{ category: string; sales: Num; profit: Num }>>`
      SELECT CASE WHEN ti."productId" IS NULL THEN ${TYPED_IN} ELSE COALESCE(p."category", '') END AS "category",
             SUM(${SIGNED_LINE})::numeric AS "sales", SUM(${SIGNED_PROFIT})::numeric AS "profit"
      ${SALE_LINES(userId, w.from, w.to)}
      GROUP BY 1`,
    db.$queryRaw<Array<{ id: string; name: string; sales: Num; profit: Num }>>`
      SELECT ti."productId" AS "id", MAX(p."name") AS "name", SUM(${SIGNED_LINE})::numeric AS "sales", SUM(${SIGNED_PROFIT})::numeric AS "profit"
      ${SALE_LINES(userId, w.from, w.to)} AND ti."productId" IS NOT NULL
      GROUP BY ti."productId"`,
    // The last two purchase prices of each product: where the latest is higher, the cost went up.
    db.$queryRaw<Array<{ id: string; name: string; salePrice: Num; latest: Num; previous: Num; latestDate: Date }>>`
      WITH buys AS (
        SELECT ti."productId" AS pid, ti."unitPrice" AS cost, t."date" AS d,
               ROW_NUMBER() OVER (PARTITION BY ti."productId" ORDER BY t."date" DESC, t."id" DESC) AS rn
        FROM "TransactionItem" ti JOIN "Transaction" t ON t."id" = ti."transactionId"
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."type" = 'purchase'
          AND ti."productId" IS NOT NULL AND ti."unitPrice" > 0
      )
      SELECT p."id", p."name", p."salePrice" AS "salePrice", l.cost AS "latest", pr.cost AS "previous", l.d AS "latestDate"
      FROM buys l
      JOIN buys pr ON pr.pid = l.pid AND pr.rn = 2
      JOIN "Product" p ON p."id" = l.pid
      WHERE l.rn = 1 AND l.cost > pr.cost
      ORDER BY (l.cost - pr.cost)::numeric / NULLIF(pr.cost, 0) DESC
      LIMIT ${TOP}`,
  ])
  const sale = sums('sale'), ret = sums('credit-note')
  const netSales = netSalesTaxable(sale, ret)
  const profit = netSalesProfit(sale, ret)
  const income = sums('income').totalAmount, expenses = sums('expense').totalAmount
  const rows = cats.map((c) => ({ id: c.category, sales: p2r(c.sales), profit: p2r(c.profit) }))
  // The rows add up to the Home figures; whatever does not is shown, never spread or dropped.
  const unmatched = { sales: remainder(netSales, rows.map((r) => r.sales)), profit: remainder(profit, rows.map((r) => r.profit)) }
  if (unmatched.sales !== 0 || unmatched.profit !== 0) rows.push({ id: UNMATCHED, ...unmatched })
  const byCategory = rows
    .sort((a, b) => b.profit - a.profit || a.id.localeCompare(b.id))
    .map((c) => ({ ...c, margin: c.sales > 0 && c.id !== TYPED_IN && c.id !== UNMATCHED ? Math.round((c.profit / c.sales) * 1000) / 10 : null }))
  const lowest = perItem.map((r) => ({ id: r.id, name: r.name ?? '—', sales: p2r(r.sales), profit: p2r(r.profit) }))
    .filter((r) => r.sales >= 300)
    .map((r) => ({ ...r, margin: Math.round((r.profit / r.sales) * 1000) / 10 }))
    .sort((a, b) => a.margin - b.margin || a.name.localeCompare(b.name)).slice(0, TOP)
  return {
    totals: {
      profit, netSales, margin: netSales > 0 ? Math.round((profit / netSales) * 1000) / 10 : null,
      previous: netSalesProfit(prevSums('sale'), prevSums('credit-note')),
      afterExpenses: roundMoney(profit + income - expenses), expenses, income,
    },
    unmatched,
    byCategory, lowest,
    costUp: costUp.map((r) => {
      const sp = p2r(r.salePrice), latest = p2r(r.latest), previous = p2r(r.previous)
      return { id: r.id, name: r.name, previous, latest, salePrice: sp, earnNow: roundMoney(sp - latest), earnBefore: roundMoney(sp - previous), date: r.latestDate }
    }),
  }
}
