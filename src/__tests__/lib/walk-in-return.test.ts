/**
 * #276 (Phase 6b): a walk-in sale can be returned against its bill.
 *
 * Found on the 6a local check: New Sale's credit note refused "Add a customer
 * to this return" when none was picked; with one picked, the server refused
 * "party does not match the original invoice". And even with no customer sent,
 * the route files a party-less return under the shop's reserved Walk-in
 * Customer (lib/walk-in-party.ts — the CA's #2 issue) and then compared that
 * with the bill's empty customer. So the counter return the walk-in party was
 * built for was impossible, and the shop paid output GST on goods that came
 * back. Also: the return screen showed "₹100 due" to nobody (#278) and its
 * header said "New Sale" (#277).
 */
import { describe, test, expect } from '@jest/globals'
import { notePartiesMatch, validateNoteAgainstOriginal, type NoteValidationDb } from '@/lib/note-validation'
import { headerTitleKey } from '@/components/layout/Header'
import { readCode } from '@/test-support/read-source'

describe('notePartiesMatch — the walk-in bill and the Walk-in Customer are one customer', () => {
  const W = 'walkin-1'
  test('a counter return matches a walk-in bill, either way round', () => {
    expect(notePartiesMatch(null, W, W)).toBe(true)
    expect(notePartiesMatch(W, null, W)).toBe(true)
    expect(notePartiesMatch(null, null, W)).toBe(true)
    expect(notePartiesMatch(null, null, null)).toBe(true)
    expect(notePartiesMatch('ramesh', 'ramesh', W)).toBe(true)
  })
  test('any other pair must match exactly', () => {
    expect(notePartiesMatch('ramesh', W, W)).toBe(false) // Ramesh's bill returned "by the counter"
    expect(notePartiesMatch(null, 'ramesh', W)).toBe(false) // a walk-in bill returned to Ramesh's khata
    expect(notePartiesMatch('ramesh', 'sunita', W)).toBe(false)
    expect(notePartiesMatch(null, W, null)).toBe(false) // no walk-in party exists: strict
    expect(notePartiesMatch(null, 'someone', 'other-walkin')).toBe(false)
  })
})

describe('validateNoteAgainstOriginal with the shop\'s walk-in party', () => {
  const WALK_IN_SALE = { id: 'orig1', type: 'sale', partyId: null, totalAmount: 105, invoiceNo: 'INV-0012' }
  const db = (walkInId: string | null): NoteValidationDb => ({
    transaction: {
      async findFirst() { return WALK_IN_SALE },
      async aggregate() { return { _sum: { totalAmount: 0 } } },
    },
    party: { async findFirst() { return walkInId ? { id: walkInId } : null } },
  })
  const base = { userId: 'u1', type: 'credit-note', originalTransactionId: 'orig1', noteTotal: 105 }

  test('a return filed under Walk-in Customer passes against the walk-in bill', async () => {
    expect(await validateNoteAgainstOriginal(db('w1'), { ...base, partyId: 'w1' })).toEqual({ ok: true })
  })
  test('a return to a named customer is still refused against a walk-in bill', async () => {
    const res = await validateNoteAgainstOriginal(db('w1'), { ...base, partyId: 'ramesh' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Party mismatch')
  })
})

describe('the screen lets a counter return through, refunded by default', () => {
  const code = readCode('src/components/ledger/TransactionEntry.tsx')
  test('only a debit note (supplier return) still needs its party on the screen', () => {
    expect(code).toContain('if (isDebitNote && !partyId) {')
    expect(code).not.toMatch(/if \(isNote && !partyId\)/)
  })
  test('with no customer, "cash refunded" is the default; a choice is kept', () => {
    expect(code).toContain('const cashRefundOn = cashRefund ?? (isCreditNote && !partyId)')
    expect(code).toContain('useState<boolean | null>(null)')
    // every use reads the effective value, never the raw choice
    expect(code).not.toMatch(/\{cashRefund\s*&&|\? \(cashRefund \?|checked=\{cashRefund\}/)
  })
  test('the routes still resolve a party-less return to the walk-in party, before the check', () => {
    for (const f of ['src/app/api/transactions/route.ts', 'src/app/api/transactions/[id]/route.ts']) {
      expect(readCode(f)).toContain('getOrCreateWalkInParty(db, userId)')
    }
    expect(readCode('src/lib/note-validation.ts')).toContain('notePartiesMatch(original.partyId || null, partyId || null, walkInPartyId)')
  })
})

describe('#277: the header names a return', () => {
  test('credit / debit note on the entry screens; everything else unchanged', () => {
    expect(headerTitleKey('new-sale', null, 'credit-note')).toBe('entry.credit_note')
    expect(headerTitleKey('new-purchase', null, 'debit-note')).toBe('entry.debit_note')
    expect(headerTitleKey('new-sale', null, 'sale')).toBe('action.new_sale')
    expect(headerTitleKey('new-sale')).toBe('action.new_sale')
    expect(headerTitleKey('new-purchase', null, 'purchase')).toBe('action.new_purchase')
  })
})
