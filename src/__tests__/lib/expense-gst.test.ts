/**
 * 9c-3 (#159): an expense's GST bill. Worked by hand:
 *   ₹1,000 rent at 18%: tax ₹180. Same state → CGST ₹90 + SGST ₹90; other state → IGST ₹180.
 *   Cash ₹1,180, cost ₹1,000 (the ₹180 comes back as credit — Rahul, 13 Nov 2026).
 *   Reverse charge: the landlord charges nothing, so cash ₹1,000; the ₹180 is owed in 3.1(d).
 */
import { expenseAmounts, expenseTakesGst, expenseCost, INWARD_TAX_TYPES } from '@/lib/expense-cost'
import { readCode } from '@/test-support/read-source'

describe('what a regular shop’s GST expense stores', () => {
  it('₹1,000 at 18%, same state', () => {
    const a = expenseAmounts({ amountBeforeGst: 1000, rate: 18, interState: false, reverseCharge: false })
    expect(a).toEqual({ subtotal: 1000, cgst: 90, sgst: 90, igst: 0, totalAmount: 1180, isReverseCharge: false })
    expect(expenseCost(a)).toBe(1000)
  })

  it('₹1,000 at 18%, another state', () => {
    expect(expenseAmounts({ amountBeforeGst: 1000, rate: 18, interState: true, reverseCharge: false }))
      .toEqual({ subtotal: 1000, cgst: 0, sgst: 0, igst: 180, totalAmount: 1180, isReverseCharge: false })
  })

  it('reverse charge: pays ₹1,000, owes ₹180', () => {
    expect(expenseAmounts({ amountBeforeGst: 1000, rate: 18, interState: false, reverseCharge: true }))
      .toEqual({ subtotal: 1000, cgst: 90, sgst: 90, igst: 0, totalAmount: 1000, isReverseCharge: true })
  })

  it('odd paise: ₹333.33 at 5% → tax ₹16.67 = CGST ₹8.34 + SGST ₹8.33, exact', () => {
    const a = expenseAmounts({ amountBeforeGst: 333.33, rate: 5, interState: false, reverseCharge: false })
    expect([a.cgst, a.sgst, a.totalAmount]).toEqual([8.34, 8.33, 350])
  })
})

describe('only a regular shop may give GST details', () => {
  it('regular yes; composition and not registered no', () => {
    expect(expenseTakesGst('regular')).toBe(true)
    expect(expenseTakesGst('composition')).toBe(false)
    expect(expenseTakesGst('unregistered')).toBe(false)
  })
  it('both save paths refuse otherwise, and split by the bill’s place of supply', () => {
    for (const f of ['app/api/transactions/route.ts', 'app/api/transactions/[id]/route.ts']) {
      const code = readCode(f)
      expect(code).toContain('if (!expenseTakesGst(gstStatus(s))) {')
      expect(code).toContain('gstAmounts = expenseAmounts({ ...expenseGst, interState: !!isInterState })')
    }
  })
})

describe('the Tally export posts an expense like a purchase', () => {
  // Found while building: the expense ledger took the cash (₹1,180) and the GST was posted as if
  // collected on a sale. Now: expense ledger at cost (₹1,000), CGST/SGST debited (input tax).
  const code = readCode('lib/tally-export.ts')
  it('cost to the expense ledger, GST as input', () => {
    expect(code).toContain("const taxIsInput = isPurchase || t.type === 'expense'")
    expect(code).toContain("<AMOUNT>${expenseCost(t).toFixed(2)}</AMOUNT>`")
    expect(code.match(/\$\{taxIsInput \? 'No' : 'Yes'\}/g)?.length).toBe(3)
  })
})

describe('the expense form', () => {
  const code = readCode('components/income/IncomeExpense.tsx')
  it('offers GST only to a regular shop, and sends it only when switched on', () => {
    expect(code).toContain('const canGst = isExpense && expenseTakesGst(gstStatus(setting))')
    expect(code).toContain('...(canGst && gstOn ? {')
    expect(code).toContain('expenseGst: { amountBeforeGst: amt, rate: gstRate, reverseCharge },')
  })
})

describe('an edit that does not send the GST bill keeps it', () => {
  // Found before shipping: the bill screen's edit sends only totalAmount (the cash). Treated
  // as "no GST", it would have saved ₹1,180 as the cost and dropped the ₹180 credit.
  const code = readCode('app/api/transactions/[id]/route.ts')
  it('undefined keeps the stored split; a changed amount is refused', () => {
    expect(code).toContain('const keepStoredGst = type === \'expense\' && expenseGst === undefined && hadGst')
    expect(code).toContain('if (keepStoredGst && roundMoney(amount) !== roundMoney(existing.totalAmount)) {')
    expect(code).toContain('} : keepStoredGst ? {} : {')
  })
})

describe('GSTR-3B and the GSTR-2B claim read expenses with purchases', () => {
  it('one list: purchase and expense', () => {
    expect(INWARD_TAX_TYPES).toEqual(['purchase', 'expense'])
  })
  it('every 3B credit / reverse-charge query and the claim candidates use it', () => {
    const g3 = readCode('app/api/gstr-3b/route.ts')
    expect(g3.match(/type: \{ in: INWARD_TAX_TYPES \}/g)?.length).toBe(5)
    // the only purchase-only query left there is the exempt-inward one (raw SQL on unregistered suppliers)
    expect(g3).not.toMatch(/type: 'purchase', deletedAt: null, isReverseCharge/)
    expect(g3).toContain(`AND t."type" = 'expense'`)
    expect(readCode('lib/gstr2b-context.ts')).toContain('userId, type: { in: INWARD_TAX_TYPES }, deletedAt: null, isReverseCharge: false,')
  })
})
