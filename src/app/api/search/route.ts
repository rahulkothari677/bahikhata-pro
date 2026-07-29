import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/search?q=...  — global search across products, parties, transactions.
 *
 * 🐛 WHY THIS EXISTS (audit 2026-07-28):
 * GlobalSearch used to fetch `/api/products`, `/api/parties` and
 * `/api/transactions?limit=200` and filter them in the browser with
 * `.includes()`. That is wrong in two ways, and the first one is the serious
 * one:
 *
 *   1. It only ever searched the newest 200 transactions. A shop doing 20 bills
 *      a day passes 200 in under two weeks; from then on, searching an older
 *      invoice number returned "No results for ..." — not "still loading", not
 *      an error. The search quietly told the shopkeeper their bill did not
 *      exist. Products and parties were capped at their 5000-row fuse, so they
 *      failed the same way later. The failure gets WORSE the more successful
 *      the shop is, which is exactly backwards.
 *
 *   2. Every time the search box opened it downloaded the shop's entire product
 *      and party list to a phone, on Indian mobile data, to filter locally.
 *
 * Searching in SQL fixes both: the database sees every row, and only the five
 * matches per type cross the wire.
 *
 * SCALE NOTE: every query below is anchored on `userId`, which is the leading
 * column of an index on all three tables. So the row count that matters is one
 * shop's data, never the whole table — this stays flat as EkBook grows to
 * millions of shops. `contains` cannot use a B-tree for the text part, but
 * Postgres only scans within that user's slice. If a single shop ever grows
 * large enough for that to hurt, the fix is a pg_trgm GIN index on these
 * columns — deliberately NOT done here, because it needs CREATE INDEX
 * CONCURRENTLY, which cannot run inside a Prisma migration transaction (that
 * combination caused this project's V12 outage).
 */

/** Matches per type. The UI shows five; fetching more would be wasted work. */
const PER_TYPE_LIMIT = 5

/**
 * Below two characters, every shop matches everything — it is pure load with
 * no useful signal. The client enforces this too; this is the backstop.
 */
const MIN_QUERY_LENGTH = 2

/**
 * A search box is user-controlled input that reaches the database on every
 * keystroke. Prisma parameterises the value so this is not an injection risk,
 * but an unbounded string is still pointless work to ship and match.
 */
const MAX_QUERY_LENGTH = 100

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authCtx.userId
    const { role, permissions } = authCtx

    const raw = new URL(req.url).searchParams.get('q') ?? ''
    const q = raw.trim().slice(0, MAX_QUERY_LENGTH)

    if (q.length < MIN_QUERY_LENGTH) {
      return noStore({ products: [], parties: [], transactions: [], query: q, tooShort: true })
    }

    // 🔒 Staff permissions are enforced HERE, not only in the UI. GlobalSearch
    // is a shortcut into modules a staff member may not be allowed to open, so
    // without this a cashier blocked from Purchases could still read purchase
    // invoices through the search box. Each type is gated independently.
    const canParties = canAccessModule(role, permissions, 'parties')
    const canInventory = canAccessModule(role, permissions, 'inventory')
    const canSales = canAccessModule(role, permissions, 'sales')

    const contains = { contains: q, mode: 'insensitive' as const }

    const [products, parties, transactions] = await withConnectionRetry(() =>
      Promise.all([
        canInventory
          ? db.product.findMany({
              where: {
                userId,
                OR: [{ name: contains }, { sku: contains }, { hsn: contains }],
              },
              select: {
                id: true, name: true, category: true,
                currentStock: true, unit: true, salePrice: true,
              },
              orderBy: { name: 'asc' },
              take: PER_TYPE_LIMIT,
            })
          : Promise.resolve([]),

        canParties
          ? db.party.findMany({
              where: {
                userId,
                deletedAt: null,
                OR: [{ name: contains }, { phone: contains }, { gstin: contains }],
              },
              select: { id: true, name: true, phone: true, type: true },
              orderBy: { name: 'asc' },
              take: PER_TYPE_LIMIT,
            })
          : Promise.resolve([]),

        canSales
          ? db.transaction.findMany({
              where: {
                userId,
                deletedAt: null, // voided bills must not surface as live results
                OR: [
                  { invoiceNo: contains },
                  { notes: contains },
                  { payeeName: contains },
                  { party: { name: contains } },
                ],
              },
              select: {
                id: true, invoiceNo: true, type: true, date: true,
                totalAmount: true,
                party: { select: { name: true } },
                _count: { select: { items: true } },
              },
              // Newest first: when a shopkeeper searches a party name they
              // almost always want the most recent bill, and this lets Postgres
              // walk the (userId, date) index and stop early.
              orderBy: { date: 'desc' },
              take: PER_TYPE_LIMIT,
            })
          : Promise.resolve([]),
      ]),
    )

    return noStore({
      query: q,
      products,
      // No party balance here, deliberately: computing it means aggregating
      // every transaction for the shop (getReceivablePayable), which is far too
      // much work to run on each keystroke. The party profile shows the real
      // balance one tap away — better than a fast wrong number next to a name.
      parties,
      transactions: transactions.map(t => ({
        id: t.id,
        invoiceNo: t.invoiceNo,
        type: t.type,
        date: t.date,
        totalAmount: t.totalAmount,
        party: t.party,
        itemCount: t._count.items,
      })),
    })
  } catch (error) {
    // 🔒 Fail loudly. Returning empty results on a database error would render
    // as "No results" — indistinguishable from "this bill does not exist",
    // which is the exact confusion this endpoint was built to remove.
    //
    // The search term is NOT passed as context: it routinely holds a customer's
    // name or phone number, and that must not land in server logs.
    return apiError(error, 'Search is temporarily unavailable. Please try again.', 503)
  }
}
