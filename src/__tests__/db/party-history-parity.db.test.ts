/**
 * @jest-environment node
 *
 * #327 Step B — the database history agrees with the app's own rules, to the paisa.
 *
 * RUNS ONLY AGAINST A REAL DATABASE: `PARTY_HISTORY_DB=1` with DATABASE_URL pointing at
 * the local copy (`set -a; . ./.env.local; set +a`). CI has no database and skips it.
 *
 * It writes generated khatas under fresh parties (bills of all four kinds, part
 * payments, later settlements, estimates and deleted rows that must NOT count, three
 * years of dates), reads them back through fetchPartyHistory, and checks every entry
 * against the JS rules: computeStatementRunningBalance (balance after, effect, due),
 * dayTotals/periodTotals (gave/got), filterHistory (filters and search), and the
 * balance's own definition (oldest entry walks back to the opening balance). Then it
 * shows the old 500 + 500 loading getting a big khata wrong, and deletes what it made.
 */
import { db } from '@/lib/db'
import { computePartyBalance } from '@/lib/party-balance'
import { computeStatementRunningBalance } from '@/lib/statement-balance'
import { fetchPartyHistory } from '@/lib/party-history-query'
import { billDayKey } from '@/lib/bill-days'
import { filterHistory, periodTotals, HISTORY_FILTERS, type HistoryEntry, type HistoryKind } from '@/lib/party-history'

process.env.TZ = 'Asia/Kolkata'
const run = process.env.PARTY_HISTORY_DB === '1' ? describe : describe.skip

const LABELS: Record<HistoryKind, string> = {
  sale: 'Sale', purchase: 'Purchase', got: 'Got payment', gave: 'Gave payment', return_in: 'Return from them', return_out: 'Return to them',
}
const label = (k: HistoryKind) => LABELS[k]

// A small seeded random, so a failure can be replayed.
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

const TAG = `parity-${Date.now()}`
const made: { parties: string[]; txns: string[]; pays: string[] } = { parties: [], txns: [], pays: [] }
let userId = ''

async function makeKhata(n: number, opts: { bills: number; pays: number; years: number; supplier?: boolean }) {
  const r = rng(1000 + n)
  const money = (max: number) => Math.round(r() * max * 100) / 100 + 1
  const party = await db.party.create({
    data: { userId, name: `ZZ ${TAG} ${n}`, type: opts.supplier ? 'supplier' : 'customer', openingBalance: Math.round((r() - 0.3) * 500000) / 100 } as any,
  })
  made.parties.push(party.id)
  const now = Date.now()
  const span = opts.years * 365 * 86_400_000
  const when = (i: number) => new Date(now - Math.floor(r() * span) - i * 1000) // unique to the second
  const kinds = opts.supplier ? ['purchase', 'purchase', 'purchase', 'debit-note'] : ['sale', 'sale', 'sale', 'sale', 'credit-note']
  const bills: { id: string; total: number; paid: number }[] = []
  for (let i = 0; i < opts.bills; i++) {
    const total = money(5000)
    const p = r()
    const paid = p < 0.4 ? 0 : p < 0.7 ? total : Math.round(total * r() * 100) / 100
    const t = await db.transaction.create({
      data: { userId, partyId: party.id, type: kinds[Math.floor(r() * kinds.length)], date: when(i), totalAmount: total, paidAmount: paid, invoiceNo: `${TAG}-${n}-${i}`, notes: r() < 0.2 ? 'diwali order' : null } as any,
    })
    made.txns.push(t.id)
    bills.push({ id: t.id, total, paid })
  }
  // Must NOT count: an estimate, a deleted bill, a deleted payment.
  for (const extra of [
    { type: 'estimate', deletedAt: null },
    { type: kinds[0], deletedAt: new Date() },
  ]) {
    const t = await db.transaction.create({
      data: { userId, partyId: party.id, type: extra.type, deletedAt: extra.deletedAt, date: when(9000), totalAmount: 777, paidAmount: 0, invoiceNo: `${TAG}-${n}-x${extra.type}-${made.txns.length}` } as any,
    })
    made.txns.push(t.id)
  }
  for (let i = 0; i < opts.pays; i++) {
    const pay = await db.payment.create({
      data: { userId, partyId: party.id, type: opts.supplier ? 'paid' : (r() < 0.9 ? 'received' : 'paid'), amount: money(2000), date: when(5000 + i), mode: r() < 0.5 ? 'cash' : 'upi', notes: r() < 0.15 ? 'diwali' : null } as any,
    })
    made.pays.push(pay.id)
    // Some payments settle part of a bill (the bill's due falls; its effect does not).
    const b = bills[Math.floor(r() * bills.length)]
    if (b && r() < 0.3 && b.total - b.paid > 2) {
      await (db as any).paymentAllocation.create({ data: { userId, paymentId: pay.id, transactionId: b.id, amount: 1 } })
    }
  }
  const gone = await db.payment.create({ data: { userId, partyId: party.id, type: 'received', amount: 999, date: when(9999), deletedAt: new Date() } as any })
  made.pays.push(gone.id)
  return party.id
}

/** The JS truth: every live ledger row, through the app's statement builder. */
async function jsHistory(partyId: string, balance: number, cap?: number) {
  const txns = await db.transaction.findMany({
    where: { userId, partyId, deletedAt: null, type: { in: ['sale', 'purchase', 'credit-note', 'debit-note'] } },
    select: { id: true, date: true, type: true, totalAmount: true, paidAmount: true, invoiceNo: true, notes: true, paymentAllocations: { where: { payment: { deletedAt: null } }, select: { amount: true } } },
    orderBy: { date: 'desc' }, ...(cap ? { take: cap } : {}),
  })
  const pays = await db.payment.findMany({
    where: { userId, partyId, deletedAt: null }, select: { id: true, date: true, type: true, amount: true, mode: true, notes: true },
    orderBy: { date: 'desc' }, ...(cap ? { take: cap } : {}),
  })
  const notes = new Map(txns.map((t) => [t.id, t.notes]))
  return computeStatementRunningBalance(
    txns.map((t: any) => ({ ...t, allocatedAmount: t.paymentAllocations.reduce((s: number, a: any) => s + a.amount, 0) })),
    pays as any,
    balance,
  ).map((e) => ({ ...e, notes: e.isPayment ? e.notes : notes.get(e.id) ?? null })) as unknown as (HistoryEntry & { delta: number; due: number })[]
}

async function sqlAll(partyId: string, balance: number, extra: { filter?: any; q?: string } = {}) {
  const out: any[] = []
  const days: Record<string, any> = {}
  const months: Record<string, any> = {}
  let cursor: string | null = null
  let total = 0
  do {
    const page = await fetchPartyHistory({ userId, partyId, balance, cursor, limit: 30, filter: extra.filter ?? 'all', q: extra.q ?? '', labels: LABELS })
    out.push(...page.entries)
    Object.assign(days, page.days)
    Object.assign(months, page.months)
    total = page.total
    cursor = page.nextCursor
  } while (cursor)
  return { entries: out, days, months, total }
}

// `|| 0`: a fully paid bill's effect is −0 in JS and 0 in SQL — the same paisa.
const paise = (n: number) => Math.round(n * 100) || 0

run('the database history agrees with the app rules (local database)', () => {
  jest.setTimeout(600_000)
  const khatas: string[] = []

  beforeAll(async () => {
    const u = await db.user.findFirst({ select: { id: true } })
    if (!u) throw new Error('no local user to write test khatas under')
    userId = u.id
    for (let n = 0; n < 24; n++) {
      khatas.push(await makeKhata(n, { bills: 5 + Math.floor((n * 37) % 60), pays: 3 + Math.floor((n * 53) % 50), years: 1 + (n % 3), supplier: n % 6 === 5 }))
    }
  })

  afterAll(async () => {
    await (db as any).paymentAllocation.deleteMany({ where: { paymentId: { in: made.pays } } })
    await db.payment.deleteMany({ where: { id: { in: made.pays } } })
    await db.transaction.deleteMany({ where: { id: { in: made.txns } } })
    await db.party.deleteMany({ where: { id: { in: made.parties } } })
    const left = await db.party.count({ where: { name: { startsWith: `ZZ ${TAG}` } } })
    console.log(`cleaned up: ${made.parties.length} khatas, ${made.txns.length} bills, ${made.pays.length} payments; left behind: ${left}`)
    await db.$disconnect()
  })

  it('every entry: same order, amount, effect, due and balance after; the oldest walks back to the opening balance', async () => {
    let rows = 0
    for (const id of khatas) {
      const { balance } = await computePartyBalance(userId, id)
      const js = await jsHistory(id, balance)
      const sql = (await sqlAll(id, balance)).entries
      expect(sql.map((e) => e.id)).toEqual(js.map((e) => e.id))
      for (let i = 0; i < js.length; i++) {
        expect([sql[i].id, paise(sql[i].amount), paise(sql[i].delta), paise(sql[i].due), paise(sql[i].runningBalance)])
          .toEqual([js[i].id, paise(js[i].amount), paise(js[i].delta), paise(js[i].due), paise(js[i].runningBalance)])
      }
      const party = await db.party.findFirst({ where: { id }, select: { openingBalance: true } })
      const oldest = sql[sql.length - 1]
      expect(paise(oldest.runningBalance - oldest.delta)).toBe(paise(Number(party!.openingBalance)))
      rows += sql.length
    }
    console.log(`checked ${rows} entries in ${khatas.length} khatas: all agree to the paisa`)
  })

  it('day and month totals (gave/got, counter payments counted) match periodTotals', async () => {
    for (const id of khatas) {
      const { balance } = await computePartyBalance(userId, id)
      const js = await jsHistory(id, balance)
      const sql = await sqlAll(id, balance)
      const day = periodTotals(js, (e) => billDayKey(e.date))
      const month = periodTotals(js, (e) => billDayKey(e.date).slice(0, 7))
      expect(sql.days).toEqual(Object.fromEntries(day))
      expect(sql.months).toEqual(Object.fromEntries(month))
    }
  })

  it('filters and search give the same entries as filterHistory, and the count of matches', async () => {
    let asked = 0
    for (const id of khatas.slice(0, 12)) {
      const { balance } = await computePartyBalance(userId, id)
      const js = await jsHistory(id, balance)
      const pick = js[Math.floor(js.length / 2)]
      const d = new Date(pick.date)
      const queries = [
        '', 'upi', 'diwali', 'got', 'sale', String(Math.round(pick.amount)), pick.amount.toFixed(2),
        pick.invoiceNo ?? 'cash', d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), '100%', 'cash diwali',
      ]
      for (const filter of HISTORY_FILTERS) {
        for (const q of queries) {
          const want = filterHistory(js, { filter, q, label }).map((e) => e.id)
          const got = await sqlAll(id, balance, { filter, q })
          expect([filter, q, got.entries.map((e) => e.id)]).toEqual([filter, q, want])
          expect(got.total).toBe(want.length)
          asked++
        }
      }
    }
    console.log(`${asked} filter × search questions: all the same`)
  })

  it('a big khata: the old 500 + 500 loading gets older balances wrong; the database does not', async () => {
    const id = await makeKhata(99, { bills: 60, pays: 620, years: 3 })
    khatas.push(id)
    const { balance } = await computePartyBalance(userId, id)
    const truth = await jsHistory(id, balance)
    const old = await jsHistory(id, balance, 500)
    const sql = (await sqlAll(id, balance)).entries
    const truthBy = new Map(truth.map((e) => [e.id, paise(e.runningBalance)]))
    const wrongOld = old.filter((e) => truthBy.get(e.id) !== paise(e.runningBalance))
    const wrongSql = sql.filter((e) => truthBy.get(e.id) !== paise(e.runningBalance))
    console.log(`big khata: ${truth.length} entries; old loading showed ${old.length}, ${wrongOld.length} with a wrong balance after; database: ${wrongSql.length} wrong`)
    expect(wrongOld.length).toBeGreaterThan(0)
    expect(wrongSql.length).toBe(0)
    expect(sql.length).toBe(truth.length)
  })
})
