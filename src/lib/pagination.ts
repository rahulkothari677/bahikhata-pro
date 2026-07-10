/**
 * 🔒 V17-Ext §1: Keyset pagination helpers — extracted to a pure module so
 * the cursor logic can be tested behaviorally without a DB.
 *
 * WAS: the cursor encoding/decoding + WHERE construction lived inline in
 * both `transactions/route.ts` and `parties/[id]/route.ts`. The V17-Extensive
 * auditor found that the OLD cursor (`where.id = { lt: cursor }` with
 * `orderBy: [{ date: 'desc' }, { id: 'desc' }]`) silently skipped backdated
 * transactions — a row with a high id but low date would never appear on any
 * page. This module implements proper keyset pagination with a composite
 * `date|id` cursor that matches the sort order exactly.
 *
 * The test in `src/__tests__/lib/pagination-reconciliation.test.ts` seeds a
 * fixture with a backdated transaction and asserts all rows appear exactly
 * once across pages — the "no row is ever lost" guard.
 *
 * Sort order: `ORDER BY date DESC, id DESC` (newest date first; for same date,
 * highest id first). The cursor encodes the last row of a page as
 * `"2026-01-09T00:00:00.000Z|c400"`. The next page's WHERE condition is:
 *   (date < cursorDate) OR (date == cursorDate AND id < cursorId)
 * This selects all rows that come AFTER the cursor in the sort order.
 */

/**
 * Encode a row's (date, id) into a composite cursor string.
 * Returns null if date or id is missing (defensive — shouldn't happen).
 */
export function encodeKeysetCursor(date: Date | string, id: string): string | null {
  if (!date || !id) return null
  const parsed = new Date(date)
  if (isNaN(parsed.getTime())) return null
  const isoDate = parsed.toISOString()
  return `${isoDate}|${id}`
}

/**
 * Parse a composite cursor string back into { date, id }.
 * Returns null if the cursor is malformed (no pipe, invalid date).
 * The caller should return a 400 to the client when this returns null,
 * so a stale/legacy cursor triggers a clean refresh instead of a crash.
 */
export function parseKeysetCursor(cursor: string): { date: Date; id: string } | null {
  if (!cursor) return null
  const pipeIdx = cursor.indexOf('|')
  if (pipeIdx === -1) return null
  const cursorDateStr = cursor.slice(0, pipeIdx)
  const cursorId = cursor.slice(pipeIdx + 1)
  const cursorDate = new Date(cursorDateStr)
  if (isNaN(cursorDate.getTime())) return null
  if (!cursorId) return null
  return { date: cursorDate, id: cursorId }
}

/**
 * Build the Prisma WHERE condition for keyset pagination.
 *
 * Given a cursor (the last row of the previous page), returns an OR condition
 * that selects all rows coming AFTER the cursor in the
 * `ORDER BY date DESC, id DESC` sort order:
 *
 *   (date < cursorDate) OR (date == cursorDate AND id < cursorId)
 *
 * Returns null if cursor is null/invalid — meaning "no cursor, fetch from the
 * top (first page)".
 *
 * The caller should AND this with the base filters (userId, deletedAt, etc.):
 *   const where = { userId, deletedAt: null }
 *   const cursorCond = buildKeysetWhere(cursor)
 *   if (cursorCond) where.AND = [cursorCond]
 */
export function buildKeysetWhere(cursor: string | null): { OR: any[] } | null {
  if (!cursor) return null
  const parsed = parseKeysetCursor(cursor)
  if (!parsed) return null
  return {
    OR: [
      { date: { lt: parsed.date } },
      { date: parsed.date, id: { lt: parsed.id } },
    ],
  }
}

/**
 * Simulate keyset pagination on an in-memory array (for testing).
 *
 * Given a full set of rows (each with `date` and `id`), a page size, and an
 * optional cursor, returns:
 *   - page: the rows on this page (sorted date DESC, id DESC, limited to pageSize)
 *   - nextCursor: the cursor for the next page (or null if no more pages)
 *
 * This mirrors what Prisma would return given the same WHERE + orderBy + take.
 * The test uses this to verify that paginating through a fixture with a
 * backdated transaction produces all rows with no skips or duplicates.
 */
export function simulateKeysetPagination<T extends { date: Date | string; id: string }>(
  allRows: T[],
  pageSize: number,
  cursor: string | null,
): { page: T[]; nextCursor: string | null } {
  // Sort by date DESC, id DESC (same as the route's orderBy)
  const sorted = [...allRows].sort((a, b) => {
    const dateA = new Date(a.date).getTime()
    const dateB = new Date(b.date).getTime()
    if (dateA !== dateB) return dateB - dateA // date desc
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0 // id desc
  })

  // Apply cursor filter if present
  let filtered = sorted
  if (cursor) {
    const parsed = parseKeysetCursor(cursor)
    if (parsed) {
      filtered = sorted.filter(row => {
        const rowDate = new Date(row.date).getTime()
        const cursorDateMs = parsed.date.getTime()
        if (rowDate !== cursorDateMs) return rowDate < cursorDateMs
        return row.id < parsed.id
      })
    }
  }

  // Take pageSize + 1 to detect hasMore
  const taken = filtered.slice(0, pageSize + 1)
  const hasMore = taken.length > pageSize
  const page = hasMore ? taken.slice(0, pageSize) : taken
  const lastRow = page[page.length - 1]
  const nextCursor = hasMore && lastRow
    ? encodeKeysetCursor(lastRow.date, lastRow.id)
    : null

  return { page, nextCursor }
}
