/**
 * 🔒 GUARD: search finds every screen by its name (#198, Phase 5f-1).
 *
 * "stock report" gave "No results" and "stock" listed New Purchase first:
 * search looked only at a hand-marked list (no reports, no settings) and
 * matched the whole query as one string. Swept over the REAL registry —
 * every report and every settings entry must come first for its own name.
 */
import { describe, test, expect } from '@jest/globals'
import { NAV_REGISTRY } from '@/lib/nav-registry'
import { navScore, searchableDestinations, searchDestinations } from '@/lib/nav-search'
import { readCode } from '@/test-support/read-source'

const searchable = searchableDestinations(NAV_REGISTRY)
const ids = (q: string) => searchDestinations(searchable, q).map((d) => d.id)

describe('the cases from #198', () => {
  test('"stock report" finds the Stock Report, first', () => {
    expect(ids('stock report')[0]).toBe('stock-report')
    expect(ids('Stock Report')[0]).toBe('stock-report')
    expect(ids('report stock')).toContain('stock-report')
  })
  test('"stock" ranks the Stock Report above New Purchase', () => {
    const r = ids('stock')
    expect(r.indexOf('stock-report')).toBeGreaterThanOrEqual(0)
    const np = r.indexOf('new-purchase')
    if (np >= 0) expect(r.indexOf('stock-report')).toBeLessThan(np)
  })
})

describe('every report and every setting can be found', () => {
  test('reports and settings are searchable — one rule, not a list of ids', () => {
    const reports = NAV_REGISTRY.filter((d) => d.surfaces?.includes('reports-hub'))
    const settings = NAV_REGISTRY.filter((d) => d.surfaces?.includes('account'))
    expect(reports.length).toBeGreaterThan(10)
    expect(settings.length).toBeGreaterThan(8)
    // An entry whose action is custom code (e.g. Rate EkBook) cannot be run from the search box — left out, never a dead row.
    for (const d of [...reports, ...settings].filter((x) => x.actionKind !== 'custom')) expect(searchable).toContain(d)
    expect(searchable.some((d) => d.actionKind === 'custom')).toBe(false)
    // Tools in More and the side menu too (Period lock, Books check, Document vault…): everything that opens.
    expect(NAV_REGISTRY.filter((d) => d.actionKind !== 'custom' && !searchable.includes(d)).map((d) => d.id)).toEqual([])
  })
  test('sweep: every searchable entry comes first (or tied first) for its own name', () => {
    const misses: string[] = []
    for (const d of searchable) {
      const best = searchDestinations(searchable, d.label)
      const top = navScore(best[0], d.label)
      if (navScore(d, d.label) !== top) misses.push(`${d.id} ("${d.label}") lost to ${best[0].id}`)
    }
    expect(misses).toEqual([])
  })
})

describe('the matching rule', () => {
  const d = { id: 'x', label: 'Debt Aging', keywords: 'udhaar ageing overdue', description: 'Who owes you, by how old' } as never
  test('name first, then words of the name, then keywords, then description', () => {
    expect(navScore(d, 'debt aging')).toBe(100)
    expect(navScore(d, 'debt')).toBe(80)
    expect(navScore(d, 'aging')).toBe(60)
    expect(navScore(d, 'udhaar')).toBe(40)
    expect(navScore(d, 'owes')).toBe(20)
  })
  test('wrong or empty input finds nothing', () => {
    for (const q of ['', '   ', 'zzqx', 'debt zzqx']) expect(navScore(d, q)).toBe(0)
  })
  test('the short name the bar and tiles show counts as a name ("Items & stock", "Cashbook")', () => {
    const tr = (k: string) => ({ 'short.items': 'Items & stock', 'short.cashbook': 'Cashbook' } as Record<string, string>)[k] ?? k
    const r = searchDestinations(searchable, 'cashbook', tr).map((d) => d.id)
    expect(r[0]).toBe('income-expense')
    const s = searchDestinations(searchable, 'stock', tr).map((d) => d.id)
    expect(s.indexOf('inventory')).toBeLessThan(s.indexOf('new-purchase') < 0 ? Infinity : s.indexOf('new-purchase'))
  })
  test('the translated name is searched too (V26 N22)', () => {
    const hi = { id: 'y', label: 'Sales', labelKey: 'nav.sales' } as never
    expect(navScore(hi, 'बिक्री', (k) => (k === 'nav.sales' ? 'बिक्री' : k))).toBe(100)
  })
  test('the search box uses this rule over every searchable entry', () => {
    const box = readCode('src/components/common/GlobalSearch.tsx')
    expect(box).toMatch(/searchableDestinations\(NAV_REGISTRY\)/)
    expect(box).toMatch(/searchDestinations\(searchable, q, t\)/)
  })
})
