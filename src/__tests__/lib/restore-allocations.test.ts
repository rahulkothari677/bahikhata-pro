/**
 * @jest-environment node
 *
 * Re-attaching a restored payment to the bill it settled.
 *
 * WHY (audit 2026-08-14). `due = totalAmount − paidAmount − Σ(allocations)`.
 * The restore recreated payments and never their allocations, so a restored
 * shop had correct party balances while every individual invoice still read as
 * owing — the disagreement invoice-due.ts exists to prevent. The stale "Due" is
 * what invites a shopkeeper to chase a customer who has already paid.
 *
 * The governing principle in every case below: a payment attached to the WRONG
 * invoice is worse than one attached to none. A visible gap can be corrected; a
 * confident wrong number cannot even be noticed.
 */
import { decideAllocation, describeRefusedAllocation } from '@/lib/restore-allocations'
import fs from 'fs'
import path from 'path'

const BILL = 'INV-001|2026-07-20|1180'
const OTHER = 'INV-002|2026-07-21|500'

function ctx(over: Partial<Parameters<typeof decideAllocation>[1]> = {}) {
  return {
    txnIdByBillKey: new Map([[BILL, 'txn_new_1'], [OTHER, 'txn_new_2']]),
    ambiguousBillKeys: new Set<string>(),
    billTotals: new Map([
      ['txn_new_1', { totalAmount: 1180, paidAmount: 0 }],
      ['txn_new_2', { totalAmount: 500, paidAmount: 200 }],
    ]),
    allocatedSoFar: new Map<string, number>(),
    ...over,
  }
}

describe('the ordinary case', () => {
  it('links the payment to the bill under its NEW id', () => {
    const d = decideAllocation({ billKey: BILL, amount: 500 }, ctx())
    expect(d).toEqual({ ok: true, transactionId: 'txn_new_1', amount: 500 })
  })

  it('settles a bill exactly to zero when the payment covers it in full', () => {
    const d = decideAllocation({ billKey: BILL, amount: 1180 }, ctx())
    expect(d.ok).toBe(true)
  })

  it('respects what was already paid at billing time', () => {
    // txn_new_2 is ₹500 with ₹200 paid at the counter, so ₹300 remains.
    expect(decideAllocation({ billKey: OTHER, amount: 300 }, ctx()).ok).toBe(true)
    expect(decideAllocation({ billKey: OTHER, amount: 301 }, ctx()).ok).toBe(false)
  })
})

describe('it refuses rather than guesses', () => {
  it('when the file does not say which bill', () => {
    const d = decideAllocation({ amount: 500 }, ctx())
    expect(d).toMatchObject({ ok: false, reason: 'no-bill-named' })
  })

  it('when two bills share the same key', () => {
    /*
     * Two counter sales with no invoice number, same day, same amount are
     * indistinguishable. Picking whichever was last in the list is how one
     * customer ends up credited with another's money.
     */
    const d = decideAllocation({ billKey: BILL, amount: 500 }, ctx({ ambiguousBillKeys: new Set([BILL]) }))
    expect(d).toMatchObject({ ok: false, reason: 'ambiguous-bill' })
  })

  it('when the bill is not in this restore at all', () => {
    const d = decideAllocation({ billKey: 'INV-999|2026-01-01|100', amount: 500 }, ctx())
    expect(d).toMatchObject({ ok: false, reason: 'bill-not-restored' })
  })

  it('when the amount is zero or negative', () => {
    expect(decideAllocation({ billKey: BILL, amount: 0 }, ctx())).toMatchObject({ ok: false })
    expect(decideAllocation({ billKey: BILL, amount: -50 }, ctx())).toMatchObject({ ok: false })
  })

  it('on a null or missing allocation entry', () => {
    expect(decideAllocation(null, ctx()).ok).toBe(false)
    expect(decideAllocation(undefined, ctx()).ok).toBe(false)
  })
})

describe('a bill can never be settled past its own total', () => {
  it('refuses an allocation larger than the bill', () => {
    // Only reachable from a hand-edited or corrupted file — the write path
    // enforces paidAmount + Σ(allocations) ≤ totalAmount. But a NEGATIVE due
    // poisons every total built on top of it, so the restore checks anyway.
    const d = decideAllocation({ billKey: BILL, amount: 2000 }, ctx())
    expect(d).toMatchObject({ ok: false, reason: 'over-settles', room: 1180 })
  })

  it('counts what earlier payments in the SAME restore already re-attached', () => {
    /*
     * The real shape of this: two ₹600 receipts against one ₹1,180 bill. The
     * first is fine, the second must be cut to what is left. Checking each
     * allocation only against the bill total would let both through and leave
     * the invoice ₹20 overpaid.
     */
    const c = ctx({ allocatedSoFar: new Map([['txn_new_1', 600]]) })
    expect(decideAllocation({ billKey: BILL, amount: 580 }, c).ok).toBe(true)
    expect(decideAllocation({ billKey: BILL, amount: 600 }, c)).toMatchObject({
      ok: false, reason: 'over-settles', room: 580,
    })
  })

  it('reports the room as zero rather than a negative number', () => {
    const c = ctx({ allocatedSoFar: new Map([['txn_new_1', 1180]]) })
    const d = decideAllocation({ billKey: BILL, amount: 100 }, c)
    expect(d).toMatchObject({ ok: false, room: 0 })
  })
})

describe('every refusal is explained to the shopkeeper', () => {
  const reasons = ['no-bill-named', 'ambiguous-bill', 'bill-not-restored', 'not-positive', 'over-settles'] as const

  it.each(reasons)('%s produces a sentence, never an empty string', (reason) => {
    // Money that does not survive a restore has to be loud. "3 skipped" tells
    // nobody which customer to check.
    const text = describeRefusedAllocation(
      { ok: false, reason, room: 0 },
      { billKey: BILL, amount: 500, paymentAmount: 500, paymentType: 'received' },
    )
    expect(text.length).toBeGreaterThan(20)
    expect(text).not.toContain('undefined')
  })

  it('names the invoice so it can be found', () => {
    const text = describeRefusedAllocation(
      { ok: false, reason: 'bill-not-restored' },
      { billKey: BILL, amount: 500 },
    )
    expect(text).toContain('INV-001')
  })

  it('says something usable for a bill that never had an invoice number', () => {
    const text = describeRefusedAllocation(
      { ok: false, reason: 'bill-not-restored' },
      { billKey: '|2026-07-20|500', amount: 500 },
    )
    expect(text).toContain('no invoice no.')
  })
})

describe('the restore route actually uses this', () => {
  // The rule above is only worth testing if the restore path runs it. This is
  // a source check on purpose — it asserts wiring, which unit tests cannot see.
  const ROUTE = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/import/restore/route.ts'),
    'utf8',
  )

  it('imports and calls the decision', () => {
    expect(ROUTE).toMatch(/import \{ decideAllocation, describeRefusedAllocation \}/)
    expect(ROUTE).toMatch(/decideAllocation\(alloc, allocationCtx\)/)
  })

  it('writes the allocation only when the decision said yes', () => {
    const at = ROUTE.indexOf('db.paymentAllocation.create')
    expect(at).toBeGreaterThan(-1)
    const before = ROUTE.slice(Math.max(0, at - 600), at)
    expect(before).toMatch(/if \(!decision\.ok\)[\s\S]*continue/)
  })

  it('feeds the running total back, so the second payment sees the first', () => {
    expect(ROUTE).toMatch(/allocatedSoFar\.set\(\s*decision\.transactionId/)
  })

  it('tells the shopkeeper when links were skipped', () => {
    expect(ROUTE).toMatch(/allocationsSkipped > 0/)
    expect(ROUTE).toMatch(/still show as unpaid/)
  })

  it('sends that note in the warnings list the screen renders, not only in the message', () => {
    // The screen used to build its own toast and never render `message`, so a
    // note left there alone would be written, returned, and never seen.
    expect(ROUTE).toMatch(/warnings\.push\(note\)/)
  })

  it('names the first few refusals, so they can actually be found', () => {
    // "3 links skipped" tells nobody which invoices to check.
    expect(ROUTE).toMatch(/allocationReasons\.slice\(0, 3\)/)
  })
})
