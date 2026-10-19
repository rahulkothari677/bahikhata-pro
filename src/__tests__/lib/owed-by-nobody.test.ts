/**
 * 🔒 GUARD: udhaar needs someone to owe it (19 Oct, Phase 5c-2).
 *
 * A walk-in sale saved with ₹510 unpaid sat in October's sales and in no
 * khata — "To collect" never showed it, nobody could be reminded. Neither
 * New Sale nor the server stopped it, and converting a walk-in estimate made
 * one too (the sale starts unpaid). The rule is one function; every route
 * that saves a sale or purchase calls it, and New Sale checks it before
 * saving (and before queueing offline).
 */
import { describe, test, expect } from '@jest/globals'
import { owedByNobody, owedByNobodyMessage } from '@/lib/paid-amount'
import { readCode } from '@/test-support/read-source'

describe('the rule', () => {
  test('a sale or purchase with no party must be paid in full', () => {
    expect(owedByNobody('sale', null, 510, 0)).toBe(true)
    expect(owedByNobody('sale', undefined, 1000, 999.5)).toBe(true)
    expect(owedByNobody('purchase', null, 2400, 1200)).toBe(true)
  })
  test('paid in full, a party named, or not a sale/purchase: allowed', () => {
    expect(owedByNobody('sale', null, 510, 510)).toBe(false)
    expect(owedByNobody('sale', null, 510, 510.004)).toBe(false)
    expect(owedByNobody('sale', 'p1', 510, 0)).toBe(false)
    expect(owedByNobody('estimate', null, 510, 0)).toBe(false)
    expect(owedByNobody('credit-note', null, 510, 0)).toBe(false)
  })
  test('the message names who is missing', () => {
    expect(owedByNobodyMessage('sale')).toMatch(/customer/)
    expect(owedByNobodyMessage('purchase')).toMatch(/supplier/)
  })
})

describe('every save path checks it', () => {
  test('new bill and edit routes refuse with NEEDS_PARTY after working out the paid amount', () => {
    for (const f of ['src/app/api/transactions/route.ts', 'src/app/api/transactions/[id]/route.ts']) {
      const code = readCode(f)
      const paid = code.indexOf('const finalPaid = resolveFinalPaid(')
      const check = code.indexOf('if (owedByNobody(type, partyId, totalAmount, finalPaid))')
      expect({ f, paid: paid > 0, checkAfterPaid: check > paid }).toEqual({ f, paid: true, checkAfterPaid: true })
    }
  })
  test('converting an estimate needs a customer; New Sale checks before saving', () => {
    expect(readCode('src/app/api/transactions/[id]/convert/route.ts')).toMatch(/if \(!estimate\.partyId\) \{\s*return NextResponse\.json\(\{[^}]*code: 'NEEDS_PARTY'/)
    const entry = readCode('src/components/ledger/TransactionEntry.tsx')
    const check = entry.indexOf('if (owedByNobody(actualType, partyId, totalAmount, paidAsSaved))')
    const post = entry.indexOf("offlineFetch('/api/transactions', {")
    expect({ check: check > 0, beforePost: check < post }).toEqual({ check: true, beforePost: true })
  })
})
