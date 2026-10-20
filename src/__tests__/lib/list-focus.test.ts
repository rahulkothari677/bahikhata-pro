/**
 * 🔒 GUARD: an Insights group opens Items or Khata with exactly that group
 * (Phase 5e-4b, ledger model v4 §2). The focus is one short word the server
 * reads with Insights' own rules — never ids from the phone, never a guess.
 */
import { describe, test, expect } from '@jest/globals'
import { focusParam, parseItemsFocus, parseKhataFocus } from '@/lib/list-focus'
import { itemsList, type ItemRow } from '@/lib/items-list'
import { khataList, type KhataParty } from '@/lib/khata-list'
import { readCode } from '@/test-support/read-source'

describe('the focus vocabulary', () => {
  test('every Insights group parses, and back again', () => {
    for (const f of ['abc:a', 'abc:b', 'abc:c', 'abc:none', 'unsold']) expect(focusParam(parseItemsFocus(f)!)).toBe(f)
    for (const g of ['new', 'regular', 'occasional', 'quiet', 'inactive']) expect(focusParam(parseKhataFocus(`group:${g}`)!)).toBe(`group:${g}`)
    for (const a of ['d15', 'd30', 'd60', 'over', 'opening']) expect(focusParam(parseKhataFocus(`age:${a}`)!)).toBe(`age:${a}`)
  })
  test('anything else is no focus — refused, never guessed', () => {
    for (const bad of [null, '', 'abc:d', 'abc:', 'ABC:a', 'unsold:1', 'group:a', 'age:d90', 'chip:out', 'abc:a;drop', 'group:quiet ']) {
      expect(parseItemsFocus(bad)).toBeNull()
      expect(parseKhataFocus(bad)).toBeNull()
    }
    expect(parseItemsFocus('group:quiet')).toBeNull()
    expect(parseKhataFocus('abc:a')).toBeNull()
  })
})

describe('a focus narrows the list and its counts, never the totals above', () => {
  const now = new Date('2026-10-20T06:00:00Z')
  const I = (id: string, extra: Partial<ItemRow> = {}): ItemRow => ({
    id, name: id, category: 'Grocery', currentStock: 5, tracksInventory: true, isLowStock: false, stockValue: 100,
    createdAt: '2025-01-01T00:00:00Z', lastSoldAt: '2026-10-18T00:00:00Z', salesNow: 0, qtyNow: 0, ...extra,
  })
  const items = [I('a1'), I('a2', { currentStock: 0, stockValue: 0 }), I('b1'), I('c1')]
  test('items', () => {
    const r = itemsList(items, { chip: 'all', search: '', category: null, sort: 'name', offset: 0, now, focusIds: new Set(['a1', 'a2']) })
    expect(r.rows.map((p) => p.id)).toEqual(['a1', 'a2'])
    expect([r.counts.all, r.counts.out]).toEqual([2, 1])
    expect([r.totals.items, r.totals.stockValue]).toEqual([4, 300])
  })
  test('khata', () => {
    const P = (id: string, balance: number): KhataParty => ({ id, name: id, phone: null, type: 'customer', balance, oldestDays: 20, lastAt: null })
    const parties = [P('x', 100), P('y', 50), P('z', 0)]
    const r = khataList(parties, { side: 'customer', chip: 'all', search: '', sort: 'name', offset: 0, focusIds: new Set(['y', 'z']) })
    expect(r.rows.map((p) => p.id)).toEqual(['y', 'z'])
    expect([r.counts.all, r.counts.due]).toEqual([2, 1])
    expect([r.totals.amount, r.totals.owing, r.totals.parties]).toEqual([150, 2, 3])
  })
})

describe('the servers find the group with Insights\' own rules', () => {
  const items = readCode('src/app/api/products/list/route.ts')
  const khata = readCode('src/app/api/parties/list/route.ts')
  const ins = readCode('src/app/api/insights/route.ts')
  test('Items: ABC over the same period, "not sold" from the same fragment Insights counts with', () => {
    expect(items).toMatch(/parseItemsFocus\(sp\.get\('focus'\)\)/)
    expect(items).toMatch(/itemSalesInPeriod\(userId, fw\.from, fw\.to\)/)
    expect(items).toMatch(/abcGroups\(focusSales, products\.length\)/)
    expect(items).toMatch(/itemIdsSoldInPeriod\(userId, fw\.from, fw\.to\)/)
    expect(ins).toMatch(/WITH sp AS \(\$\{SOLD_IN_WINDOW\(userId, w\.from, w\.to\)\}\)/)
    expect(items).toMatch(/itemsList\(rows, \{[^}]*focusIds \}\)/)
  })
  test('Khata: customer groups by customerGroupOf over the period; ages by ageBandOf over khataSides\' collect', () => {
    expect(khata).toMatch(/parseKhataFocus\(sp\.get\('focus'\)\)/)
    expect(khata).toMatch(/customerActivityInPeriod\(userId, fw\)/)
    expect(khata).toMatch(/customerGroupOf\(acts\.get\(p\.id\)/)
    expect(khata).toMatch(/khataSides\(rows\)\.collect\.parties\.filter\(\(p\) => ageBandOf\(p\.oldestDays\) === focus\.id\)/)
    expect(khata).toMatch(/khataList\(rows, \{[^}]*focusIds \}\)/)
  })
  test('every Insights group with members opens its list', () => {
    expect(readCode('src/components/insights/ItemsSection.tsx')).toMatch(/openList\('items', `abc:\$\{g\.id\}`/)
    expect(readCode('src/components/insights/ItemsSection.tsx')).toMatch(/openList\('items', 'unsold'/)
    expect(readCode('src/components/insights/CustomersSection.tsx')).toMatch(/openList\('khata', `group:\$\{g\.id\}`/)
    expect(readCode('src/components/insights/UdhaarSection.tsx')).toMatch(/openList\('khata', `age:\$\{g\.id\}`/)
  })
})
