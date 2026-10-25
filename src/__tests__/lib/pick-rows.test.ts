/**
 * Phase 7c (#294, #295) — the bill picker's rows: one per brand, sizes as buttons.
 */
import { describe, test, expect } from '@jest/globals'
import { groupPickRows, rankedRows, groupRows, freezeWhileBillOpen, type PickProduct } from '@/lib/pick-rows'
import { sizeRank } from '@/lib/product-sizes'

const it = (id: string, name: string, extra: Partial<PickProduct> = {}): PickProduct => ({ id, name, category: 'Biscuits', ...extra })
const size = (id: string, brand: string, label: string, category = 'Biscuits') =>
  it(id, `${brand} ${label}`, { category, familyId: `f-${brand}`, family: { id: `f-${brand}`, name: brand }, sizeLabel: label, sizeRank: sizeRank(label) })

const P = [
  size('pg50', 'Parle-G', '₹50'), size('pg5', 'Parle-G', '₹5'), size('pg10', 'Parle-G', '₹10'), size('pg20', 'Parle-G', '₹20'),
  it('oreo', 'Oreo ₹30'),
  size('aa10', 'Aashirvaad Atta', '10 kg', 'Atta'), size('aa1', 'Aashirvaad Atta', '1 kg', 'Atta'), size('aa5', 'Aashirvaad Atta', '5 kg', 'Atta'),
  it('sugar', 'Sugar (loose)', { category: null }),
]

describe('search results become one row per brand', () => {
  test('ranking kept; a brand sits where its best size fell; only the matching sizes ride along', () => {
    const ranked = [P[2], P[4], P[0]] // pg10, oreo, pg50
    const rows = groupPickRows(ranked)
    expect(rows.map((r) => r.brand?.name ?? r.items[0].name)).toEqual(['Parle-G', 'Oreo ₹30'])
    expect(rows[0].items.map((i) => i.sizeLabel)).toEqual(['₹10', '₹50'])
    expect(rows[0].topId).toBeNull() // the best MATCH is not marked as the best seller
  })
})

describe('"Often sold" and "usually buys" rows', () => {
  test('a brand appears once with ALL its sizes in order, its most-sold size marked', () => {
    const rows = rankedRows(P, ['pg10', 'oreo', 'pg5', 'aa5'], 8)
    expect(rows.map((r) => r.key)).toEqual(['f:f-Parle-G', 'oreo', 'f:f-Aashirvaad Atta'])
    expect(rows[0].items.map((i) => i.sizeLabel)).toEqual(['₹5', '₹10', '₹20', '₹50'])
    expect(rows[0].topId).toBe('pg10')
    expect(rows[2].items.map((i) => i.sizeLabel)).toEqual(['1 kg', '5 kg', '10 kg'])
  })
  test('the limit counts rows; deleted items are skipped; a row already shown is not shown twice', () => {
    expect(rankedRows(P, ['gone', 'oreo', 'pg5', 'aa1'], 2).map((r) => r.key)).toEqual(['oreo', 'f:f-Parle-G'])
    expect(rankedRows(P, ['oreo', 'pg5'], 8, new Set(['oreo'])).map((r) => r.key)).toEqual(['f:f-Parle-G'])
  })
})

describe('groups: the whole list, never cut', () => {
  test('a group lists every row A–Z, brands as one row', () => {
    expect(groupRows(P, 'Biscuits').map((r) => r.brand?.name ?? r.items[0].name)).toEqual(['Oreo ₹30', 'Parle-G'])
    expect(groupRows(P, 'Uncategorized').map((r) => r.items[0].name)).toEqual(['Sugar (loose)'])
  })
})

describe('the order never moves under a finger while a bill is open (#181)', () => {
  test('frozen once a line exists; live again when the bill is empty', () => {
    const snap = ['a', 'b']
    expect(freezeWhileBillOpen(['b', 'a'], snap, true)).toBe(snap)
    expect(freezeWhileBillOpen(['b', 'a'], snap, false)).toEqual(['b', 'a'])
    expect(freezeWhileBillOpen(['b', 'a'], undefined, true)).toEqual(['b', 'a'])
  })
})
