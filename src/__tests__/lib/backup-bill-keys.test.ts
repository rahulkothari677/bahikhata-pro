/**
 * @jest-environment node
 *
 * The key that lets a restored payment find the bill it settled.
 *
 * WHY (audit 2026-08-14). A restore rebuilds every row with a fresh id, so
 * `PaymentAllocation.transactionId` in a backup file points at nothing on the
 * device reading it. Without a key that survives, allocations cannot come back
 * — and `due = totalAmount − paidAmount − Σ(allocations)`, so every invoice
 * would read as still owing while the party's overall balance came out right.
 * A stale "Due" is what invites a shopkeeper to chase a customer who has
 * already paid.
 *
 * Both ends call this one function on purpose. The first attempt at this fix
 * exported `partyId` while the restore joined on party NAME, and the mismatch
 * was invisible until a restore was actually attempted.
 */
import { billKey } from '@/lib/backup-keys'

describe('the same bill produces the same key on both sides', () => {
  it('matches when the date has been through JSON and back', () => {
    // The export writes an ISO timestamp; the restore re-parses it into a Date.
    // Comparing to the millisecond would fail on rows that are plainly the same
    // bill, which is why the key is reduced to a calendar day.
    const fromDatabase = { invoiceNo: 'INV-001', date: new Date('2026-08-01T09:15:22.431Z'), totalAmount: 1180 }
    const fromFile = { invoiceNo: 'INV-001', date: '2026-08-01T09:15:22.431Z', totalAmount: 1180 }
    expect(billKey(fromFile)).toBe(billKey(fromDatabase))
  })

  it('ignores the time of day', () => {
    expect(billKey({ invoiceNo: 'INV-001', date: '2026-08-01T00:00:00.000Z', totalAmount: 1180 }))
      .toBe(billKey({ invoiceNo: 'INV-001', date: '2026-08-01T23:59:59.000Z', totalAmount: 1180 }))
  })
})

describe('different bills produce different keys', () => {
  const base = { invoiceNo: 'INV-001', date: '2026-08-01', totalAmount: 1180 }

  it('separates two invoice numbers', () => {
    expect(billKey({ ...base, invoiceNo: 'INV-002' })).not.toBe(billKey(base))
  })

  it('separates two days', () => {
    expect(billKey({ ...base, date: '2026-08-02' })).not.toBe(billKey(base))
  })

  it('separates two amounts', () => {
    // Without the amount, a re-used invoice number would collide and a payment
    // could be attached to the wrong bill — worse than attaching it to none.
    expect(billKey({ ...base, totalAmount: 1181 })).not.toBe(billKey(base))
  })
})

describe('bills with no invoice number', () => {
  it('still produce a key rather than crashing', () => {
    // Cash-counter sales often have no invoice number at all.
    expect(billKey({ invoiceNo: null, date: '2026-08-01', totalAmount: 500 })).toBe('|2026-08-01|500')
  })

  it('two of them on the same day for the same amount COLLIDE, by design', () => {
    /*
     * This is the honest limit of the key, and the caller's contract: a
     * repeated key must be treated as "cannot be certain" and left alone, the
     * same way an ambiguous party name is. Recorded here so nobody later reads
     * the collision as a bug in this function and "fixes" it by guessing.
     */
    expect(billKey({ date: '2026-08-01', totalAmount: 500 }))
      .toBe(billKey({ date: '2026-08-01', totalAmount: 500 }))
  })
})

describe('missing pieces do not produce a misleading match', () => {
  it('treats a missing total as 0 rather than undefined', () => {
    expect(billKey({ invoiceNo: 'INV-9', date: '2026-08-01' })).toBe('INV-9|2026-08-01|0')
  })

  it('does not confuse a zero total with a missing one', () => {
    // Both are '0' deliberately — a bill of ₹0 and a bill with no total are the
    // same thing to a ledger. The test states it so the choice is visible.
    expect(billKey({ invoiceNo: 'INV-9', date: '2026-08-01', totalAmount: 0 }))
      .toBe(billKey({ invoiceNo: 'INV-9', date: '2026-08-01' }))
  })
})
