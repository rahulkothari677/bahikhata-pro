/**
 * 🔒 AUDIT C5 — repeated part-payments must walk ONE bill's due down, not jump
 * it to zero and not spill onto other bills.
 *
 * User-reported requirement: "if anyone gives the payment in partial again and
 * again then it should enter in that way in the bill and not full bill,
 * otherwise it will confuse the user."
 *
 * A customer paying ₹200 at a time against a ₹553 bill is ordinary, not an edge
 * case. Each payment must land on that same bill and reduce it by exactly what
 * was handed over — 553 → 353 → 153 → 0 — with the bill only reading "Paid"
 * when it genuinely is.
 */

import {
  computeInvoiceDue,
  computeDueBreakdown,
  validateAllocations,
  planAllocationOldestFirst,
  type AllocatableBill,
} from '@/lib/invoice-due'
import { roundMoney } from '@/lib/money'

describe('C5 — repeated partial payments against one bill', () => {
  test('three part-payments walk the due down step by step', () => {
    const total = 553
    let allocated = 0

    // ₹200, then ₹200, then ₹153.
    const steps = [200, 200, 153]
    const seen: number[] = []

    for (const pay of steps) {
      const bill: AllocatableBill = {
        id: 'b1', date: '2026-04-28', totalAmount: total, paidAmount: 0,
        allocatedAmount: allocated,
      }
      // Each payment must be accepted against the bill's REMAINING due.
      expect(validateAllocations([{ transactionId: 'b1', amount: pay }],
        new Map([['b1', bill]]), pay)).toBeNull()

      allocated = roundMoney(allocated + pay)
      seen.push(computeInvoiceDue({ totalAmount: total, paidAmount: 0, allocatedAmount: allocated }))
    }

    expect(seen).toEqual([353, 153, 0])
  })

  test('the bill is not marked paid until it actually is', () => {
    const total = 553
    for (const [allocated, expectPaid] of [[200, false], [552.99, false], [553, true]] as const) {
      const b = computeDueBreakdown({ totalAmount: total, paidAmount: 0, allocatedAmount: allocated })
      expect(b.isFullyPaid).toBe(expectPaid)
    }
  })

  test('a part-payment cannot exceed what is left on that bill', () => {
    // Bill of 553 with 400 already settled → only 153 remains.
    const bill: AllocatableBill = {
      id: 'b1', date: '2026-04-28', totalAmount: 553, paidAmount: 0, allocatedAmount: 400,
    }
    const err = validateAllocations(
      [{ transactionId: 'b1', amount: 200 }],
      new Map([['b1', bill]]),
      200,
    )
    expect(err).toMatch(/only ₹153\.00 still due/)
  })

  test('paying MORE than one bill needs does not silently swallow the excess', () => {
    // 553 due, ₹800 handed over. 553 clears the bill; 247 must remain visible
    // as an advance rather than vanishing into it.
    const bills = [{ id: 'b1', date: '2026-04-28', totalAmount: 553, paidAmount: 0 }]
    const plan = planAllocationOldestFirst(bills, 800)
    expect(plan.allocations).toEqual([{ transactionId: 'b1', amount: 553 }])
    expect(plan.unallocated).toBe(247)
  })

  test('the breakdown keeps counter-payment and later settlements separate', () => {
    // A bill part-paid at billing AND part-settled later must show both, so the
    // shopkeeper can tell where the money came from rather than seeing one
    // merged figure.
    const b = computeDueBreakdown({ totalAmount: 1106, paidAmount: 300, allocatedAmount: 253 })
    expect(b.paidAtBilling).toBe(300)
    expect(b.settledLater).toBe(253)
    expect(b.totalPaid).toBe(553)
    expect(b.due).toBe(553)
  })

  test('mixed part-payments across two bills stay on their own bills', () => {
    // Explicit allocation: ₹100 to the newer bill, ₹50 to the older one.
    // Neither may bleed into the other.
    const bills = new Map<string, AllocatableBill>([
      ['old', { id: 'old', date: '2026-01-01', totalAmount: 1000, paidAmount: 0 }],
      ['new', { id: 'new', date: '2026-02-01', totalAmount: 500, paidAmount: 0 }],
    ])
    const manual = [
      { transactionId: 'new', amount: 100 },
      { transactionId: 'old', amount: 50 },
    ]
    expect(validateAllocations(manual, bills, 150)).toBeNull()

    expect(computeInvoiceDue({ totalAmount: 500, paidAmount: 0, allocatedAmount: 100 })).toBe(400)
    expect(computeInvoiceDue({ totalAmount: 1000, paidAmount: 0, allocatedAmount: 50 })).toBe(950)
  })
})

/**
 * 🔒 Settling ONE bill repeatedly, the way it happens at a counter.
 *
 * Rahul, 2026-08-03: opening a ₹400 bill and typing ₹200 must record ₹200
 * against THAT bill — not refuse, and not silently take the full ₹400.
 *
 * This mirrors the allocation rule in PartySettle: the targeted bill is paid
 * first, capped at its own due; any remainder flows oldest-first to the others.
 */
describe('C5 — settling a targeted bill, amount-driven', () => {
  /** Mirrors the allocation effect in PartySettle.tsx. */
  function planForTargetedBill(
    bills: Array<{ id: string; date: string; totalAmount: number; paidAmount: number; allocatedAmount?: number }>,
    targetId: string | null,
    amount: number,
  ): Record<string, number> {
    const withDue = bills.map(b => ({ ...b, due: computeInvoiceDue(b) })).filter(b => b.due > 0)
    const out: Record<string, number> = {}
    let remaining = roundMoney(amount)
    const target = targetId ? withDue.find(b => b.id === targetId) : null
    if (target) {
      const give = roundMoney(Math.min(remaining, target.due))
      if (give > 0) { out[target.id] = give; remaining = roundMoney(remaining - give) }
    }
    if (remaining > 0) {
      const rest = target ? withDue.filter(b => b.id !== target.id) : withDue
      for (const a of planAllocationOldestFirst(rest, remaining).allocations) {
        out[a.transactionId] = a.amount
      }
    }
    return out
  }

  const bills = [
    { id: 'old', date: '2026-01-01', totalAmount: 1000, paidAmount: 0 },
    { id: 'target', date: '2026-03-01', totalAmount: 400, paidAmount: 0 },
  ]

  test('typing less than the due pays only that much, to that bill', () => {
    expect(planForTargetedBill(bills, 'target', 200)).toEqual({ target: 200 })
  })

  test('the target is paid before older bills, despite being newer', () => {
    // Plain oldest-first would have sent all 400 to `old`.
    expect(planForTargetedBill(bills, 'target', 400)).toEqual({ target: 400 })
  })

  test('a remainder flows oldest-first across the others', () => {
    // 400 clears the target, 100 goes to the older bill.
    expect(planForTargetedBill(bills, 'target', 500)).toEqual({ target: 400, old: 100 })
  })

  test('with no target it is plain oldest-first', () => {
    expect(planForTargetedBill(bills, null, 500)).toEqual({ old: 500 })
  })

  test('repeated part-payments walk the SAME bill down to zero', () => {
    let allocated = 0
    const seen: number[] = []
    for (const pay of [200, 100, 100]) {
      const b = [{ id: 'target', date: '2026-03-01', totalAmount: 400, paidAmount: 0, allocatedAmount: allocated }]
      const plan = planForTargetedBill(b, 'target', pay)
      expect(plan).toEqual({ target: pay })
      allocated = roundMoney(allocated + pay)
      seen.push(computeInvoiceDue({ totalAmount: 400, paidAmount: 0, allocatedAmount: allocated }))
    }
    expect(seen).toEqual([200, 100, 0])
  })

  test('paying more than the target owes does not overfill it', () => {
    const only = [{ id: 'target', date: '2026-03-01', totalAmount: 400, paidAmount: 0 }]
    // 400 lands on the bill; the extra 100 has nowhere to go and stays an advance.
    expect(planForTargetedBill(only, 'target', 500)).toEqual({ target: 400 })
  })
})
