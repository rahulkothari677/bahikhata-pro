/**
 * 9a-3: the small rules behind the supplier-bills screen (lib/supplier-bills.ts).
 */
import { twoBDate, twoBRate, purchasePresetFrom, askSupplierText, remindSupplierText } from '@/lib/supplier-bills'
import { whatsAppUrl } from '@/lib/whatsapp-link'

describe('2B dates', () => {
  it('reads dd-mm-yyyy, refuses anything else', () => {
    expect(twoBDate('10-10-2026')).toBe('2026-10-10')
    expect(twoBDate('31-02-2026')).toBeNull() // no 31 February
    expect(twoBDate('2026-10-10')).toBeNull()
    expect(twoBDate(null)).toBeNull()
  })
})

describe('the bill’s rate, only when it is exactly a slab', () => {
  it('₹1,000 with ₹90 + ₹90 is 18%; ₹1,000 with ₹25 + ₹25 is 5%; IGST works too', () => {
    expect(twoBRate({ taxableValue: 1000, cgst: 90, sgst: 90, igst: 0 })).toBe(18)
    expect(twoBRate({ taxableValue: 1000, cgst: 25, sgst: 25, igst: 0 })).toBe(5)
    expect(twoBRate({ taxableValue: 1000, cgst: 0, sgst: 0, igst: 180 })).toBe(18)
    expect(twoBRate({ taxableValue: 1000, cgst: 0, sgst: 0, igst: 0 })).toBe(0)
  })
  it('a mixed-rate bill gives null — the form asks instead of guessing', () => {
    // ₹10,000 at 18% + ₹1,000 at 5% = ₹1,850 tax on ₹11,000: no single slab.
    expect(twoBRate({ taxableValue: 11000, cgst: 925, sgst: 925, igst: 0 })).toBeNull()
    expect(twoBRate({ taxableValue: 0, cgst: 0, sgst: 0, igst: 0 })).toBeNull()
  })
})

describe('"Add as purchase" fills in the form, it does not save', () => {
  const bill = { supplierGstin: '08AAACS1234K1Z5', supplierName: null, invoiceNumber: 'X-9', invoiceDate: '18-10-2026', taxableValue: 5000, cgst: 450, sgst: 450, igst: 0 }
  it('a known supplier by id; their number, date, and one line at the bill’s value and rate', () => {
    const p = purchasePresetFrom(bill, 'party-1')
    expect(p.type).toBe('purchase')
    expect(p.data).toMatchObject({ partyId: 'party-1', invoiceNo: 'X-9', date: '2026-10-18' })
    expect(p.data.items).toEqual([{ name: 'Goods as per bill X-9', quantity: 1, unitPrice: 5000, gstRate: 18, unit: 'pcs', priceIncludesGst: false }])
  })
  it('an unknown supplier goes in as a name to search (their GSTIN), never as a made-up party', () => {
    const p = purchasePresetFrom(bill, null)
    expect(p.data).toMatchObject({ partyName: '08AAACS1234K1Z5' })
    expect('partyId' in p.data).toBe(false)
  })
})

describe('WhatsApp messages', () => {
  it('a 10-digit number gets 91; no number opens the picker; the text is encoded', () => {
    expect(whatsAppUrl('98290 12345', 'a b')).toBe('https://wa.me/919829012345?text=a%20b')
    expect(whatsAppUrl(null, 'hi')).toBe('https://wa.me/?text=hi')
  })
  it('say the bill, the amounts and the ask', () => {
    expect(askSupplierText('SB-1182', 11920, 11800)).toMatch(/SB-1182 shows ₹11,920.*our bill says ₹11,800/)
    expect(remindSupplierText('SUP-977', '10 Oct', 354)).toMatch(/SUP-977 dated 10 Oct for ₹354.*not in our GSTR-2B/)
  })
})
