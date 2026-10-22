import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'

/**
 * The items a shop puts on its bills most often — "Often sold" in the bill
 * picker (Phase 7c, lib/pick-rows.ts; first built for the Counter's tiles in
 * 6c). Ranked by how many bills an item was on in the last 90 days — a row is
 * tapped once per bill, so frequency, not quantity, makes an item worth
 * showing (100 eggs on one bill is one tap). Quantity breaks ties.
 *
 * Phase 7c: ?type=purchase ranks what the shop BUYS most (the purchase picker);
 * ?partyId= ranks what ONE customer (or supplier) usually takes, over 180 days
 * ("Gupta ji usually buys"). The party must be this shop's: the query joins
 * on the shop's own bills, so another shop's id finds nothing.
 *
 * The database counts (GROUP BY over every line), so five years of bills give
 * the same answer as five days; only ids leave the server, never figures.
 */
const DAYS = 90
const PARTY_DAYS = 180
const LIMIT = 60

export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const sp = new URL(req.url).searchParams
    const type = sp.get('type') === 'purchase' ? 'purchase' : 'sale'
    const partyId = sp.get('partyId') || null
    // Whoever may bill (or buy) may see which items they put on bills most — the order of their own picker.
    if (!canAccessModule(authCtx.role, authCtx.permissions, type === 'purchase' ? 'purchases' : 'sales')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const days = partyId ? PARTY_DAYS : DAYS
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT ti."productId" AS "id"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON t."id" = ti."transactionId"
      JOIN "Product" p ON p."id" = ti."productId" AND p."userId" = ${authCtx.userId}
      WHERE t."userId" = ${authCtx.userId}
        AND t."deletedAt" IS NULL
        AND t."type" = ${type}
        AND t."date" >= ${since}
        AND ti."productId" IS NOT NULL
        AND (${partyId}::text IS NULL OR t."partyId" = ${partyId})
      GROUP BY ti."productId"
      ORDER BY COUNT(DISTINCT t."id") DESC, SUM(ti."quantity") DESC, ti."productId" ASC
      LIMIT ${LIMIT}
    `
    return NextResponse.json({ ids: rows.map((r) => r.id), days, type, partyId })
  } catch (error) {
    return apiError(error, 'Could not load best sellers')
  }
}
