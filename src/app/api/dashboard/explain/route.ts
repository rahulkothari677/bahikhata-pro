import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { istDayStart, istMonthStart } from '@/lib/timezone'
import { netSalesProfit, netSalesTaxable, netSalesTotal } from '@/lib/net-sales'
import { fromPaise, roundMoney } from '@/lib/money'
import { LINE_TAXABLE_SQL } from '@/lib/line-taxable-sql'
import { listProof, netProfitProof, profitProof, salesProof, type Proof, type ProofRow } from '@/lib/proof-sheets'

/**
 * GET /api/dashboard/explain?metric=sales|profit|netProfit|got&scope=today|range[&from&to]
 *
 * "How is this worked out?" for a number on Home (Phase 5b-1). Returns the
 * lines that add up to it (lib/proof-sheets.ts) and one comparison.
 *
 * Same definitions as /api/dashboard, through the shared net-sales helpers:
 * sales = bills − returns (totalAmount), profit = sale + credit-note
 * grossProfit, net sales = subtotal − discount net of returns. The database
 * does every sum (groupBy / aggregate); the only list (payments) is capped at
 * PROOF_LIST_LIMIT and its last line carries the rest, so the total stays
 * right and the screen says the list is partial.
 *
 * Read-only. Profit metrics follow the hide-profit setting, like Home.
 */

const WEEK_MS = 7 * 86_400_000
const PROOF_LIST_LIMIT = 50
const METRICS = ['sales', 'profit', 'netProfit', 'got'] as const
type Metric = (typeof METRICS)[number]

interface Window { from: Date; to: Date; prevFrom: Date; prevTo: Date; compareKey: string }

/** Today = IST midnight → now, compared with the same hours a week ago. A range = Home's period, compared with the period before (as /api/dashboard). */
function windowFor(scope: string, fromStr: string | null, toStr: string | null, now: Date): Window | null {
  if (scope === 'today') {
    const from = istDayStart(now)
    return { from, to: now, prevFrom: new Date(from.getTime() - WEEK_MS), prevTo: new Date(now.getTime() - WEEK_MS), compareKey: 'proof.cmp_last_week' }
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
    if ((metric === 'profit' || metric === 'netProfit') && await shouldHideProfit(userId, authCtx.role)) {
      return NextResponse.json({ error: 'Profit is hidden for this account' }, { status: 403 })
    }

    let proof: Proof
    let compare: number | null = null
    let count: number | undefined

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
    } else if (metric === 'profit' || metric === 'netProfit') {
      const types = metric === 'profit' ? ['sale', 'credit-note'] : ['sale', 'credit-note', 'income', 'expense']
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
      proof = metric === 'profit' ? profitProof(current) : netProfitProof(current)
      // The comparison is a total only, so it needs no line split.
      compare = (metric === 'profit' ? profitProof(parts(prev)) : netProfitProof(parts(prev))).total
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
    })
  } catch (error) {
    return apiError(error, 'Failed to explain this figure', 500)
  }
}
