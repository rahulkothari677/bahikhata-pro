import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'

/**
 * Phase 6c: the shop's best sellers, for the Counter's quick tiles
 * (lib/counter-tiles.ts). Ranked by how many bills an item was on in the last
 * 90 days — a tile is tapped once per bill, so frequency, not quantity, is
 * what makes an item worth a tile (100 eggs on one bill is one tap). Quantity
 * breaks ties.
 *
 * The database counts (GROUP BY over every sale line), so a shop with five
 * years of bills gets the same answer as one with five days; only ids leave
 * the server, never figures. Read-only.
 */
const DAYS = 90
const LIMIT = 60

export async function GET() {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Whoever may bill may see which items sell most — the order of their own tiles.
    if (!canAccessModule(authCtx.role, authCtx.permissions, 'sales')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT ti."productId" AS "id"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON t."id" = ti."transactionId"
      JOIN "Product" p ON p."id" = ti."productId" AND p."userId" = ${authCtx.userId}
      WHERE t."userId" = ${authCtx.userId}
        AND t."deletedAt" IS NULL
        AND t."type" = 'sale'
        AND t."date" >= ${since}
        AND ti."productId" IS NOT NULL
      GROUP BY ti."productId"
      ORDER BY COUNT(DISTINCT t."id") DESC, SUM(ti."quantity") DESC, ti."productId" ASC
      LIMIT ${LIMIT}
    `
    return NextResponse.json({ ids: rows.map((r) => r.id), days: DAYS })
  } catch (error) {
    return apiError(error, 'Could not load best sellers')
  }
}
