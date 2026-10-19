import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule, type ModuleKey } from '@/lib/staff-permissions'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { fromPaise, roundMoney } from '@/lib/money'
import { istLocal } from '@/lib/ist-sql'
import { ALLOCATED_JOIN, DUE_SQL } from '@/lib/invoice-due-sql'
import { billWhereSql, parseBillFilters } from '@/lib/bill-filters'

/**
 * GET /api/transactions/summary?type=…&from&to&voided&search
 *
 * Phase 5d-1 (#184): the Bills list's totals for EVERY bill its filters select
 * — the same filters as the list (lib/bill-filters.ts), summed by the
 * database. The list pages through 50 rows at a time; its totals used to be
 * summed over those rows, so a total changed when nothing was sold.
 *
 * Same definitions the list cards always used, now over the whole period:
 *   total    = bills − returns (credit / debit notes), estimates left out
 *   received = paid at billing + payments settled against the bill later,
 *              less refunds on returns
 *   due      = total − received
 *   unpaid   = bills still due after later settlements (DUE_SQL)
 * Plus the total and bill count of each IST day, for the list's day headers.
 */
type Num = unknown
const p2r = (v: Num) => roundMoney(fromPaise(Number(v ?? 0)))

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId
    const f = parseBillFilters(new URL(req.url).searchParams)
    const purchaseSide = f.types.includes('purchase') || f.types.includes('debit-note')
    const moduleKey: ModuleKey = purchaseSide ? 'purchases' : 'sales'
    if (!canAccessModule(authCtx.role, authCtx.permissions, moduleKey)) {
      return NextResponse.json({ error: 'Forbidden', message: `You don't have permission to access ${moduleKey}.` }, { status: 403 })
    }
    // A summary of one side only: never sum sales and purchases into one "total".
    if (f.types.length === 0 || f.types.some((t) => !['sale', 'credit-note', 'estimate', 'purchase', 'debit-note'].includes(t))
      || (purchaseSide && f.types.some((t) => ['sale', 'credit-note', 'estimate'].includes(t)))) {
      return NextResponse.json({ error: 'Bad type' }, { status: 400 })
    }
    const bill = purchaseSide ? 'purchase' : 'sale'
    const note = purchaseSide ? 'debit-note' : 'credit-note'
    // The totals are the whole period's; the Unpaid chip narrows the list, not these figures.
    const where = billWhereSql(userId, { ...f, unpaid: false })

    const [byType, byDay, hideProfit] = await Promise.all([
      db.$queryRaw<Array<{ type: string; n: bigint; total: Num; paid: Num; profit: Num; taxable: Num; unpaid: bigint }>>`
        SELECT t."type" AS "type",
               COUNT(*)::bigint AS "n",
               COALESCE(SUM(t."totalAmount"), 0)::numeric AS "total",
               COALESCE(SUM(t."paidAmount" + COALESCE(a.alloc, 0)), 0)::numeric AS "paid",
               COALESCE(SUM(t."grossProfit"), 0)::numeric AS "profit",
               COALESCE(SUM(t."subtotal" - t."discountAmount"), 0)::numeric AS "taxable",
               COUNT(*) FILTER (WHERE ${DUE_SQL} > 0)::bigint AS "unpaid"
        FROM "Transaction" t
        LEFT JOIN "Party" p ON p."id" = t."partyId"
        ${ALLOCATED_JOIN}
        WHERE ${where}
        GROUP BY t."type"`,
      db.$queryRaw<Array<{ day: Date; total: Num; bills: bigint }>>`
        SELECT DATE_TRUNC('day', ${istLocal('t."date"')}) AS "day",
               COALESCE(SUM(CASE WHEN t."type" = ${bill} THEN t."totalAmount" WHEN t."type" = ${note} THEN -t."totalAmount" ELSE 0 END), 0)::numeric AS "total",
               COUNT(*) FILTER (WHERE t."type" = ${bill})::bigint AS "bills"
        FROM "Transaction" t
        LEFT JOIN "Party" p ON p."id" = t."partyId"
        WHERE ${where}
        GROUP BY 1
        ORDER BY 1 DESC`,
      shouldHideProfit(userId, authCtx.role),
    ])

    const of = (type: string) => byType.find((r) => r.type === type)
    const b = of(bill), n = of(note), est = of('estimate')
    const total = roundMoney(p2r(b?.total) - p2r(n?.total))
    const received = roundMoney(p2r(b?.paid) - p2r(n?.paid))
    const netSales = roundMoney(p2r(b?.taxable) - p2r(n?.taxable))
    const profit = purchaseSide || hideProfit ? null : roundMoney(p2r(b?.profit) + p2r(n?.profit))

    return noStore({
      side: bill,
      totals: {
        total, received, due: roundMoney(total - received),
        bills: Number(b?.n ?? 0), unpaid: Number(b?.unpaid ?? 0),
        returns: { count: Number(n?.n ?? 0), amount: p2r(n?.total) },
        estimates: purchaseSide ? null : { count: Number(est?.n ?? 0), amount: p2r(est?.total) },
        profit, netSales, margin: profit !== null && netSales > 0 ? Math.round((profit / netSales) * 1000) / 10 : null,
      },
      // Keys are the naive IST midnight, as the list's day headers group by (lib/trend-buckets.ts form).
      days: byDay.map((d) => ({ day: new Date(d.day).toISOString(), total: p2r(d.total), bills: Number(d.bills) })),
    })
  } catch (error) {
    return apiError(error, 'Failed to load bill totals', 503)
  }
}
