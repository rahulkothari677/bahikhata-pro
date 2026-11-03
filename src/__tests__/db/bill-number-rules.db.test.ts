/**
 * @jest-environment node
 *
 * #354 — who may share a bill number, checked against the real database indexes.
 *
 * RUNS ONLY AGAINST A REAL DATABASE: `BILL_NUMBER_DB=1` with DATABASE_URL pointing at
 * the local copy (`set -a; . ./.env.local; set +a`). CI has no database and skips it.
 *
 * A purchase carries the SUPPLIER's bill number, so it is unique per supplier among
 * live bills. The shop's own documents stay unique per shop, deleted ones included
 * (Rule 46(b): a unique serial, never reused).
 */
import { db } from '@/lib/db'

const run = process.env.BILL_NUMBER_DB === '1' ? describe : describe.skip
const TAG = `bn-${Date.now()}`
const made: { parties: string[]; txns: string[] } = { parties: [], txns: [] }
let userId = ''

const party = async (n: string) => {
  const p = await db.party.create({ data: { userId, name: `ZZ ${TAG} ${n}`, type: 'supplier' } as any })
  made.parties.push(p.id)
  return p.id
}
const bill = async (type: string, invoiceNo: string, partyId: string | null) => {
  const t = await db.transaction.create({ data: { userId, partyId, type, date: new Date(), totalAmount: 100, paidAmount: 0, invoiceNo } as any })
  made.txns.push(t.id)
  return t.id
}
const refused = async (p: Promise<unknown>) => {
  try { await p; return false } catch (e: any) { return e?.code === 'P2002' }
}

run('bill numbers (#354, local database)', () => {
  let a = ''
  let b = ''
  beforeAll(async () => {
    const u = await db.user.findFirst({ select: { id: true } })
    if (!u) throw new Error('no local user')
    userId = u.id
    a = await party('A')
    b = await party('B')
  })
  afterAll(async () => {
    await db.transaction.deleteMany({ where: { id: { in: made.txns } } })
    await db.party.deleteMany({ where: { id: { in: made.parties } } })
    console.log(`cleaned: ${made.txns.length} bills, ${made.parties.length} parties; left: ${await db.party.count({ where: { name: { startsWith: `ZZ ${TAG}` } } })}`)
    await db.$disconnect()
  })

  it('two suppliers may both send "INV-001"', async () => {
    await bill('purchase', `${TAG}-INV-001`, a)
    expect(await refused(bill('purchase', `${TAG}-INV-001`, b))).toBe(false)
  })

  it('the same supplier bill entered twice is refused', async () => {
    expect(await refused(bill('purchase', `${TAG}-INV-001`, a))).toBe(true)
  })

  it('after deleting a wrong entry, the supplier bill can be entered again', async () => {
    const id = await bill('purchase', `${TAG}-INV-002`, a)
    await db.transaction.update({ where: { id }, data: { deletedAt: new Date() } })
    expect(await refused(bill('purchase', `${TAG}-INV-002`, a))).toBe(false)
  })

  it('a supplier bill numbered like one of the shop’s own sales is fine', async () => {
    await bill('sale', `${TAG}-S-0001`, null)
    expect(await refused(bill('purchase', `${TAG}-S-0001`, a))).toBe(false)
  })

  it('the shop’s own numbers stay unique, and a deleted one stays reserved', async () => {
    expect(await refused(bill('sale', `${TAG}-S-0001`, null))).toBe(true)
    const id = await bill('credit-note', `${TAG}-CN-1`, null)
    await db.transaction.update({ where: { id }, data: { deletedAt: new Date() } })
    expect(await refused(bill('credit-note', `${TAG}-CN-1`, null))).toBe(true)
  })

  it('purchases with no supplier share one series (the app’s own PUR numbers)', async () => {
    await bill('purchase', `${TAG}-PUR-0001`, null)
    expect(await refused(bill('purchase', `${TAG}-PUR-0001`, null))).toBe(true)
  })
})
