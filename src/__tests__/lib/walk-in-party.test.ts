/**
 * The counter customer who has no name.
 *
 * THE BUG. A cash sale to a walk-in has no party. When it came back, the app
 * refused the credit note and told the shopkeeper to adjust stock instead —
 * and a stock adjustment does not reduce output GST. So the shop paid tax on
 * a sale that came back, every time, on our own advice.
 *
 * The CA review ranked it second out of everything in the app: *"Nothing else
 * in this document costs users actual money the way this does, today."*
 *
 * The fix is a real reserved party rather than a null one, because every
 * downstream figure — receivable, ageing, statements, reminders — assumes a
 * note has somebody to credit. These tests pin both halves: the party is
 * found rather than duplicated, and it is never mistaken for a real customer.
 */

import fs from 'fs'
import path from 'path'
import { WALK_IN_PARTY_NAME, isWalkInParty, getOrCreateWalkInParty } from '@/lib/walk-in-party'

describe('identifying the reserved party', () => {
  test('recognises it by name', () => {
    expect(isWalkInParty({ name: 'Walk-in Customer' })).toBe(true)
  })

  test('recognises it whatever the casing or padding', () => {
    // It is matched case-insensitively when created, so the check must agree —
    // otherwise a shop ends up with two of them and split balances.
    expect(isWalkInParty({ name: 'walk-in customer' })).toBe(true)
    expect(isWalkInParty({ name: '  Walk-In CUSTOMER  ' })).toBe(true)
  })

  test('a real customer is never mistaken for it', () => {
    // This guard decides whether a payment reminder may be sent. A false
    // positive silences a real chase; a false negative texts nobody.
    expect(isWalkInParty({ name: 'Anil Kumar' })).toBe(false)
    expect(isWalkInParty({ name: 'Walk-in Traders' })).toBe(false)
    expect(isWalkInParty({ name: 'Customer' })).toBe(false)
    expect(isWalkInParty(null)).toBe(false)
    expect(isWalkInParty({})).toBe(false)
  })
})

describe('getOrCreateWalkInParty', () => {
  const party = { findFirst: jest.fn(), create: jest.fn() }
  const db = { party } as never
  beforeEach(() => { party.findFirst.mockReset(); party.create.mockReset() })

  test('reuses the existing one instead of creating a second', async () => {
    /*
     * The whole point of reserving it. A new party per refund would scatter
     * the balances this exists to keep whole, and fill the customer list with
     * identical rows.
     */
    party.findFirst.mockResolvedValue({ id: 'existing' })
    const id = await getOrCreateWalkInParty(db, 'user1')
    expect(id).toBe('existing')
    expect(party.create).not.toHaveBeenCalled()
  })

  test('creates it lazily, only when a counter return actually happens', async () => {
    party.findFirst.mockResolvedValue(null)
    party.create.mockResolvedValue({ id: 'new' })
    const id = await getOrCreateWalkInParty(db, 'user1')
    expect(id).toBe('new')
    expect(party.create).toHaveBeenCalledTimes(1)
  })

  test('is scoped to the shop and ignores deleted rows', async () => {
    party.findFirst.mockResolvedValue({ id: 'x' })
    await getOrCreateWalkInParty(db, 'user1')
    const where = party.findFirst.mock.calls[0][0].where
    expect(where.userId).toBe('user1')
    expect(where.deletedAt).toBeNull()
    // case-insensitive, or a shop accumulates duplicates
    expect(where.name).toEqual({ equals: WALK_IN_PARTY_NAME, mode: 'insensitive' })
  })

  test('carries no phone and no GSTIN', async () => {
    /*
     * No phone: it must never be sent a payment reminder — there is nobody to
     * send one to. No GSTIN: that is precisely what makes GSTR-1 treat its
     * credit notes as B2C and net them into B2CS, which is the treatment the
     * CA confirmed.
     */
    party.findFirst.mockResolvedValue(null)
    party.create.mockResolvedValue({ id: 'new' })
    await getOrCreateWalkInParty(db, 'user1')
    const data = party.create.mock.calls[0][0].data
    expect(data.phone).toBeNull()
    expect(data.gstin).toBeNull()
    expect(data.type).toBe('customer')
    expect(data.userId).toBe('user1')
  })
})

describe('the routes no longer refuse a party-less return', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

  test.each([
    ['src/app/api/transactions/route.ts', 'create'],
    ['src/app/api/transactions/[id]/route.ts', 'edit'],
  ])('%s (%s) resolves the walk-in party instead of returning 400', (file) => {
    const src = read(file)
    expect(src).toContain('getOrCreateWalkInParty')
    // the old rejection must be gone, not merely reworded
    expect(src).not.toContain("error: 'Add a customer to this return'")
  })

  test('it is resolved BEFORE place of supply is derived', () => {
    /*
     * ORDERING BUG THIS PINS. deriveInterStateStatus decides the CGST/SGST vs
     * IGST split from the party. Resolving the walk-in party after that call
     * would compute the tax split against a party that did not exist yet —
     * which I did on the first attempt, and typecheck caught only because the
     * variable was a const.
     */
    for (const file of ['src/app/api/transactions/route.ts', 'src/app/api/transactions/[id]/route.ts']) {
      const src = read(file)
      expect(src.indexOf('getOrCreateWalkInParty(db, userId)'))
        .toBeLessThan(src.indexOf('deriveInterStateStatus(userId, partyId)'))
    }
  })
})
