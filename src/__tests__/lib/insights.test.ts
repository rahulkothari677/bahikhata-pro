/**
 * 🔒 GUARD: Insights groups add up to the whole (Phase 5c).
 *
 * The 5c proof line in the build plan: "Groups add up to the whole; no
 * negative row; shares add to 100." Checked on hand-worked cases (the model's
 * own numbers) and on random sweeps.
 */
import { describe, test, expect } from '@jest/globals'
import { abcGroups, customerGroups, istDaysBetween, remainder, shares, split, udhaarAge, type CustomerActivity } from '@/lib/insights'
import { multiplyPaise } from '@/lib/money'
import { readCode } from '@/test-support/read-source'

let seed = 11
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }

describe('shares add to exactly 100', () => {
  test('hand cases', () => {
    expect(shares([1, 1, 1])).toEqual([34, 33, 33])
    expect(shares([68410, 41050, 3730, 11190])).toEqual([55, 33, 3, 9]) // the model's payment split
    expect(shares([0, 0])).toEqual([0, 0])
    expect(shares([5, -3, 0])).toEqual([100, 0, 0])
  })
  test('sweep: 2,000 random splits', () => {
    for (let i = 0; i < 2000; i++) {
      const v = Array.from({ length: 1 + rnd(12) }, () => rnd(5) === 0 ? 0 : rnd(10_000_000) / 100)
      const s = shares(v)
      const positive = v.some((x) => x > 0)
      expect({ i, sum: s.reduce((a, b) => a + b, 0), neg: s.some((x) => x < 0) }).toEqual({ i, sum: positive ? 100 : 0, neg: false })
    }
  })
})

describe('ABC: every item in exactly one group', () => {
  test('the model: A brings ~80%, B ~15%, C the rest; items with no sale are counted', () => {
    const items = [
      { id: '1', name: 'Atta', sales: 50 }, { id: '2', name: 'Oil', sales: 30 },
      { id: '3', name: 'Salt', sales: 10 }, { id: '4', name: 'Soap', sales: 6 },
      { id: '5', name: 'Tea', sales: 4 }, { id: '6', name: 'Old stock', sales: 0 },
    ]
    const { groups, classOf } = abcGroups(items, 7)
    expect(groups.map((g) => [g.id, g.count, g.amount, g.share])).toEqual([
      ['a', 2, 80, 80], ['b', 2, 16, 16], ['c', 1, 4, 4], ['none', 2, 0, 0],
    ])
    expect(classOf.get('2')).toBe('a') // Oil starts at 50% < 80%, so A
    expect(classOf.get('3')).toBe('b') // Salt starts at 80%
  })
  test('sweep: counts add to the shop\'s items, amounts to positive sales, shares to 100', () => {
    for (let i = 0; i < 500; i++) {
      const n = rnd(60)
      const items = Array.from({ length: n }, (_, k) => ({ id: String(k), name: `i${k}`, sales: rnd(4) === 0 ? -rnd(500) / 100 : rnd(1_000_000) / 100 }))
      const total = n + rnd(20)
      const { groups } = abcGroups(items, total)
      const pos = items.filter((x) => Math.round(x.sales * 100) > 0)
      const sumP = pos.reduce((s, x) => s + Math.round(x.sales * 100), 0)
      expect({
        i,
        count: groups.reduce((s, g) => s + g.count, 0),
        amount: groups.reduce((s, g) => s + Math.round(g.amount * 100), 0),
        share: groups.reduce((s, g) => s + g.share, 0),
        neg: groups.some((g) => g.amount < 0 || g.count < 0),
      }).toEqual({ i, count: total, amount: sumP, share: sumP > 0 ? 100 : 0, neg: false })
    }
  })
})

describe('Customers: each customer once', () => {
  const from = new Date('2026-10-01T00:00:00+05:30')
  const c = (id: string, billsNow: number, billsPrev: number, first: string | null, salesNow = billsNow * 100, salesPrev = billsPrev * 100): CustomerActivity =>
    ({ id, billsNow, salesNow, billsPrev, salesPrev, firstBill: first ? new Date(first) : null })
  test('the order: new, regular, occasional, gone quiet, inactive', () => {
    const g = customerGroups([
      c('new', 4, 0, '2026-10-05T10:00:00+05:30'),
      c('reg', 3, 2, '2026-01-01T10:00:00+05:30'),
      c('occ', 1, 0, '2026-03-01T10:00:00+05:30'),
      c('quiet', 0, 5, '2026-02-01T10:00:00+05:30', 0, 900),
      c('gone', 0, 0, '2025-01-01T10:00:00+05:30'),
      c('never', 0, 0, null),
    ], from)
    expect(g.map((x) => [x.id, x.count, x.amount])).toEqual([
      ['new', 1, 400], ['regular', 1, 300], ['occasional', 1, 100], ['quiet', 1, 900], ['inactive', 2, 0],
    ])
    expect(g.filter((x) => ['new', 'regular', 'occasional'].includes(x.id)).reduce((s, x) => s + x.share, 0)).toBe(100)
  })
  test('sweep: counts add to every customer; this-period amounts add to their sales', () => {
    for (let i = 0; i < 500; i++) {
      const rows = Array.from({ length: rnd(80) }, (_, k) => {
        const now = rnd(3) ? rnd(6) : 0
        return c(String(k), now, rnd(2) ? rnd(4) : 0, rnd(5) === 0 ? null : rnd(2) ? '2026-10-03T09:00:00+05:30' : '2025-06-01T09:00:00+05:30', now * (1 + rnd(900)), rnd(500))
      })
      const g = customerGroups(rows, from)
      const nowSales = rows.reduce((s, r) => s + Math.round(r.salesNow * 100), 0)
      const inPeriod = g.filter((x) => ['new', 'regular', 'occasional'].includes(x.id))
      expect({ i, count: g.reduce((s, x) => s + x.count, 0), amount: inPeriod.reduce((s, x) => s + Math.round(x.amount * 100), 0) })
        .toEqual({ i, count: rows.length, amount: nowSales })
    }
  })
})

describe('Udhaar: the whole receivable, by age', () => {
  const now = new Date('2026-10-13T15:00:00+05:30')
  test('IST days: a bill at 23:00 yesterday is 1 day old at 00:30', () => {
    expect(istDaysBetween(new Date('2026-10-12T23:00:00+05:30'), new Date('2026-10-13T00:30:00+05:30'))).toBe(1)
  })
  test('the buckets and the opening-balance group; nothing owed is left out', () => {
    const g = udhaarAge([
      { id: 'a', balance: 9074, oldestUnpaid: new Date('2026-10-01T10:00:00+05:30') }, // 12 days
      { id: 'b', balance: 3180, oldestUnpaid: new Date('2026-09-20T10:00:00+05:30') }, // 23
      { id: 'c', balance: 6365, oldestUnpaid: new Date('2026-08-20T10:00:00+05:30') }, // 54
      { id: 'd', balance: 500, oldestUnpaid: null },
      { id: 'e', balance: -200, oldestUnpaid: new Date('2026-01-01T10:00:00+05:30') }, // we owe them: not udhaar
    ], now)
    expect(g.map((x) => [x.id, x.count, x.amount])).toEqual([['d15', 1, 9074], ['d30', 1, 3180], ['d60', 1, 6365], ['over', 0, 0], ['opening', 1, 500]])
    expect(g.reduce((s, x) => s + x.share, 0)).toBe(100)
  })
  test('sweep: buckets add to the receivable (positive balances)', () => {
    for (let i = 0; i < 500; i++) {
      const rows = Array.from({ length: rnd(60) }, (_, k) => ({
        id: String(k), balance: (rnd(4) === 0 ? -1 : 1) * rnd(5_000_000) / 100,
        oldestUnpaid: rnd(6) === 0 ? null : new Date(now.getTime() - rnd(200) * 86_400_000 - rnd(86_400_000)),
      }))
      const g = udhaarAge(rows, now)
      const recv = rows.filter((r) => Math.round(r.balance * 100) > 0)
      expect({ i, amount: g.reduce((s, x) => s + Math.round(x.amount * 100), 0), count: g.reduce((s, x) => s + x.count, 0) })
        .toEqual({ i, amount: recv.reduce((s, r) => s + Math.round(r.balance * 100), 0), count: recv.length })
    }
  })
})

describe('split', () => {
  test('largest first, zero rows dropped, shares 100', () => {
    expect(split([{ id: 'upi', amount: 10 }, { id: 'cash', amount: 30 }, { id: 'card', amount: 0 }])).toEqual([
      { id: 'cash', count: 0, amount: 30, share: 75 }, { id: 'upi', count: 0, amount: 10, share: 25 },
    ])
  })
})

/*
 * Group rows are summed from bill LINES; the totals beside them come from the
 * bills, the figures Home shows. 19 Oct (5c-1, local data): category profit
 * added up to ₹54,092 while the bills said ₹8,526 — the demo-data maker had
 * written lines with no cost and an unsplit discount. Two things now hold:
 * the per-line profit is the billing code's own rule, and any gap is shown.
 */
describe('rows that must add up to a figure shown elsewhere', () => {
  test('agreeing rows leave nothing; a gap comes back to the paisa, either sign', () => {
    expect(remainder(0.3, [0.1, 0.2])).toBe(0)
    expect(remainder(538.57, [541.92])).toBe(-3.35)
    expect(remainder(85.26, [0, 0])).toBe(85.26)
    expect(remainder(0, [])).toBe(0)
  })
  test('sweep: rows plus the remainder always make the total, to the paisa', () => {
    for (let n = 0; n < 2000; n++) {
      const rows = Array.from({ length: rnd(8) }, () => (rnd(2_000_000) - 500_000) / 100)
      const total = (rnd(4_000_000) - 1_000_000) / 100
      const r = remainder(total, rows)
      const p = (x: number) => Math.round(x * 100)
      expect(rows.reduce((s, x) => s + p(x), 0) + p(r)).toBe(p(total))
    }
  })
  test('the SQL cost rule FLOOR(qty × cost + 0.5) is Math.round, the rule line-items.ts booked with', () => {
    // multiplyPaise = Math.round(qty × paise). ROUND on a numeric would take 1.005 × 100 up to 101.
    expect(Math.floor(1.005 * 100 + 0.5)).toBe(multiplyPaise(1.005, 100))
    expect(Math.floor(0.5 * 101 + 0.5)).toBe(multiplyPaise(0.5, 101))
    for (let n = 0; n < 20000; n++) {
      const qty = (1 + rnd(500_000)) / 1000, cost = 1 + rnd(1_000_000)
      expect(Math.floor(qty * cost + 0.5)).toBe(multiplyPaise(qty, cost))
    }
  })
  test('the engine uses that rule, books no profit on typed-in lines, and shows every gap', () => {
    const code = readCode('src/app/api/insights/route.ts')
    const at = (s: string) => { const i = code.indexOf(s); expect({ s, found: i > 0 }).toEqual({ s, found: true }); return i }
    const sales = code.slice(at('async function salesSection'), at('async function itemsSection'))
    const profit = code.slice(at('async function profitSection'))
    expect(code).toContain('FLOOR(ti."quantity"::float8 * ti."purchasePriceAtSale"::float8 + 0.5::float8)')
    expect(code).toContain('WHEN ti."productId" IS NULL THEN 0')
    expect(code).not.toMatch(/ROUND\(ti\."quantity"/)
    expect({ sales: sales.split('remainder(').length - 1, profit: profit.split('remainder(').length - 1 }).toEqual({ sales: 1, profit: 2 })
    expect(profit).toContain('TYPED_IN')
  })
})

/*
 * 19 Oct (5c-3): "not sold this period" tested only that an item's LAST sale
 * came before the period, so viewing September in October counted an item
 * sold only in October as sold in September. A period has two ends: every
 * date filter on the period's start must carry its end on the same line.
 */
/** Lines where a SQL/Prisma filter uses the period's start without its end. */
function openEndedPeriodLines(code: string): number[] {
  const out: number[] = []
  code.split(/\r?\n/).forEach((line, i) => {
    // A span from the period before's start to this period's end (both periods at once) is closed too.
    for (const [start, end] of [['from', 'to'], ['prevFrom', '(?:prevTo|to)']]) {
      const usesStart = new RegExp(String.raw`\$\{[^}]*\bw\.${start}\b[^}]*\}|gte:\s*w\.${start}\b`).test(line)
      if (usesStart && !new RegExp(String.raw`\bw\.${end}\b`).test(line)) out.push(i + 1)
    }
  })
  return out
}

describe('period filters have both ends', () => {
  test('the rule works on good and bad input', () => {
    expect(openEndedPeriodLines('AND t."date" >= ${w.from} AND t."date" <= ${w.to}\nwhere: { date: { gte: w.from, lte: w.to } }')).toEqual([])
    expect(openEndedPeriodLines('AND t."date" >= ${since90 < w.from ? since90 : w.from}')).toEqual([1])
    expect(openEndedPeriodLines('ok\nwhere: { date: { gte: w.prevFrom } }')).toEqual([2])
    expect(openEndedPeriodLines('const g = customerGroups(rows, w.from)')).toEqual([])
    expect(openEndedPeriodLines('AND t."date" >= ${w.prevFrom} AND t."date" <= ${w.to}')).toEqual([])
  })
  test('the insights engine', () => {
    const code = readCode('src/app/api/insights/route.ts')
    expect(code.split(/\r?\n/).filter((l) => /\bw\.from\b/.test(l)).length).toBeGreaterThan(8)
    expect(openEndedPeriodLines(code)).toEqual([])
  })
})
