/**
 * 🔒 GUARD: Khata — every party, counted over all of them (Phase 5e-1).
 *
 * The screen used to load up to 5,000 parties and add them up itself. Now the
 * server pages 60 at a time, and the chip counts and the side's totals are
 * worked out over every party. A side comes from the party's type, never its
 * balance's sign (#261): a customer's advance is "advance", not "a supplier".
 */
import { describe, test, expect } from '@jest/globals'
import { inChip, khataList, khataSides, matchesSearch, onSide, KHATA_CHIPS, type KhataParty } from '@/lib/khata-list'

const P = (id: string, type: string, balance: number, extra: Partial<KhataParty> = {}): KhataParty =>
  ({ id, name: id, phone: null, type, balance, oldestDays: null, lastAt: null, ...extra })

const shop: KhataParty[] = [
  P('Ramesh', 'customer', 7327.02, { oldestDays: 77, lastAt: '2026-10-01T04:33:00Z', phone: '98765 43210' }),
  P('Sunita', 'customer', 275.02, { oldestDays: 12, lastAt: '2026-10-05T04:33:00Z' }),
  P('Anita', 'customer', -200, { lastAt: '2026-09-20T04:33:00Z' }),
  P('Irfan', 'customer', 0),
  P('Gupta', 'both', 1500, { oldestDays: 40 }),
  P('Sharma Traders', 'supplier', -5600.05),
  P('Amul', 'supplier', 0),
  P('Tata', 'supplier', 300),
]

describe('sides come from the type', () => {
  test('both is on both sides; the sign never moves a party', () => {
    expect(['customer', 'both'].map((t) => onSide(t, 'customer'))).toEqual([true, true])
    expect(onSide('customer', 'supplier')).toBe(false)
    expect(inChip(P('x', 'customer', -200), 'customer', 'advance')).toBe(true)
    expect(inChip(P('y', 'supplier', 300), 'supplier', 'advance')).toBe(true)
  })
})

describe('#261 to collect / to pay — by who the party is (khataSides, shared by Home, Khata and Insights)', () => {
  const s = khataSides(shop)
  test('an overpaid supplier is not a customer who owes you; a customer\'s advance is not a supplier you owe', () => {
    expect(s.collect.parties.map((p) => p.id)).toEqual(['Ramesh', 'Sunita', 'Gupta'])
    expect(s.pay.parties.map((p) => p.id)).toEqual(['Sharma Traders'])
    expect([s.collect.amount, s.collect.count, s.pay.amount, s.pay.count]).toEqual([9102.04, 3, 5600.05, 1])
  })
  test('the reverse balances are kept, each under its own name', () => {
    expect([s.advance.parties.map((p) => p.id), s.advance.amount]).toEqual([['Anita'], 200])
    expect([s.refund.parties.map((p) => p.id), s.refund.amount]).toEqual([['Tata'], 300])
  })
  test('the sign-only rule this replaced gives different answers on the same shop', () => {
    const bySign = shop.filter((p) => p.balance > 0).length
    expect(bySign).toBe(4)
    expect(s.collect.count).toBe(3)
  })
  test('#267: the walk-in khata is nobody — in no total, no count and no list; sent on its own', () => {
    const withWalkIn = [...shop, P('w1', 'customer', 450, { name: 'Walk-in Customer', transactionCount: 2 })]
    const w = khataSides(withWalkIn)
    expect([w.collect.amount, w.collect.count]).toEqual([s.collect.amount, s.collect.count])
    const r = khataList(withWalkIn, { side: 'customer', chip: 'all', search: '', sort: 'balance', offset: 0 })
    expect(r.rows.map((p) => p.id)).not.toContain('w1')
    expect(r.counts.all).toBe(5)
    expect(r.totals.parties).toBe(5)
    expect(r.counter).toEqual({ id: 'w1', balance: 450, transactionCount: 2 })
    expect(khataList(withWalkIn, { side: 'supplier', chip: 'all', search: '', sort: 'balance', offset: 0 }).counter).toBeNull()
    // Never used: no counter row at all.
    expect(khataList([...shop, P('w2', 'customer', 0, { name: 'walk-in customer', transactionCount: 0 })], { side: 'customer', chip: 'all', search: '', sort: 'balance', offset: 0 }).counter).toBeNull()
  })
})

describe('customers', () => {
  const r = khataList(shop, { side: 'customer', chip: 'all', search: '', sort: 'balance', offset: 0 })
  test('every chip counted over all customers; the chips add up the way they should', () => {
    expect(r.counts).toEqual({ all: 5, due: 3, old: 2, settled: 1, advance: 1 })
    expect(r.counts.due + r.counts.settled + r.counts.advance).toBe(r.counts.all)
  })
  test('the card: what you will collect, from how many, of all', () => {
    expect(r.totals).toEqual({ amount: 9102.04, owing: 3, parties: 5 })
  })
  test('most owed first; Over 30 days = owes you with the oldest unpaid bill over 30 days', () => {
    expect(r.rows.map((p) => p.id)).toEqual(['Ramesh', 'Gupta', 'Sunita', 'Irfan', 'Anita'])
    expect(khataList(shop, { side: 'customer', chip: 'old', search: '', sort: 'balance', offset: 0 }).rows.map((p) => p.id)).toEqual(['Ramesh', 'Gupta'])
  })
})

describe('suppliers', () => {
  test('to pay is what you owe; a supplier who owes you is "advance"', () => {
    const r = khataList(shop, { side: 'supplier', chip: 'due', search: '', sort: 'balance', offset: 0 })
    expect(r.rows.map((p) => p.id)).toEqual(['Sharma Traders'])
    expect(r.totals).toEqual({ amount: 5600.05, owing: 1, parties: 4 })
    expect(r.counts.old).toBe(0)
  })
})

describe('search, sort and pages', () => {
  test('name ignores spaces and case; phone matches by digits', () => {
    expect(matchesSearch(shop[5], 'sharmatraders')).toBe(true)
    expect(matchesSearch(shop[0], '98765')).toBe(true)
    expect(matchesSearch(shop[0], '12')).toBe(false)
  })
  test('a search narrows the list and the chip counts, not the card above them', () => {
    const r = khataList(shop, { side: 'customer', chip: 'all', search: 'ita', sort: 'name', offset: 0 })
    expect(r.rows.map((p) => p.id)).toEqual(['Anita', 'Sunita'])
    expect(r.counts.all).toBe(2)
    expect(r.totals.parties).toBe(5)
  })
  test('pages of 60: every party once, in order, and "more" until the last', () => {
    const many = Array.from({ length: 145 }, (_, i) => P(`c${String(i).padStart(3, '0')}`, 'customer', i))
    const seen: string[] = []
    let offset = 0, more = true
    while (more) {
      const r = khataList(many, { side: 'customer', chip: 'all', search: '', sort: 'name', offset })
      seen.push(...r.rows.map((p) => p.id)); more = r.hasMore; offset += 60
      expect(r.matched).toBe(145)
    }
    expect(seen).toEqual(many.map((p) => p.id))
  })
  test('sweep: Khata\'s cards equal khataSides for random shops (Home shows the same rupees)', () => {
    let seed = 11
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let n = 0; n < 200; n++) {
      const parties = Array.from({ length: rnd(30) }, (_, i) => P(`p${i}`, ['customer', 'supplier', 'both'][rnd(3)], (rnd(2001) - 1000) / 7))
      if (rnd(2)) parties.push(P('Walk-in Customer', 'customer', (rnd(201) - 100) / 3))
      const sides = khataSides(parties)
      const c = khataList(parties, { side: 'customer', chip: 'all', search: '', sort: 'balance', offset: 0, limit: 1000 })
      const s = khataList(parties, { side: 'supplier', chip: 'all', search: '', sort: 'balance', offset: 0, limit: 1000 })
      expect([c.totals.amount, c.totals.owing]).toEqual([sides.collect.amount, sides.collect.count])
      expect([s.totals.amount, s.totals.owing]).toEqual([sides.pay.amount, sides.pay.count])
      expect(c.counts.due).toBe(c.totals.owing)
    }
  })
  test('sweep: for random shops every chip count equals its rows, and due + settled + advance = all', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let n = 0; n < 300; n++) {
      const parties = Array.from({ length: rnd(40) }, (_, i) => P(`p${i}`, ['customer', 'supplier', 'both'][rnd(3)], (rnd(2001) - 1000) * (rnd(3) === 0 ? 0 : 1), { oldestDays: rnd(2) ? rnd(90) : null }))
      for (const side of ['customer', 'supplier'] as const) {
        const all = khataList(parties, { side, chip: 'all', search: '', sort: 'balance', offset: 0, limit: 1000 })
        expect(all.counts.due + all.counts.settled + all.counts.advance).toBe(all.counts.all)
        for (const chip of KHATA_CHIPS) expect(khataList(parties, { side, chip, search: '', sort: 'name', offset: 0, limit: 1000 }).rows.length).toBe(all.counts[chip])
      }
    }
  })
})
