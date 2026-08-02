/**
 * 🔒 AUDIT C5 phase 4 — manual allocation is a SECURITY BOUNDARY, not a
 * convenience.
 *
 * When the server allocates oldest-first it controls the numbers entirely, so
 * validateAllocations() is belt-and-braces. The moment the client can send its
 * own allocation, that same function becomes the only thing standing between a
 * hand-crafted request and a corrupted ledger: over-settling a bill, settling
 * one already paid, or pointing at another party's invoice.
 *
 * These tests exercise it from the attacker's side, not the happy path.
 */

import {
  validateAllocations,
  planAllocationOldestFirst,
  computeInvoiceDue,
  type AllocatableBill,
} from '@/lib/invoice-due'
import { createPaymentSchema } from '@/lib/validation'

/** This party's open bills, as the route builds them. */
const bills = new Map<string, AllocatableBill>([
  ['old', { id: 'old', date: '2026-01-01', totalAmount: 1000, paidAmount: 0 }],
  ['mid', { id: 'mid', date: '2026-02-01', totalAmount: 1000, paidAmount: 600 }],
  ['new', { id: 'new', date: '2026-03-01', totalAmount: 2000, paidAmount: 0 }],
  ['done', { id: 'done', date: '2026-01-15', totalAmount: 500, paidAmount: 500 }],
])

describe('C5 phase 4 — the request the manual picker exists for', () => {
  test('"clear the current bill, leave the old one pending" is now possible', () => {
    // The customer asks for the NEWEST bill to be cleared while an older,
    // disputed one stays open. Oldest-first cannot express this.
    const manual = [{ transactionId: 'new', amount: 2000 }]
    expect(validateAllocations(manual, bills, 2000)).toBeNull()

    // And it is genuinely different from what auto would have done.
    const auto = planAllocationOldestFirst([...bills.values()], 2000)
    expect(auto.allocations[0].transactionId).toBe('old')
    expect(auto.allocations).not.toEqual(manual)
  })

  test('splitting one payment across chosen bills works', () => {
    const manual = [
      { transactionId: 'new', amount: 1500 },
      { transactionId: 'mid', amount: 400 },   // mid has exactly 400 left
    ]
    expect(validateAllocations(manual, bills, 1900)).toBeNull()
  })
})

describe('C5 phase 4 — what a hand-crafted request must NOT be able to do', () => {
  test('cannot settle a bill that is already fully paid', () => {
    const err = validateAllocations([{ transactionId: 'done', amount: 500 }], bills, 500)
    expect(err).toMatch(/already fully paid/i)
  })

  test('cannot over-settle a part-paid bill', () => {
    // 'mid' has only 400 left of its 1000.
    const err = validateAllocations([{ transactionId: 'mid', amount: 1000 }], bills, 1000)
    expect(err).toMatch(/only ₹400\.00 still due/)
  })

  test('cannot reach a bill belonging to another party', () => {
    // The route builds the map from THIS party's bills only, so an id from
    // elsewhere simply is not in it. That is the isolation boundary.
    const err = validateAllocations([{ transactionId: 'other-party-bill', amount: 1 }], bills, 1)
    expect(err).toMatch(/does not belong to this party/i)
  })

  test('cannot allocate more than the payment itself', () => {
    const err = validateAllocations(
      [{ transactionId: 'old', amount: 1000 }, { transactionId: 'new', amount: 2000 }],
      bills,
      1000,   // only ₹1,000 actually received
    )
    expect(err).toMatch(/exceed the payment amount/i)
  })

  test('cannot use zero or negative amounts to manufacture credit', () => {
    expect(validateAllocations([{ transactionId: 'old', amount: 0 }], bills, 100))
      .toMatch(/greater than zero/i)
    expect(validateAllocations([{ transactionId: 'old', amount: -500 }], bills, 100))
      .toMatch(/greater than zero/i)
  })

  test('amounts are aggregated PER BILL, not checked one entry at a time', () => {
    // Two entries pointing at the SAME bill, each individually under its due
    // (600 ≤ 1000) and summing within the payment (1200 ≤ 1200) — yet together
    // they over-settle a bill owing 1000 by 200.
    //
    // This test FAILED when first written: validateAllocations checked each
    // entry in isolation and never aggregated. The unique(paymentId,
    // transactionId) constraint would have rejected the second row at the
    // database, but as a P2002 crash producing a 500 rather than a clean
    // refusal — and validation is supposed to BE the boundary, not lean on a
    // constraint to catch what it missed. It mattered little while the server
    // built the plan itself; it matters now that a client can submit one.
    const err = validateAllocations(
      [{ transactionId: 'old', amount: 600 }, { transactionId: 'old', amount: 600 }],
      bills,
      1200,
    )
    expect(err).toMatch(/only ₹1,?000\.00 still due/)
  })

  test('two entries on one bill are fine when they sum within its due', () => {
    // The aggregation must not over-correct: 400 + 500 = 900 against a bill
    // owing 1000 is legitimate.
    expect(validateAllocations(
      [{ transactionId: 'old', amount: 400 }, { transactionId: 'old', amount: 500 }],
      bills,
      900,
    )).toBeNull()
  })
})

describe('C5 phase 4 — schema accepts the optional allocations array', () => {
  const base = { partyId: 'p1', amount: 1000, type: 'received' as const }

  test('omitting allocations is valid (the normal, one-field flow)', () => {
    const r = createPaymentSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.allocations).toBeUndefined()
  })

  test('a well-formed allocations array is accepted', () => {
    const r = createPaymentSchema.safeParse({
      ...base,
      allocations: [{ transactionId: 'old', amount: 600 }],
    })
    expect(r.success).toBe(true)
  })

  test('rejects a zero or negative allocation at the schema layer', () => {
    expect(createPaymentSchema.safeParse({
      ...base, allocations: [{ transactionId: 'old', amount: 0 }],
    }).success).toBe(false)
    expect(createPaymentSchema.safeParse({
      ...base, allocations: [{ transactionId: 'old', amount: -1 }],
    }).success).toBe(false)
  })

  test('rejects a missing transactionId', () => {
    expect(createPaymentSchema.safeParse({
      ...base, allocations: [{ transactionId: '', amount: 100 }],
    }).success).toBe(false)
  })
})

describe('C5 phase 4 — leftover stays an advance, it is not forced onto a bill', () => {
  test('allocating less than the payment leaves the remainder unallocated', () => {
    const amount = 5000
    const manual = [{ transactionId: 'new', amount: 2000 }]
    expect(validateAllocations(manual, bills, amount)).toBeNull()

    const allocated = manual.reduce((s, a) => s + a.amount, 0)
    expect(amount - allocated).toBe(3000)   // held on account
  })

  test('a bill fully settled manually reads zero due afterwards', () => {
    const bill = bills.get('new')!
    const after = computeInvoiceDue({ ...bill, allocatedAmount: 2000 })
    expect(after).toBe(0)
  })
})
