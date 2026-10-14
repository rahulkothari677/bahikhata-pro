import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { istDayStart, istMonthStart, sameTimeLastWeek } from '@/lib/timezone'
import { netSalesProfit, netSalesTaxable, netSalesTotal } from '@/lib/net-sales'
import { fromPaise, roundMoney } from '@/lib/money'
import { LINE_TAXABLE_SQL } from '@/lib/line-taxable-sql'
import { listProof, netProfitProof, profitProof, purchasesProof, salesProof, type Proof, type ProofRow } from '@/lib/proof-sheets'

/**
 * GET /api/dashboard/explain?metric=sales|profit|got|purchases|expenses|stock&scope=today|range[&from&to]
 *
 * "How is this worked out?" for a number on Home (Phase 5b-1). Returns the
 * lines that add up to it (lib/proof-sheets.ts) and one comparison.
 *
 * Same definitions as /api/dashboard, through the shared net-sales helpers:
 * sales = bills − returns (totalAmount), profit = sale + credit-note
 * grossProfit, net sales = subtotal − discount net of returns. The database
 * does every sum (groupBy / aggregate); the lists (payments, expenses, stock)
 * are capped at PROOF_LIST_LIMIT and their last line carries the rest, so the
 * total stays right and the screen says the list is partial. Phase 5b-3 added
 * Purchases, Expenses and Stock value (the Business overview cards).
 *
 * Read-only. Profit metrics follow the hide-profit setting, like Home.
 */

const PROOF_LIST_LIMIT = 50
const METRICS = ['sales', 'profit', 'got', 'purchases', 'expenses', 'stock'] as const
type Metric = (typeof METRICS)[number]

interface Window { from: Date; to: Date; prevFrom: Date; prevTo: Date; compareKey: string }

/** Today = IST midnight → now, compared with the same hours a week ago. A range = Home's period, compared with the period before (as /api/dashboard). */
function windowFor(scope: string, fromStr: string | null, toStr: string | null, now: Date): Window | null {
  if (scope === 'today') {
    const lastWeek = sameTimeLastWeek(now)
    return { from: istDayStart(now), to: now, prevFrom: lastWeek.from, prevTo: lastWeek.to, compareKey: 'proof.cmp_last_week' }
  }
  if (scope !== 'range') return null
  const from = fromStr ? new Date(fromStr) : istMonthStart(now)
  const to = toStr ? new Date(toStr) : now
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null
  const dur = to.getTime() - from.getTime()
  return { from, to, prevFrom: new Date(from.getTime() - dur), prevTo: new Date(from.getTime() - 1), compareKey: 'proof.cmp_prev_period' }
}

/** Sums by type for one window: the inputs the net-sales helpers take. */
async function sumsByType(userId: string, from: Date, to: Date, types: string[]) {
  const rows = await db.transaction.groupBy({
    by: ['type'],
    where: activeTransactionWhere(userId, { type: { in: types }, date: { gte: from, lte: to } }),
    _sum: { totalAmount: true, subtotal: true, discountAmount: true, grossProfit: true },
  })
  const of = (type: string) => {
    const r = rows.find((x) => x.type === type)?._sum
    return { totalAmount: r?.totalAmount ?? 0, subtotal: r?.subtotal ?? 0, discountAmount: r?.discountAmount ?? 0, grossProfit: r?.grossProfit ?? 0 }
  }
  return of
}

/**
 * Sales value (before GST, net of returns) of lines with no product behind
 * them. Those lines book no profit — there is no cost price — so the profit
 * sheet shows them on their own line instead of as a cost (proof-sheets.ts).
 * Uses the shared line-taxable SQL, the same definition as the reports.
 */
async function noCostSales(userId: string, from: Date, to: Date): Promise<number> {
  const rows = await db.$queryRaw<Array<{ paise: unknown }>>`
    SELECT COALESCE(SUM(CASE WHEN t."type" = 'sale' THEN ${LINE_TAXABLE_SQL} ELSE -${LINE_TAXABLE_SQL} END), 0)::numeric AS "paise"
    FROM "TransactionItem" ti
    JOIN "Transaction" t ON t."id" = ti."transactionId"
    WHERE t."userId" = ${userId}
      AND t."deletedAt" IS NULL
      AND t."type" IN ('sale', 'credit-note')
      AND t."date" >= ${from} AND t."date" <= ${to}
      AND ti."productId" IS NULL
  `
  return fromPaise(Number(rows[0]?.paise ?? 0))
}

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'dashboard')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = authCtx.userId
    const { searchParams } = new URL(req.url)
    const metric = searchParams.get('metric') as Metric
    if (!METRICS.includes(metric)) return NextResponse.json({ error: 'Unknown metric' }, { status: 400 })
    const w = windowFor(searchParams.get('scope') ?? 'today', searchParams.get('from'), searchParams.get('to'), new Date())
    if (!w) return NextResponse.json({ error: 'Bad period' }, { status: 400 })
    if (metric === 'profit' && await shouldHideProfit(userId, authCtx.role)) {
      return NextResponse.json({ error: 'Profit is hidden for this account' }, { status: 403 })
    }

    let proof: Proof
    let compare: number | null = null
    let count: number | undefined
    let after: number | undefined

    if (metric === 'sales') {
      const [groups, prev] = await withConnectionRetry(() => Promise.all([
        db.transaction.groupBy({
          by: ['type', 'paymentMode'],
          where: activeTransactionWhere(userId, { type: { in: ['sale', 'credit-note'] }, date: { gte: w.from, lte: w.to } }),
          _sum: { totalAmount: true, paidAmount: true },
          _count: { _all: true },
        }),
        sumsByType(userId, w.prevFrom, w.prevTo, ['sale', 'credit-note']),
      ]))
      const s = salesProof(groups.map((g) => ({
        type: g.type, paymentMode: g.paymentMode,
        total: g._sum.totalAmount ?? 0, paid: g._sum.paidAmount ?? 0, count: g._count._all,
      })))
      proof = { total: s.total, rows: s.rows }
      count = s.bills
      compare = netSalesTotal(prev('sale'), prev('credit-note'))
    } else if (metric === 'profit') {
      // Income and expenses too: a period's sheet ends with the figure after them.
      const types = ['sale', 'credit-note', 'income', 'expense']
      const [now, prev, noCost] = await withConnectionRetry(() => Promise.all([
        sumsByType(userId, w.from, w.to, types),
        sumsByType(userId, w.prevFrom, w.prevTo, types),
        noCostSales(userId, w.from, w.to),
      ]))
      const parts = (of: typeof now) => ({
        netSales: netSalesTaxable(of('sale'), of('credit-note')),
        profit: netSalesProfit(of('sale'), of('credit-note')),
        income: of('income').totalAmount,
        expenses: of('expense').totalAmount,
      })
      const current = { ...parts(now), noCost }
      proof = profitProof(current)
      // 5b-3: the period Profit card shows "after expenses" under the figure;
      // the sheet ends with the same number, from the same sums.
      if (w.compareKey === 'proof.cmp_prev_period') after = netProfitProof(current).total
      // The comparison is a total only, so it needs no line split.
      compare = profitProof(parts(prev)).total
    } else if (metric === 'purchases') {
      // Home's figure: purchase totalAmount in the period (returns are not taken off there either).
      const purchaseWhere = activeTransactionWhere(userId, { type: 'purchase', date: { gte: w.from, lte: w.to } })
      const [agg, prev] = await withConnectionRetry(() => Promise.all([
        db.transaction.aggregate({ where: purchaseWhere, _sum: { totalAmount: true, paidAmount: true }, _count: true }),
        sumsByType(userId, w.prevFrom, w.prevTo, ['purchase']),
      ]))
      proof = purchasesProof({ total: roundMoney(agg._sum.totalAmount ?? 0), paid: roundMoney(agg._sum.paidAmount ?? 0) })
      count = agg._count
      compare = roundMoney(prev('purchase').totalAmount)
    } else if (metric === 'expenses') {
      const expenseWhere = activeTransactionWhere(userId, { type: 'expense', date: { gte: w.from, lte: w.to } })
      const [agg, latest, prev] = await withConnectionRetry(() => Promise.all([
        db.transaction.aggregate({ where: expenseWhere, _sum: { totalAmount: true }, _count: true }),
        db.transaction.findMany({
          where: expenseWhere,
          orderBy: { date: 'desc' },
          take: PROOF_LIST_LIMIT,
          select: { totalAmount: true, category: true, payeeName: true, date: true },
        }),
        sumsByType(userId, w.prevFrom, w.prevTo, ['expense']),
      ]))
      const items: ProofRow[] = latest.map((e) => ({
        label: e.category || e.payeeName || '—', date: e.date.toISOString(), amount: roundMoney(e.totalAmount),
      }))
      count = agg._count
      proof = listProof(items, roundMoney(agg._sum.totalAmount ?? 0), agg._count)
      compare = roundMoney(prev('expense').totalAmount)
    } else if (metric === 'stock') {
      // Stock value: the dashboard route's own SQL (goods only, oversold counts
      // as 0, rounded per product), listed most valuable first. A snapshot —
      // no period and no comparison.
      const [totals, top] = await withConnectionRetry(() => Promise.all([
        db.$queryRaw<Array<{ paise: unknown; n: bigint }>>`
          SELECT
            COALESCE(SUM(ROUND(GREATEST("currentStock", 0)::numeric * "purchasePrice"::numeric)) FILTER (WHERE "tracksInventory" = true), 0)::numeric AS "paise",
            COUNT(*) FILTER (WHERE "tracksInventory" = true AND ROUND(GREATEST("currentStock", 0)::numeric * "purchasePrice"::numeric) > 0)::bigint AS "n"
          FROM "Product"
          WHERE "userId" = ${userId}
        `,
        db.$queryRaw<Array<{ name: string; stock: number; unit: string | null; costPaise: number; valuePaise: unknown }>>`
          SELECT "name", "currentStock" AS "stock", "unit", "purchasePrice" AS "costPaise",
                 ROUND(GREATEST("currentStock", 0)::numeric * "purchasePrice"::numeric) AS "valuePaise"
          FROM "Product"
          WHERE "userId" = ${userId} AND "tracksInventory" = true
            AND ROUND(GREATEST("currentStock", 0)::numeric * "purchasePrice"::numeric) > 0
          ORDER BY "valuePaise" DESC, "name" ASC
          LIMIT ${PROOF_LIST_LIMIT}
        `,
      ]))
      const items: ProofRow[] = top.map((r) => ({
        label: r.name, qty: Number(r.stock), unit: r.unit ?? undefined, each: fromPaise(Number(r.costPaise)), amount: fromPaise(Number(r.valuePaise)),
      }))
      count = Number(totals[0]?.n ?? 0)
      proof = listProof(items, fromPaise(Number(totals[0]?.paise ?? 0)), count)
    } else {
      // got: udhaar payments received in the window (Home's "collected" figure).
      const paymentWhere = { userId, type: 'received', deletedAt: null, date: { gte: w.from, lte: w.to } }
      const [agg, latest] = await withConnectionRetry(() => Promise.all([
        db.payment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: true }),
        db.payment.findMany({
          where: paymentWhere,
          orderBy: { date: 'desc' },
          take: PROOF_LIST_LIMIT,
          select: { amount: true, mode: true, party: { select: { name: true } } },
        }),
      ]))
      const items: ProofRow[] = latest.map((p) => ({ label: p.party?.name ?? '—', mode: p.mode, amount: roundMoney(p.amount) }))
      count = agg._count
      proof = listProof(items, roundMoney(agg._sum.amount ?? 0), agg._count)
    }

    return noStore({
      metric,
      from: w.from,
      to: w.to,
      total: proof.total,
      rows: proof.rows,
      count,
      compare: compare === null ? null : { key: w.compareKey, amount: compare },
      after: after === undefined ? null : { key: 'proof.after_expenses', amount: after },
    })
  } catch (error) {
    return apiError(error, 'Failed to explain this figure', 500)
  }
}
