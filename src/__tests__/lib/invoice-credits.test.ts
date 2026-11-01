/**
 * 8f-2 — a credit/debit note against a bill lowers that bill's due, in the
 * TypeScript rule and its SQL twin alike.
 *
 * Found 1 Nov on the local copy: after a ₹165 discount on a ₹1,650 credit
 * sale, Home said ₹1,485 to collect but the bill still said "Due ₹1,650" and
 * offered "Settle ₹1,650".
 */
import { computeInvoiceDue, computeDueBreakdown, planAllocationOldestFirst } from '@/lib/invoice-due'
import { creditsFromNotes } from '@/lib/invoice-credits'
import { readCode } from '@/test-support/read-source'

describe('the rule', () => {
  test('₹1,650 bill, nothing paid, ₹165 discount note → ₹1,485 due', () => {
    expect(computeInvoiceDue({ totalAmount: 1650, paidAmount: 0, allocatedAmount: 0, creditedAmount: 165 })).toBe(1485)
  })
  test('the breakdown names the credit, so the smaller due is explained', () => {
    const b = computeDueBreakdown({ totalAmount: 1650, paidAmount: 500, allocatedAmount: 200, creditedAmount: 165 })
    expect(b).toMatchObject({ totalPaid: 700, credited: 165, due: 785, isFullyPaid: false })
  })
  test('a paid bill stays at ₹0 — the extra credit is the khata\'s, never a negative due', () => {
    expect(computeInvoiceDue({ totalAmount: 1650, paidAmount: 1650, creditedAmount: 165 })).toBe(0)
  })
  test('#332 (part): a note tied to a bill owes nothing by itself — its ₹165 is in the bill\'s ₹1,485', () => {
    expect(computeInvoiceDue({ type: 'credit-note', originalTransactionId: 's1', totalAmount: 165, paidAmount: 0 })).toBe(0)
    expect(computeDueBreakdown({ type: 'credit-note', originalTransactionId: 's1', totalAmount: 165 }).due).toBe(0)
    // A note tied to no bill keeps total − paid (what that means is still #332's open question).
    expect(computeInvoiceDue({ type: 'credit-note', originalTransactionId: null, totalAmount: 80, paidAmount: 0 })).toBe(80)
  })
  test('no notes → the old answer, exactly', () => {
    expect(computeInvoiceDue({ totalAmount: 1650, paidAmount: 650, allocatedAmount: 100 })).toBe(900)
  })
  test('a payment is allocated only to what the notes left owing', () => {
    // Two bills of ₹1,000; the first has a ₹300 return. ₹1,000 paid → ₹700 to the first, ₹300 to the second.
    const plan = planAllocationOldestFirst([
      { id: 'a', date: '2026-10-01', totalAmount: 1000, creditedAmount: 300 },
      { id: 'b', date: '2026-10-02', totalAmount: 1000 },
    ], 1000)
    expect(plan.allocations).toEqual([{ transactionId: 'a', amount: 700 }, { transactionId: 'b', amount: 300 }])
  })
})

describe('which notes count', () => {
  test('total less cash refunded; deleted, unlinked and other types do not count', () => {
    const m = creditsFromNotes([
      { type: 'credit-note', originalTransactionId: 's1', totalAmount: 165, paidAmount: 0 },
      { type: 'credit-note', originalTransactionId: 's1', totalAmount: 100, paidAmount: 40 },   // ₹40 refunded in cash
      { type: 'credit-note', originalTransactionId: 's1', totalAmount: 50, paidAmount: 0, deletedAt: '2026-11-01' },
      { type: 'credit-note', originalTransactionId: null, totalAmount: 80, paidAmount: 0 },
      { type: 'sale', originalTransactionId: 's1', totalAmount: 999, paidAmount: 0 },
      { type: 'debit-note', originalTransactionId: 'p1', totalAmount: 230, paidAmount: 0 },
      { type: 'credit-note', originalTransactionId: 's2', totalAmount: 60, paidAmount: 60 },    // fully refunded
    ])
    expect(Object.fromEntries(m)).toEqual({ s1: 225, p1: 230 })
  })
})

describe('the SQL twin says the same', () => {
  const sql = readCode('src/lib/invoice-due-sql.ts')
  test('DUE_SQL subtracts the notes, and both joins carry them', () => {
    expect(sql).toContain(`ELSE t."totalAmount" - t."paidAmount" - COALESCE(a.alloc, 0) - COALESCE(cr.credited, 0) END)`)
    expect((sql.match(/\) cr ON /g) || []).length).toBe(2)
  })
  test('DUE_SQL gives a note tied to a bill ₹0, like the TypeScript rule', () => {
    expect(sql).toContain(`CASE WHEN t."type" IN ('credit-note', 'debit-note') AND t."originalTransactionId" IS NOT NULL THEN 0`)
  })
  test('same counting rule: notes not deleted, credit/debit, total less paid', () => {
    expect(sql).toContain(`SUM(n."totalAmount" - COALESCE(n."paidAmount", 0)) AS credited`)
    expect(sql).toContain(`n."deletedAt" IS NULL AND n."type" IN ('credit-note', 'debit-note')`)
  })
})

describe('every server source of a bill\'s due supplies the notes', () => {
  test.each([
    'src/app/api/transactions/route.ts',
    'src/app/api/transactions/[id]/route.ts',
    'src/app/api/parties/[id]/route.ts',
    'src/app/api/payments/route.ts',
    'src/app/api/whatsapp-invoice/route.ts',
    'src/app/api/whatsapp-reminder/route.ts',
    'src/app/api/ask/route.ts',
  ])('%s', (file) => {
    expect(readCode(file)).toMatch(/creditedAmount:/)
  })
})
