/**
 * A customer's or supplier's history, paged by the database (#327 Step B, 31 Oct 2026).
 *
 * Was: the page loaded the newest 500 bills and, separately, the newest 500 payments,
 * then merged, searched and totalled them on the phone. Slow for a big khata — and
 * wrong: when the 500 payments reached back less far than the 500 bills, the older
 * bills showed without the payments around them, so the balance after each of those
 * entries was off by the missing payments. Estimates were merged in too and walked
 * the balance as money received, though the balance itself never counts them.
 *
 * Now ONE query merges bills and payments in the database, newest first, and gives
 * each entry the balance after it — today's balance less the effect of every newer
 * entry — so entry 2,000 is right without loading the 1,999 above it. The search and
 * filters run over the whole history, and each row carries its day's and month's
 * gave/got and the count of matches, from SQL windows over every matching entry.
 *
 * The rules are the app's own, written once here for SQL:
 *   - which bills count: LEDGER_BILL_TYPES (what computePartyBalance sums);
 *   - which way an entry went: GAVE_ENTRY_TYPES (held equal to `direction`);
 *   - its effect on the balance: + what is owed for GAVE, − for the rest
 *     (statement-balance.ts); what is owed = total − paid on a bill, the amount on
 *     a payment;
 *   - due: DUE_SQL with live allocations only (invoice-due-sql.ts);
 *   - gave/got: a bill counts whole on its side and the money paid on it on the
 *     other (dayTotals in party-history.ts).
 * scripts/check-party-history-parity.mjs runs this against the JS rules on generated
 * khatas and must agree to the paisa.
 */
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fromPaise, toPaise } from '@/lib/money'
import { istLocal } from '@/lib/ist-sql'
import { allocatedLateral, DUE_SQL } from '@/lib/invoice-due-sql'
import { encodeKeysetCursor, parseKeysetCursor } from '@/lib/pagination'
import { billDayKey } from '@/lib/bill-days'
import {
  GAVE_ENTRY_TYPES, LEDGER_BILL_TYPES,
  type HistoryEntry, type HistoryFilter, type HistoryKind,
} from '@/lib/party-history'

export const HISTORY_MAX_LIMIT = 1000

export interface HistoryPageInput {
  userId: string
  partyId: string
  /** Today's balance in rupees (computePartyBalance) — the anchor every row walks back from. */
  balance: number
  cursor?: string | null
  limit: number
  filter: HistoryFilter
  q: string
  /** The shown word for each kind, in the shop's language, so "got" or "मिले" finds payments. */
  labels?: Partial<Record<HistoryKind, string>>
}

export interface HistoryPage {
  entries: (HistoryEntry & { delta: number; due: number })[]
  nextCursor: string | null
  /** Entries matching the filter and search, over the whole history. */
  total: number
  /** "2026-10" → that month's gave/got over every matching entry. */
  months: Record<string, { gave: number; got: number }>
  /** billDayKey → that day's gave/got, for the days on this page. */
  days: Record<string, { gave: number; got: number }>
}

const GAVE = Prisma.join(GAVE_ENTRY_TYPES as unknown as string[])
const KIND_OF_TYPE: Record<string, HistoryKind> = {
  sale: 'sale', purchase: 'purchase', 'credit-note': 'return_in', 'debit-note': 'return_out',
  'payment-received': 'got', 'payment-paid': 'gave',
}

/** LIKE-safe: % and _ match themselves (escape character "!"). */
const likeWord = (w: string) => `%${w.replace(/[!%_]/g, (m) => `!${m}`)}%`

function searchSql(q: string, labels: Partial<Record<HistoryKind, string>>): Prisma.Sql {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  if (words.length === 0) return Prisma.sql`TRUE`
  const label = Prisma.sql`CASE b."type" ${Prisma.join(
    Object.entries(KIND_OF_TYPE).map(([type, kind]) => Prisma.sql`WHEN ${type} THEN ${String(labels[kind] ?? '').slice(0, 40)}`),
    ' ',
  )} ELSE '' END`
  const hay = Prisma.sql`LOWER(CONCAT_WS(' ', b."invoiceNo", b."notes", b."mode", b."type", ${label},
    TO_CHAR(b.ist, 'DD/MM/YYYY'), TO_CHAR(b.ist, 'FMDD Mon YYYY'), REPLACE(TO_CHAR(b.ist, 'FMDD Mon YYYY'), 'Sep ', 'Sept ')))`
  return Prisma.join(words.map((w) => {
    const text = Prisma.sql`${hay} LIKE ${likeWord(w)} ESCAPE '!'`
    const digits = w.replace(/[^\d.]/g, '')
    const asNum = Number(digits)
    // An amount: the exact paise, or the whole-rupee figure (the same as matchesSearch).
    if (!digits || !/^[₹\d.,]+$/.test(w) || !Number.isFinite(asNum)) return text
    const whole = /^\d+$/.test(digits) ? Prisma.sql` OR ROUND(b."amount" / 100.0) = ${asNum}` : Prisma.empty
    return Prisma.sql`(b."amount" = ${Math.round(asNum * 100)}${whole} OR ${text})`
  }), ' AND ')
}

function filterSql(f: HistoryFilter): Prisma.Sql {
  if (f === 'payments') return Prisma.sql`b."isPayment"`
  if (f === 'bills') return Prisma.sql`NOT b."isPayment"`
  if (f === 'unpaid') return Prisma.sql`(NOT b."isPayment" AND b."due" > 0)`
  return Prisma.sql`TRUE`
}

export async function fetchPartyHistory(input: HistoryPageInput): Promise<HistoryPage> {
  const { userId, partyId } = input
  const limit = Math.max(1, Math.min(HISTORY_MAX_LIMIT, Math.floor(input.limit)))
  const cur = input.cursor ? parseKeysetCursor(input.cursor) : null
  const balancePaise = toPaise(input.balance)
  const after = cur
    ? Prisma.sql`(w."date", w."id") < (${cur.date.toISOString()}::timestamp, ${cur.id})`
    : Prisma.sql`TRUE`
  // What an entry gave and got, in paise (dayTotals in party-history.ts).
  const paidOnBill = Prisma.sql`(CASE WHEN b."isPayment" THEN 0 ELSE GREATEST(0, b."amount" - ABS(b."delta")) END)`
  const gave = Prisma.sql`(CASE WHEN b."type" IN (${GAVE}) THEN b."amount" ELSE ${paidOnBill} END)`
  const got = Prisma.sql`(CASE WHEN b."type" IN (${GAVE}) THEN ${paidOnBill} ELSE b."amount" END)`

  const rows = await db.$queryRaw<Array<{
    id: string; date: Date; type: string; isPayment: boolean; amount: bigint; due: bigint
    invoiceNo: string | null; mode: string | null; notes: string | null; delta: bigint
    runningBalance: bigint; itemCount: number; total: bigint
    dayGave: bigint; dayGot: bigint; monthGave: bigint; monthGot: bigint
  }>>`
    WITH e0 AS (
      SELECT t."id", t."date", t."type", FALSE AS "isPayment",
        t."totalAmount"::bigint AS "amount",
        GREATEST(0, ${DUE_SQL})::bigint AS "due",
        t."invoiceNo", NULL::text AS "mode", t."notes",
        (t."totalAmount" - t."paidAmount")::bigint AS "owed"
      FROM "Transaction" t
      ${allocatedLateral(userId)}
      WHERE t."userId" = ${userId} AND t."partyId" = ${partyId} AND t."deletedAt" IS NULL
        AND t."type" IN (${Prisma.join(LEDGER_BILL_TYPES as unknown as string[])})
      UNION ALL
      SELECT p."id", p."date",
        CASE WHEN p."type" = 'received' THEN 'payment-received' ELSE 'payment-paid' END,
        TRUE, p."amount"::bigint, 0::bigint, NULL::text, p."mode", p."notes", p."amount"::bigint
      FROM "Payment" p
      WHERE p."userId" = ${userId} AND p."partyId" = ${partyId} AND p."deletedAt" IS NULL
    ),
    e AS (
      SELECT e0.*, (CASE WHEN e0."type" IN (${GAVE}) THEN e0."owed" ELSE -e0."owed" END)::bigint AS "delta"
      FROM e0
    ),
    b AS (
      SELECT e.*,
        (${balancePaise}::bigint - COALESCE(SUM(e."delta") OVER (
          ORDER BY e."date" DESC, e."id" DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0))::bigint AS "runningBalance",
        ${istLocal('"date"')} AS ist
      FROM e
    ),
    f AS (
      SELECT b.*, ${gave}::bigint AS "gave", ${got}::bigint AS "got"
      FROM b
      WHERE ${filterSql(input.filter)} AND ${searchSql(input.q, input.labels ?? {})}
    ),
    w AS (
      SELECT f.*,
        COUNT(*) OVER () AS "total",
        SUM(f."gave") OVER (PARTITION BY f.ist::date) AS "dayGave",
        SUM(f."got") OVER (PARTITION BY f.ist::date) AS "dayGot",
        SUM(f."gave") OVER (PARTITION BY DATE_TRUNC('month', f.ist)) AS "monthGave",
        SUM(f."got") OVER (PARTITION BY DATE_TRUNC('month', f.ist)) AS "monthGot"
      FROM f
    )
    SELECT w."id", w."date", w."type", w."isPayment", w."amount", w."due", w."invoiceNo", w."mode",
      w."notes", w."delta", w."runningBalance", w."total", w."dayGave"::bigint AS "dayGave",
      w."dayGot"::bigint AS "dayGot", w."monthGave"::bigint AS "monthGave", w."monthGot"::bigint AS "monthGot",
      CASE WHEN w."isPayment" THEN 0 ELSE (
        SELECT COUNT(*) FROM "TransactionItem" ti WHERE ti."transactionId" = w."id"
      ) END::int AS "itemCount"
    FROM w
    WHERE ${after}
    ORDER BY w."date" DESC, w."id" DESC
    LIMIT ${limit + 1}
  `

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const money = (p: bigint | number | null) => fromPaise(Number(p ?? 0))
  const days: HistoryPage['days'] = {}
  const months: HistoryPage['months'] = {}
  const entries = page.map((r) => {
    const day = billDayKey(r.date)
    days[day] = { gave: money(r.dayGave), got: money(r.dayGot) }
    months[day.slice(0, 7)] = { gave: money(r.monthGave), got: money(r.monthGot) }
    return {
      id: r.id,
      type: r.type,
      isPayment: r.isPayment,
      date: new Date(r.date).toISOString(),
      amount: money(r.amount),
      due: money(r.due),
      invoiceNo: r.invoiceNo,
      itemCount: Number(r.itemCount ?? 0),
      paymentMode: r.mode,
      notes: r.notes,
      delta: money(r.delta),
      runningBalance: money(r.runningBalance),
    }
  })
  return {
    entries,
    nextCursor: rows.length > limit && last ? encodeKeysetCursor(last.date, last.id) : null,
    total: Number(rows[0]?.total ?? 0),
    months,
    days,
  }
}
