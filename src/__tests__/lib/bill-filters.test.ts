/**
 * 🔒 GUARD: the Bills list and its period totals select the same bills
 * (Phase 5d-1, #184).
 *
 * "Total sales" was summed over the 50 rows loaded, so saving an estimate
 * pushed a sale off the first page and the total fell by ₹948.08 with nothing
 * sold. Totals now come from /api/transactions/summary — and that is only
 * right if it selects exactly the bills the list pages through. One reading
 * of the filters (lib/bill-filters.ts), two renderings, both checked here.
 */
import { describe, test, expect } from '@jest/globals'
import { billWhere, billWhereSql, parseBillFilters, SEARCH_FIELDS } from '@/lib/bill-filters'
import { readCode } from '@/test-support/read-source'

const sp = (q: string) => new URLSearchParams(q)

describe('reading the filters', () => {
  test('types, voided, dates and an escaped search', () => {
    const f = parseBillFilters(sp('type=sale,credit-note,estimate&voided=true&from=2026-10-01T00:00:00.000Z&to=2026-10-19T18:29:59.999Z&search=50%25 off'))
    expect(f.types).toEqual(['sale', 'credit-note', 'estimate'])
    expect(f.voided).toBe(true)
    expect([f.from?.toISOString(), f.to?.toISOString()]).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-19T18:29:59.999Z'])
    expect(f.search).toBe('50\\% off')
  })
  test('nothing given, junk dates and "all" select everything the shop has', () => {
    const f = parseBillFilters(sp('type=all&from=yesterday'))
    expect([f.types, f.from, f.to, f.search, f.voided]).toEqual([[], null, null, '', false])
  })
})

describe('two renderings, one meaning', () => {
  const f = parseBillFilters(sp('type=sale,credit-note&from=2026-10-01T00:00:00.000Z&to=2026-10-19T18:29:59.999Z&search=gupta'))
  test('the list where: shop first, types, both dates, every search field', () => {
    const w = billWhere('u1', f)
    expect([w.userId, w.deletedAt, w.type]).toEqual(['u1', null, { in: ['sale', 'credit-note'] }])
    expect(Object.keys(w.date)).toEqual(['gte', 'lte'])
    expect(w.AND[0].OR).toHaveLength(SEARCH_FIELDS.length)
    expect(billWhere('u1', { ...f, voided: true }).deletedAt).toEqual({ not: null })
  })
  test('the totals SQL: shop first, the same types, both dates, the same search fields', () => {
    const q = billWhereSql('u1', f)
    expect(q.sql.startsWith('t."userId" = ?')).toBe(true)
    expect(q.sql).toContain('t."deletedAt" IS NULL')
    expect(q.sql).toContain('t."type" IN (?,?)')
    expect(q.sql).toContain('t."date" >= ?')
    expect(q.sql).toContain('t."date" <= ?')
    expect((q.sql.match(/I?LIKE \?/g) || []).length).toBe(SEARCH_FIELDS.length)
    expect(q.values).toEqual(['u1', 'sale', 'credit-note', f.from, f.to, '%gupta%', '%gupta%', '%gupta%', '%gupta%'])
  })
})

describe('both routes use it', () => {
  test('the list and the totals read the same filters; neither builds its own', () => {
    const list = readCode('src/app/api/transactions/route.ts')
    const totals = readCode('src/app/api/transactions/summary/route.ts')
    expect(list).toMatch(/billWhere\(userId, parseBillFilters\(searchParams\)\)/)
    expect(totals).toMatch(/billWhereSql\(userId, f\)/)
    for (const code of [list, totals]) expect(code).not.toMatch(/searchParams\.get\('search'\)|searchParams\.get\('voided'\)/)
  })
})
