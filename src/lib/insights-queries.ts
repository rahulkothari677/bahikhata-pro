/**
 * The period queries behind Insights' groups — shared, so a group in Insights
 * and the chip it opens in Items or Khata are the same rows (Phase 5e-4).
 *
 * They lived inside /api/insights. The Items list worked out "sold this month"
 * with its own copy of the per-item query, and Khata had no sales at all — two
 * definitions of one fact waiting to disagree (CLAUDE.md, Cause 2). Now Insights
 * (Items and Customers sections), the Items list and the Khata list all call
 * these. Read-only; the database does every sum.
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { fromPaise } from './money'
import { LINE_TAXABLE_SQL } from './line-taxable-sql'
import { WALK_IN_PARTY_NAME } from './walk-in-party'

type Num = unknown
const p2r = (v: Num) => fromPaise(Number(v ?? 0))

/** Per-line value before GST, signed: + for a sale, − for a return. Table aliases ti / t. */
export const SIGNED_LINE = Prisma.sql`(CASE WHEN t."type" = 'sale' THEN ${LINE_TAXABLE_SQL} ELSE -${LINE_TAXABLE_SQL} END)`
/**
 * Per-line profit, signed — exactly what lib/line-items.ts booked on the line:
 * value − Math.round(qty × cost at sale). FLOOR(x + 0.5) on the float product
 * is Math.round to the bit (both IEEE doubles); ROUND on a numeric would round
 * 100.49999999999999 up, and ROUND on a double rounds 50.5 to even.
 * A typed-in line (no item) booked no profit, so it is 0 here too.
 */
export const SIGNED_PROFIT = Prisma.sql`(CASE WHEN ti."productId" IS NULL THEN 0 WHEN t."type" = 'sale' THEN 1 ELSE -1 END) * (${LINE_TAXABLE_SQL} - FLOOR(ti."quantity"::float8 * ti."purchasePriceAtSale"::float8 + 0.5::float8)::numeric)`
/** Sale and return lines of a shop in a window (inclusive). Aliases ti / t / p. */
export const SALE_LINES = (userId: string, from: Date, to: Date) => Prisma.sql`
  FROM "TransactionItem" ti
  JOIN "Transaction" t ON t."id" = ti."transactionId"
  LEFT JOIN "Product" p ON p."id" = ti."productId"
  WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL
    AND t."type" IN ('sale', 'credit-note')
    AND t."date" >= ${from} AND t."date" <= ${to}`

export interface ItemPeriodRow { id: string; name: string; sales: number; qty: number; profit: number }

/** Every item sold or returned in the window: sales before GST, quantity and profit, net of returns. */
export async function itemSalesInPeriod(userId: string, from: Date, to: Date): Promise<ItemPeriodRow[]> {
  const rows = await db.$queryRaw<Array<{ id: string; name: string; sales: Num; qty: Num; profit: Num }>>`
    SELECT ti."productId" AS "id", MAX(p."name") AS "name",
           SUM(${SIGNED_LINE})::numeric AS "sales",
           SUM(CASE WHEN t."type" = 'sale' THEN ti."quantity" ELSE -ti."quantity" END)::numeric AS "qty",
           SUM(${SIGNED_PROFIT})::numeric AS "profit"
    ${SALE_LINES(userId, from, to)} AND ti."productId" IS NOT NULL
    GROUP BY ti."productId"`
  return rows.map((r) => ({ id: r.id, name: r.name ?? '—', sales: p2r(r.sales), qty: Number(r.qty ?? 0), profit: p2r(r.profit) }))
}

export interface CustomerPeriodRow {
  id: string
  name: string
  billsNow: number
  salesNow: number
  profitNow: number
  billsPrev: number
  salesPrev: number
  firstBill: Date | null
}

/**
 * Every named customer with a sale or return in the window or the one before
 * it (same length): bills, sales (sale − return totals) and profit now, bills
 * and sales before, and their first sale ever. The walk-in khata is nobody and
 * is left out. A customer missing from these rows bought in neither period.
 */
export async function customerActivityInPeriod(userId: string, w: { from: Date; to: Date; prevFrom: Date; prevTo: Date }): Promise<CustomerPeriodRow[]> {
  const rows = await db.$queryRaw<Array<{ id: string; name: string; billsNow: bigint; salesNow: Num; profitNow: Num; billsPrev: bigint; salesPrev: Num; firstBill: Date | null }>>`
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
    FROM a JOIN "Party" p ON p."id" = a.pid AND p."deletedAt" IS NULL AND LOWER(p."name") <> LOWER(${WALK_IN_PARTY_NAME})`
  return rows.map((r) => ({
    id: r.id, name: r.name, billsNow: Number(r.billsNow), salesNow: p2r(r.salesNow), profitNow: p2r(r.profitNow),
    billsPrev: Number(r.billsPrev), salesPrev: p2r(r.salesPrev), firstBill: r.firstBill ? new Date(r.firstBill) : null,
  }))
}
