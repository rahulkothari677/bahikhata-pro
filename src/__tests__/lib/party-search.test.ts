/**
 * Phase 6c-2 — finding a customer by phone the way a shopkeeper types it, and
 * starting "Add new" with what was typed. One phone rule for the server's
 * duplicate check and the bill screen.
 */
import { describe, test, expect } from '@jest/globals'
import { normalizePartyPhone, partyMatchesSearch, partyPrefillFromSearch } from '@/lib/party-search'
import { normalizePartyPhone as serverNormalize } from '@/lib/party-duplicate'
import { readCode } from '@/test-support/read-source'

const gupta = { name: 'Gupta ji', phone: '9829011223' }
const plus91 = { name: 'Ramesh', phone: '+91 98765 43210' }

describe('partyMatchesSearch', () => {
  test('a phone typed with spaces or +91 finds the stored number (it did not: #6c-2)', () => {
    expect(partyMatchesSearch(gupta, '98290 11223')).toBe(true)
    expect(partyMatchesSearch(gupta, '+91 98290 11223')).toBe(true)
    expect(partyMatchesSearch(plus91, '9876543210')).toBe(true)
    expect(partyMatchesSearch(gupta, '1122')).toBe(true) // part of the number, 4+ digits
  })
  test('names still match; short or mixed text never matches a phone by accident', () => {
    expect(partyMatchesSearch(gupta, 'gupta')).toBe(true)
    expect(partyMatchesSearch(gupta, '98')).toBe(false)
    expect(partyMatchesSearch(gupta, 'shop 9829')).toBe(false)
    expect(partyMatchesSearch({ name: 'X', phone: null }, '98290')).toBe(false)
    expect(partyMatchesSearch(gupta, '')).toBe(true)
  })
})

describe('partyPrefillFromSearch', () => {
  test('a valid Indian mobile goes into Phone, formatted', () => {
    expect(partyPrefillFromSearch('9829011223')).toEqual({ name: '', phone: '98290 11223' })
    expect(partyPrefillFromSearch('+91 98290 11223')).toEqual({ name: '', phone: '98290 11223' })
  })
  test('anything else goes into Name (an invalid number, a name)', () => {
    expect(partyPrefillFromSearch('Sharma ji')).toEqual({ name: 'Sharma ji', phone: '' })
    expect(partyPrefillFromSearch('12345')).toEqual({ name: '12345', phone: '' })
    expect(partyPrefillFromSearch('1829011223')).toEqual({ name: '1829011223', phone: '' }) // not a mobile (starts with 1)
  })
})

describe('one phone rule', () => {
  test('the server duplicate check uses the same function', () => {
    expect(serverNormalize).toBe(normalizePartyPhone)
    expect(readCode('src/lib/party-duplicate.ts')).not.toMatch(/function normalizePartyPhone/)
  })
  test('the bill screen searches and prefills with it', () => {
    const code = readCode('src/components/ledger/TransactionEntry.tsx')
    expect(code).toContain('partyMatchesSearch(p, partySearch)')
    expect(code).not.toMatch(/p\.phone\?\.includes\(partySearch\)/)
    expect(code).toContain('prefill={partySearch ? addPartyPrefill : undefined}')
  })
})

describe('#227: the tax split waits for "Who gets the goods"', () => {
  test('one rule for the badge and the summary', () => {
    const code = readCode('src/components/ledger/TransactionEntry.tsx')
    expect(code).toContain('const taxSplitPending = asksShipTo && shipCheck.needsShipToChoice')
    expect(code).toContain("{taxSplitPending ? '—' : derivedInterState.isInterState ? 'IGST' : 'CGST + SGST'}")
    expect(code).toContain('{taxSplitPending ? (')
    expect(code.split('asksShipTo && shipCheck.needsShipToChoice').length - 1).toBe(1)
  })
})
