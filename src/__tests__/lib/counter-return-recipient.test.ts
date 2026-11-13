/**
 * 9c-4 (#123): a credit note to a customer without a GSTIN names them and their
 * State — Rule 53(1A) (inserted by 03/2019-CT): "name and address of the
 * recipient and the address of delivery, along with the name of State and its
 * code". No value limit, unlike Rule 46(e)'s ₹50,000 on an invoice.
 */
import { noteRecipient, placeOfSupplyLines, buildInvoiceDocument } from '@/lib/invoice-document'
import { readCode } from '@/test-support/read-source'

const walkIn = { name: 'Walk-in Customer' }
const shop = { gstin: '08AAACG1234K1ZT', state: 'Rajasthan' }

describe('who a counter return prints as', () => {
  it('a walk-in credit note with a name prints the person refunded', () => {
    expect(noteRecipient({ type: 'credit-note', party: walkIn, payeeName: ' Sunita Devi ', payeeAddress: 'Ward 4, Jaipur' }))
      .toEqual({ name: 'Sunita Devi', address: 'Ward 4, Jaipur' })
    expect(noteRecipient({ type: 'credit-note', party: null, payeeName: 'Sunita Devi', payeeAddress: '' }))
      .toEqual({ name: 'Sunita Devi', address: null })
  })

  it('a real customer prints as themselves; no name, nothing; a sale is never touched', () => {
    expect(noteRecipient({ type: 'credit-note', party: { name: 'Gupta Kirana' }, payeeName: 'Sunita Devi' })).toBeNull()
    expect(noteRecipient({ type: 'credit-note', party: walkIn, payeeName: '  ' })).toBeNull()
    expect(noteRecipient({ type: 'sale', party: walkIn, payeeName: 'Sunita Devi' })).toBeNull()
  })
})

describe('the State and its code', () => {
  it('a credit note to a buyer with no GSTIN always shows it, from the saved place of supply', () => {
    expect(placeOfSupplyLines({ type: 'credit-note', party: walkIn, isInterState: false, placeOfSupply: '08' }, shop).placeOfSupply)
      .toBe('Rajasthan (08)')
  })

  it('an intra-state sale to a walk-in still shows none (unchanged)', () => {
    expect(placeOfSupplyLines({ type: 'sale', party: walkIn, isInterState: false, placeOfSupply: '08' }, shop).placeOfSupply).toBeNull()
  })

  it('the whole document: the refunded customer in Bill To, with the State', () => {
    const doc = buildInvoiceDocument({
      type: 'credit-note', invoiceNo: 'CN-0004', date: '2026-11-13', party: walkIn,
      payeeName: 'Sunita Devi', payeeAddress: 'Ward 4, Jaipur', placeOfSupply: '08', isInterState: false,
      items: [], subtotal: 100, discountAmount: 0, cgst: 2.5, sgst: 2.5, igst: 0, totalAmount: 105, paidAmount: 105,
    } as never, { name: 'GST Test Kirana', ...shop } as never)
    expect(doc.party).toEqual({ name: 'Sunita Devi', address: 'Ward 4, Jaipur' })
    expect(doc.placeOfSupply).toBe('Rajasthan (08)')
  })
})

describe('the server keeps it only on a counter return', () => {
  it('POST stores payeeName / payeeAddress when the credit note has no customer', () => {
    const code = readCode('app/api/transactions/route.ts')
    expect(code).toContain("const counterReturn = type === 'credit-note' && !requestedPartyId")
    expect(code).toContain('...(counterReturn ? {')
  })
  it('the note’s own screen shows who was refunded, through the same rule', () => {
    const detail = readCode('components/ledger/TransactionDetail.tsx')
    expect(detail).toContain('const r = noteRecipient(txn as Parameters<typeof noteRecipient>[0])')
    // and the browser print view (not the PDF builder) prints them too
    expect(detail).toContain('const printRecipient = noteRecipient(txn)')
    expect(detail).toContain('{printRecipient?.name || txn.party?.name || noPartyName(txn.type)}')
  })
  it('the screen sends them only then', () => {
    expect(readCode('components/ledger/TransactionEntry.tsx'))
      .toContain('...(isCreditNote && !partyId ? { payeeName: refundToName.trim() || null, payeeAddress: refundToAddress.trim() || null } : {}),')
  })
})
