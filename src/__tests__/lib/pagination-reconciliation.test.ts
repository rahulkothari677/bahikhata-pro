/**
 * 🔒 V17-Ext §1 — Pagination reconciliation test ("no row is ever lost").
 *
 * The V17-Extensive auditor found that the OLD ledger pagination
 * (`where.id = { lt: cursor }` with `orderBy: [{ date: 'desc' }, { id: 'desc' }]`)
 * silently skipped backdated transactions — a row with a high id but low date
 * would never appear on any page. This test verifies the NEW composite keyset
 * cursor (`date|id`) produces correct pagination: every row appears exactly
 * once across all pages, including backdated and same-date entries.
 *
 * Approach: use `simulateKeysetPagination` from src/lib/pagination.ts, which
 * mirrors the exact WHERE + orderBy + take logic the route handler sends to
 * Prisma. No DB needed — the test verifies the cursor logic itself, not the
 * Prisma query (which is just a pass-through of the WHERE condition).
 *
 * The fixture mirrors the auditor's worked example:
 *   A (Jan 10, c500) — normal: high date, high id
 *   B (Jan 09, c400) — normal
 *   C (Jan 08, c300) — normal
 *   D (Jan 07, c900) — BACKDATED: low date but HIGHEST id (entered today,
 *                      dated last week). This is the row the old cursor
 *                      silently dropped.
 *
 * With page size 2, pagination should produce:
 *   Page 1: A, B → cursor = "Jan09|c400"
 *   Page 2: C, D → cursor = null (no more)
 * All 4 rows appear exactly once. The OLD cursor would have returned only C
 * on page 2 (D's id c900 > c400, so `id < 'c400'` excluded it).
 */

import {
  encodeKeysetCursor,
  parseKeysetCursor,
  buildKeysetWhere,
  simulateKeysetPagination,
} from '@/lib/pagination'

describe('🔒 V17-Ext §1 — Keyset pagination (no row is ever lost)', () => {
  // The auditor's worked example fixture.
  // D is backdated: dated Jan 7 (oldest date) but has id c900 (highest id).
  const FIXTURE = [
    { id: 'c500', date: '2026-01-10T00:00:00.000Z', name: 'A' },
    { id: 'c400', date: '2026-01-09T00:00:00.000Z', name: 'B' },
    { id: 'c300', date: '2026-01-08T00:00:00.000Z', name: 'C' },
    { id: 'c900', date: '2026-01-07T00:00:00.000Z', name: 'D (backdated)' },
  ]

  describe('encodeKeysetCursor', () => {
    it('encodes date + id into "date|id" format', () => {
      const cursor = encodeKeysetCursor('2026-01-09T00:00:00.000Z', 'c400')
      expect(cursor).toBe('2026-01-09T00:00:00.000Z|c400')
    })

    it('handles Date objects (converts to ISO string)', () => {
      const cursor = encodeKeysetCursor(new Date('2026-01-09T00:00:00.000Z'), 'c400')
      expect(cursor).toBe('2026-01-09T00:00:00.000Z|c400')
    })

    it('returns null for missing date or id', () => {
      expect(encodeKeysetCursor('', 'c400')).toBeNull()
      expect(encodeKeysetCursor('2026-01-09', '')).toBeNull()
      expect(encodeKeysetCursor(null as any, 'c400')).toBeNull()
    })

    it('returns null for invalid date', () => {
      expect(encodeKeysetCursor('not-a-date', 'c400')).toBeNull()
    })
  })

  describe('parseKeysetCursor', () => {
    it('parses a valid cursor into { date, id }', () => {
      const parsed = parseKeysetCursor('2026-01-09T00:00:00.000Z|c400')
      expect(parsed).not.toBeNull()
      expect(parsed!.id).toBe('c400')
      expect(parsed!.date.getTime()).toBe(new Date('2026-01-09T00:00:00.000Z').getTime())
    })

    it('returns null for legacy cursor (bare id, no pipe)', () => {
      expect(parseKeysetCursor('c400')).toBeNull()
    })

    it('returns null for invalid date in cursor', () => {
      expect(parseKeysetCursor('not-a-date|c400')).toBeNull()
    })

    it('returns null for empty cursor', () => {
      expect(parseKeysetCursor('')).toBeNull()
      expect(parseKeysetCursor(null as any)).toBeNull()
    })

    it('returns null for cursor with empty id', () => {
      expect(parseKeysetCursor('2026-01-09T00:00:00.000Z|')).toBeNull()
    })
  })

  describe('buildKeysetWhere', () => {
    it('builds the correct OR condition for date DESC, id DESC sort', () => {
      const where = buildKeysetWhere('2026-01-09T00:00:00.000Z|c400')
      expect(where).not.toBeNull()
      expect(where!.OR).toHaveLength(2)
      // First branch: date < cursorDate
      expect(where!.OR[0]).toEqual({ date: { lt: new Date('2026-01-09T00:00:00.000Z') } })
      // Second branch: date == cursorDate AND id < cursorId
      expect(where!.OR[1]).toEqual({
        date: new Date('2026-01-09T00:00:00.000Z'),
        id: { lt: 'c400' },
      })
    })

    it('returns null for no cursor (first page)', () => {
      expect(buildKeysetWhere(null)).toBeNull()
      expect(buildKeysetWhere('')).toBeNull()
    })

    it('returns null for invalid cursor', () => {
      expect(buildKeysetWhere('c400')).toBeNull()
      expect(buildKeysetWhere('invalid|c400')).toBeNull()
    })
  })

  describe('🔒 THE RECONCILIATION: paginating through the fixture loses no rows', () => {
    it('all 4 rows appear exactly once across pages (page size 2)', () => {
      const PAGE_SIZE = 2
      const seen: string[] = []
      let cursor: string | null = null
      let pageCount = 0

      // Paginate until no more pages
      while (true) {
        const { page, nextCursor } = simulateKeysetPagination(FIXTURE, PAGE_SIZE, cursor)
        pageCount++
        page.forEach(row => seen.push(row.name))

        if (!nextCursor) break
        cursor = nextCursor

        // Safety valve — prevent infinite loop if the logic is broken
        if (pageCount > 10) {
          throw new Error('Pagination did not terminate — possible infinite loop')
        }
      }

      // ALL 4 rows must appear (the old cursor would have dropped D)
      expect(seen).toHaveLength(4)
      expect(seen.sort()).toEqual(['A', 'B', 'C', 'D (backdated)'])

      // No duplicates
      const unique = new Set(seen)
      expect(unique.size).toBe(seen.length)

      // No missing rows
      FIXTURE.forEach(row => {
        expect(seen).toContain(row.name)
      })
    })

    it('page 1 returns the 2 newest rows (A, B)', () => {
      const { page, nextCursor } = simulateKeysetPagination(FIXTURE, 2, null)
      expect(page).toHaveLength(2)
      expect(page[0].name).toBe('A') // Jan 10, newest
      expect(page[1].name).toBe('B') // Jan 09
      expect(nextCursor).not.toBeNull()
    })

    it('page 2 returns C AND D (the backdated row is NOT skipped)', () => {
      // After page 1 (A, B), cursor = "Jan09|c400"
      const page1 = simulateKeysetPagination(FIXTURE, 2, null)
      const { page, nextCursor } = simulateKeysetPagination(FIXTURE, 2, page1.nextCursor)

      expect(page).toHaveLength(2)
      // C is Jan 08 (next-newest date) — any pagination scheme returns this.
      // D is Jan 07 with id c900 — the OLD cursor (id < 'c400') would have
      // SKIPPED it because c900 > c400. The new keyset cursor correctly
      // includes it because date(Jan 07) < date(Jan 09).
      expect(page[0].name).toBe('C')
      expect(page[1].name).toBe('D (backdated)')
      expect(nextCursor).toBeNull() // no more pages
    })

    it('explicitly verifies the OLD bug: D would be skipped by id-only cursor', () => {
      // This test documents WHAT the old code did wrong, so we can be confident
      // the new code fixes it. The old cursor was `where.id = { lt: cursor }`.
      // After page 1 (A, B), the old cursor would be "c400" (B's id).
      // Page 2 query: WHERE id < 'c400' → C (c300) qualifies, D (c900) does NOT.
      // So the old code returned only C on page 2 — D was silently lost.
      //
      // The new cursor is "Jan09|c400". Page 2 query:
      //   WHERE (date < Jan09) OR (date == Jan09 AND id < c400)
      // → C (Jan08) qualifies via first branch.
      // → D (Jan07) qualifies via first branch (date < Jan09).
      // Both appear. D is no longer lost.
      const oldWayResult = FIXTURE.filter(row => row.id < 'c400')
      expect(oldWayResult.map(r => r.name)).toEqual(['C']) // D is missing!

      const newCursorCondition = buildKeysetWhere('2026-01-09T00:00:00.000Z|c400')
      expect(newCursorCondition).not.toBeNull()
      // Simulate what Prisma would do with the new WHERE
      const newWayResult = FIXTURE.filter(row => {
        const rowDate = new Date(row.date).getTime()
        const cursorDate = new Date('2026-01-09T00:00:00.000Z').getTime()
        if (rowDate !== cursorDate) return rowDate < cursorDate
        return row.id < 'c400'
      })
      expect(newWayResult.map(r => r.name).sort()).toEqual(['C', 'D (backdated)'])
    })
  })

  describe('edge cases', () => {
    it('page size larger than dataset returns all rows, no cursor', () => {
      const { page, nextCursor } = simulateKeysetPagination(FIXTURE, 100, null)
      expect(page).toHaveLength(4)
      expect(nextCursor).toBeNull()
    })

    it('page size 1 paginates through all rows one at a time', () => {
      const seen: string[] = []
      let cursor: string | null = null
      let pageCount = 0

      while (true) {
        const { page, nextCursor } = simulateKeysetPagination(FIXTURE, 1, cursor)
        pageCount++
        page.forEach(row => seen.push(row.name))
        if (!nextCursor) break
        cursor = nextCursor
        if (pageCount > 10) throw new Error('Infinite loop')
      }

      expect(pageCount).toBe(4)
      expect(seen).toHaveLength(4)
      // Order should be A, B, C, D (date desc)
      expect(seen).toEqual(['A', 'B', 'C', 'D (backdated)'])
    })

    it('same-date entries are ordered by id DESC (stable tiebreaker)', () => {
      const sameDateFixture = [
        { id: 'c100', date: '2026-01-10T00:00:00.000Z', name: 'low-id' },
        { id: 'c300', date: '2026-01-10T00:00:00.000Z', name: 'high-id' },
        { id: 'c200', date: '2026-01-10T00:00:00.000Z', name: 'mid-id' },
      ]

      const { page } = simulateKeysetPagination(sameDateFixture, 3, null)
      // All same date → id DESC: c300, c200, c100
      expect(page.map(r => r.name)).toEqual(['high-id', 'mid-id', 'low-id'])
    })

    it('same-date entries paginate correctly across pages (no skips)', () => {
      const sameDateFixture = [
        { id: 'c100', date: '2026-01-10T00:00:00.000Z', name: 'low-id' },
        { id: 'c300', date: '2026-01-10T00:00:00.000Z', name: 'high-id' },
        { id: 'c200', date: '2026-01-10T00:00:00.000Z', name: 'mid-id' },
      ]

      const seen: string[] = []
      let cursor: string | null = null
      let pageCount = 0

      while (true) {
        const { page, nextCursor } = simulateKeysetPagination(sameDateFixture, 1, cursor)
        pageCount++
        page.forEach(row => seen.push(row.name))
        if (!nextCursor) break
        cursor = nextCursor
        if (pageCount > 10) throw new Error('Infinite loop')
      }

      expect(pageCount).toBe(3)
      expect(seen).toHaveLength(3)
      expect(seen).toEqual(['high-id', 'mid-id', 'low-id'])
    })

    it('empty dataset returns empty page, null cursor', () => {
      const { page, nextCursor } = simulateKeysetPagination([], 10, null)
      expect(page).toEqual([])
      expect(nextCursor).toBeNull()
    })

    it('round-trip: encode → parse → buildWhere produces consistent results', () => {
      const originalDate = '2026-01-09T00:00:00.000Z'
      const originalId = 'c400'
      const cursor = encodeKeysetCursor(originalDate, originalId)
      expect(cursor).not.toBeNull()

      const parsed = parseKeysetCursor(cursor!)
      expect(parsed).not.toBeNull()
      expect(parsed!.id).toBe(originalId)
      expect(parsed!.date.getTime()).toBe(new Date(originalDate).getTime())

      const where = buildKeysetWhere(cursor!)
      expect(where).not.toBeNull()
      expect(where!.OR[0].date.lt.getTime()).toBe(new Date(originalDate).getTime())
      expect(where!.OR[1].id.lt).toBe(originalId)
    })
  })
})
