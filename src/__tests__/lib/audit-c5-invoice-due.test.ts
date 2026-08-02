/**
 * 🔒 AUDIT C5 — the shared "due" rule.
 *
 * This is the riskiest part of the C5 change, because `due` is rendered in the
 * ledger list, bill detail, party statement, reminders, ageing and PDFs. Get it
 * wrong and several screens show wrong numbers at once.
 *
 * So the first and most important assertion here is a BACKWARD-COMPATIBILITY
 * one: with no allocations, the new rule must return exactly what the old
 * `totalAmount − paidAmount` returned. Every existing bill has no allocations,
 * so if that holds, shipping this cannot change a single number on screen until
 * an allocation actually exists.
 */

import {
  computeInvoiceDue,
  computeDueBreakdown,
  planAllocationOldestFirst,
  validateAllocations,
  type AllocatableBill,
} from '@/lib/invoice-due'
import { roundMoney } from '@/lib/money'

describe('C5 — computeInvoiceDue is backward-compatible', () => {
  test('with NO allocations it equals the old totalAmount − paidAmount', () => {
    const cases: Array<[number, number]> = [
      [1000, 0],
      [1000, 1000],
      [1000, 250],
      [2992.5, 0],
      [2992.5, 2992.5],
      [0, 0],
      [99.99, 33.33],
      [1, 0.99],
    ]
    for (const [total, paid] of cases) {
      const legacy = roundMoney(total - paid)
      expect(computeInvoiceDue({ totalAmount: total, paidAmount: paid })).toBe(legacy)
    }
  })

  test('null/undefined paidAmount behaves as zero, as the old code did', () => {
    expect(computeInvoiceDue({ totalAmount: 500, paidAmount: null })).toBe(500)
    expect(computeInvoiceDue({ totalAmount: 500 })).toBe(500)
  })
})

describe('C5 — allocations reduce the due', () => {
  test('the exact scenario from the bug report', () => {
    // INV-0042: Rs 2,992.50, nothing paid at billing, Rs 1,000 settled later.
    // Before the fix the bill showed "Due: Rs 2,992.50" while the party showed
    // Rs 1,992.50 outstanding — a permanent Rs 1,000 disagreement.
    const due = computeInvoiceDue({
      totalAmount: 2992.5,
      paidAmount: 0,
      allocatedAmount: 1000,
    })
    expect(due).toBe(1992.5)
  })

  test('paid-at-billing and settled-later both count', () => {
    expect(computeInvoiceDue({ totalAmount: 1000, paidAmount: 400, allocatedAmount: 350 })).toBe(250)
  })

  test('a fully settled bill reads zero, not a negative', () => {
    expect(computeInvoiceDue({ totalAmount: 1000, paidAmount: 0, allocatedAmount: 1000 })).toBe(0)
  })

  test('over-allocation clamps at zero rather than going negative', () => {
    // The write path prevents this; the clamp exists because a negative due
    // would subtract from OTHER bills wherever dues are summed, turning one
    // over-collection into a wrong total everywhere.
    expect(computeInvoiceDue({ totalAmount: 1000, paidAmount: 0, allocatedAmount: 1500 })).toBe(0)
  })
})

describe('C5 — the breakdown shown on the bill', () => {
  test('splits the money so the bill can explain itself', () => {
    const b = computeDueBreakdown({ totalAmount: 2992.5, paidAmount: 0, allocatedAmount: 1000 })
    expect(b).toEqual({
      totalAmount: 2992.5,
      paidAtBilling: 0,
      settledLater: 1000,
      totalPaid: 1000,
      due: 1992.5,
      isFullyPaid: false,
    })
  })

  test('isFullyPaid flips only when nothing is left', () => {
    expect(computeDueBreakdown({ totalAmount: 100, paidAmount: 99.99 }).isFullyPaid).toBe(false)
    expect(computeDueBreakdown({ totalAmount: 100, paidAmount: 100 }).isFullyPaid).toBe(true)
    expect(computeDueBreakdown({ totalAmount: 100, allocatedAmount: 100 }).isFullyPaid).toBe(true)
  })
})

describe('C5 — oldest-first allocation', () => {
  const bill = (id: string, date: string, total: number, paid = 0, alloc = 0): AllocatableBill =>
    ({ id, date, totalAmount: total, paidAmount: paid, allocatedAmount: alloc })

  test('clears the oldest bill first', () => {
    const plan = planAllocationOldestFirst(
      [bill('b', '2026-02-01', 1000), bill('a', '2026-01-01', 1000)],
      600,
    )
    expect(plan.allocations).toEqual([{ transactionId: 'a', amount: 600 }])
    expect(plan.unallocated).toBe(0)
  })

  test('spills over into the next bill once the oldest is cleared', () => {
    const plan = planAllocationOldestFirst(
      [bill('a', '2026-01-01', 1000), bill('b', '2026-02-01', 1000)],
      1500,
    )
    expect(plan.allocations).toEqual([
      { transactionId: 'a', amount: 1000 },
      { transactionId: 'b', amount: 500 },
    ])
    expect(plan.unallocated).toBe(0)
  })

  test('skips bills that are already settled', () => {
    const plan = planAllocationOldestFirst(
      [
        bill('paid', '2026-01-01', 1000, 1000),   // settled at billing
        bill('alloc', '2026-01-02', 1000, 0, 1000), // settled by an earlier payment
        bill('open', '2026-01-03', 1000),
      ],
      400,
    )
    expect(plan.allocations).toEqual([{ transactionId: 'open', amount: 400 }])
  })

  test('respects part-paid bills — takes only what is still due', () => {
    const plan = planAllocationOldestFirst(
      [bill('a', '2026-01-01', 1000, 700), bill('b', '2026-02-01', 1000)],
      500,
    )
    expect(plan.allocations).toEqual([
      { transactionId: 'a', amount: 300 },  // only 300 was left on it
      { transactionId: 'b', amount: 200 },
    ])
  })

  test('an over-payment leaves a remainder as an advance, not forced onto a bill', () => {
    const plan = planAllocationOldestFirst([bill('a', '2026-01-01', 1000)], 2500)
    expect(plan.allocations).toEqual([{ transactionId: 'a', amount: 1000 }])
    expect(plan.unallocated).toBe(1500)
  })

  test('with no open bills the whole payment is an advance', () => {
    expect(planAllocationOldestFirst([], 900)).toEqual({ allocations: [], unallocated: 900 })
    expect(planAllocationOldestFirst([bill('a', '2026-01-01', 100, 100)], 900).unallocated).toBe(900)
  })

  test('same-day bills allocate deterministically', () => {
    // Several bills on one day is normal in a shop. Without the id tiebreak the
    // result would depend on database row order, so the same payment could
    // allocate differently on two runs.
    const bills = [bill('z', '2026-01-01', 500), bill('a', '2026-01-01', 500)]
    const first = planAllocationOldestFirst(bills, 500)
    const second = planAllocationOldestFirst([...bills].reverse(), 500)
    expect(first.allocations).toEqual(second.allocations)
    expect(first.allocations[0].transactionId).toBe('a')
  })

  test('every plan conserves the money exactly', () => {
    const bills = [
      bill('a', '2026-01-01', 333.33),
      bill('b', '2026-01-02', 666.67, 100),
      bill('c', '2026-01-03', 1000, 0, 250),
    ]
    for (const amount of [0.01, 10, 333.33, 999.99, 1650, 5000]) {
      const plan = planAllocationOldestFirst(bills, amount)
      const allocated = plan.allocations.reduce((s, a) => s + a.amount, 0)
      expect(roundMoney(allocated + plan.unallocated)).toBe(roundMoney(amount))
    }
  })
})

describe('C5 — validateAllocations is the guard that closes the defect', () => {
  const bills = new Map<string, AllocatableBill>([
    ['open', { id: 'open', date: '2026-01-01', totalAmount: 1000, paidAmount: 0 }],
    ['part', { id: 'part', date: '2026-01-02', totalAmount: 1000, paidAmount: 600 }],
    ['done', { id: 'done', date: '2026-01-03', totalAmount: 1000, paidAmount: 1000 }],
  ])

  test('accepts a valid allocation', () => {
    expect(validateAllocations([{ transactionId: 'open', amount: 1000 }], bills, 1000)).toBeNull()
  })

  test('REFUSES to settle an already-paid bill — the original double-collection', () => {
    const err = validateAllocations([{ transactionId: 'done', amount: 1000 }], bills, 1000)
    expect(err).toMatch(/already fully paid/i)
  })

  test('refuses to over-settle a part-paid bill', () => {
    const err = validateAllocations([{ transactionId: 'part', amount: 500 }], bills, 500)
    expect(err).toMatch(/only ₹400\.00 still due/)
  })

  test('refuses a bill belonging to someone else', () => {
    const err = validateAllocations([{ transactionId: 'someone-elses', amount: 10 }], bills, 10)
    expect(err).toMatch(/does not belong to this party/i)
  })

  test('refuses allocations exceeding the payment itself', () => {
    const err = validateAllocations(
      [{ transactionId: 'open', amount: 1000 }, { transactionId: 'part', amount: 400 }],
      bills,
      1000,
    )
    expect(err).toMatch(/exceed the payment amount/i)
  })

  test('refuses zero and negative amounts', () => {
    expect(validateAllocations([{ transactionId: 'open', amount: 0 }], bills, 100)).toMatch(/greater than zero/i)
    expect(validateAllocations([{ transactionId: 'open', amount: -5 }], bills, 100)).toMatch(/greater than zero/i)
  })

  test('a plan produced by planAllocationOldestFirst always validates', () => {
    // The auto-allocation path must never generate something its own guard
    // rejects, or ordinary payments would start failing.
    const list = [...bills.values()]
    for (const amount of [1, 400, 1400, 5000]) {
      const plan = planAllocationOldestFirst(list, amount)
      expect(validateAllocations(plan.allocations, bills, amount)).toBeNull()
    }
  })
})
