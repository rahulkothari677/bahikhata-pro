import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { computePartyBalance } from '@/lib/party-balance'
import { parseKeysetCursor } from '@/lib/pagination'
import { apiError } from '@/lib/api-error'
import { fetchPartyHistory, HISTORY_MAX_LIMIT } from '@/lib/party-history-query'
import { HISTORY_FILTERS, HISTORY_PAGE, type HistoryFilter, type HistoryKind } from '@/lib/party-history'

/**
 * GET /api/parties/:id/history — one page of a customer's or supplier's history
 * (#327 Step B): bills and payments merged by the database, newest first, each with
 * the balance after it, plus the day/month totals and the count of matches.
 *
 *   ?cursor=<date|id>  the next page (from the previous page's nextCursor)
 *   ?limit=30          up to 1,000 (the printed statement asks for its rows here)
 *   ?filter=all|bills|payments|unpaid   ?q=search words
 *   ?labels={"sale":"Sale",…}           the shown words, so a search for them works
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('parties')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const url = new URL(req.url)

    const cursor = url.searchParams.get('cursor')
    if (cursor && !parseKeysetCursor(cursor)) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
    }
    const rawFilter = url.searchParams.get('filter') ?? 'all'
    if (!(HISTORY_FILTERS as string[]).includes(rawFilter)) {
      return NextResponse.json({ error: 'Invalid filter' }, { status: 400 })
    }
    const limitParam = Number(url.searchParams.get('limit') ?? HISTORY_PAGE)
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(HISTORY_MAX_LIMIT, Math.floor(limitParam))) : HISTORY_PAGE
    const q = (url.searchParams.get('q') ?? '').slice(0, 100)
    let labels: Partial<Record<HistoryKind, string>> = {}
    try {
      const parsed = JSON.parse(url.searchParams.get('labels') ?? '{}')
      if (parsed && typeof parsed === 'object') {
        labels = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as typeof labels
      }
    } catch { /* no labels: the search still finds amounts, numbers, notes and dates */ }

    // The party must be this shop's: a missing one is a 404, never an empty history.
    const party = await db.party.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } })
    if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })

    const { balance } = await computePartyBalance(userId, id)
    const page = await fetchPartyHistory({
      userId, partyId: id, balance, cursor, limit, filter: rawFilter as HistoryFilter, q, labels,
    })
    return NextResponse.json({ ...page, balance })
  } catch (error) {
    return apiError(error, 'Failed to fetch history', 500)
  }
}
