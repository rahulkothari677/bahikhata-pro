/**
 * Phase 8f — discount after sale (Finance Act 2026 s.153–154, from 1 Nov 2026;
 * s.34(2) date). Every case worked by hand in rupees.
 */
import { discountLines, discountDeadline, salePeriod } from '@/lib/post-sale-discount'
import { computeLineItems } from '@/lib/line-items'
import { validateNoteAgainstOriginal, type NoteValidationDb } from '@/lib/note-validation'

// A bill: Aashirvaad atta at 5% (₹1,000 + ₹50 GST = ₹1,050) and loose toor dal at 0% (₹600). Total ₹1,650.
const SALE = [
  { gstRate: 5, total: 1050, hsn: '1101', unit: 'kg' },
  { gstRate: 0, total: 600, hsn: '0713', unit: 'kg' },
]
const preview = (lines: ReturnType<typeof discountLines>, isInterState = false) =>
  computeLineItems({ items: lines as never, productMap: new Map(), isInterState, orderDiscount: 0, type: 'credit-note', chargesGst: true })

describe('the discount is spread over the bill at each line\'s own rate', () => {
  test('₹165 (10%) off ₹1,650 → ₹105 on the atta (₹100 + ₹2.50 + ₹2.50), ₹60 on the dal', () => {
    const lines = discountLines('INV-0003', SALE, 165)
    expect(lines.map((l) => [l.hsn, l.gstRate, l.unitPrice])).toEqual([['1101', 5, 105], ['0713', 0, 60]])
    expect(lines.every((l) => l.priceIncludesGst && l.quantity === 1 && l.productName === 'Discount on INV-0003')).toBe(true)
    const p = preview(lines)
    expect(p.subtotal).toBe(160)          // ₹100 atta + ₹60 dal
    expect(p.cgst).toBe(2.5)
    expect(p.sgst).toBe(2.5)
    expect(roundTotal(p)).toBe(165)       // exactly what the customer gets
  })

  test('the same bill to another state: ₹5 IGST, no CGST/SGST', () => {
    const p = preview(discountLines('INV-0003', SALE, 165), true)
    expect([p.igst, p.cgst, p.sgst]).toEqual([5, 0, 0])
  })

  test('paise from rounding go to the biggest line, so the note totals exactly what was typed', () => {
    // ₹100 × 1050/1650 = ₹63.636… → ₹63.63; ₹100 × 600/1650 = ₹36.363… → ₹36.36; the 1 paisa left → atta.
    const lines = discountLines('INV-0003', SALE, 100)
    expect(lines.map((l) => l.unitPrice)).toEqual([63.64, 36.36])
    expect(roundTotal(preview(lines))).toBe(100)
  })

  test('two lines with the same HSN, rate and unit become one note line', () => {
    const lines = discountLines('INV-9', [{ gstRate: 5, total: 525, hsn: '1101', unit: 'kg' }, { gstRate: 5, total: 525, hsn: '1101', unit: 'kg' }], 105)
    expect(lines).toHaveLength(1)
    expect(lines[0].unitPrice).toBe(105)
  })

  test('nothing to give or nothing to spread over → no lines', () => {
    expect(discountLines('X', SALE, 0)).toEqual([])
    expect(discountLines('X', SALE, -5)).toEqual([])
    expect(discountLines('X', [], 50)).toEqual([])
  })
})

describe('s.34(2): the last date for the note', () => {
  test('a February 2026 sale (FY 2025-26) → 30 November 2026', () => {
    expect(salePeriod('2026-02-15T06:30:00Z')).toBe('022026')
    const d = discountDeadline('2026-02-15T06:30:00Z', new Date('2026-11-01T06:30:00Z'))
    expect(d.effectiveDeadline.getFullYear()).toBe(2026)
    expect(d.effectiveDeadline.getMonth()).toBe(10)
    expect(d.effectiveDeadline.getDate()).toBe(30)
    expect(d.open).toBe(true)
  })
  test('open all of 30 November, closed on 1 December', () => {
    expect(discountDeadline('2026-02-15T06:30:00Z', new Date(2026, 10, 30, 22, 0)).open).toBe(true)
    expect(discountDeadline('2026-02-15T06:30:00Z', new Date(2026, 11, 1, 9, 0)).open).toBe(false)
  })
  test('an April 2026 sale (FY 2026-27) has until 30 November 2027', () => {
    expect(discountDeadline('2026-04-02T06:30:00Z', new Date(2027, 5, 1)).effectiveDeadline.getFullYear()).toBe(2027)
  })
  test('a sale on 31 March 11 pm India time is still March (IST, not UTC)', () => {
    // 2026-03-31 17:30 UTC = 23:00 IST on 31 March → FY 2025-26.
    expect(salePeriod('2026-03-31T17:30:00Z')).toBe('032026')
  })
})

describe('the server refuses a late discount note (rule 2b)', () => {
  const db = (date: string): NoteValidationDb => ({
    transaction: {
      findFirst: async () => ({ id: 's1', type: 'sale', partyId: 'p1', totalAmount: 1650, invoiceNo: 'INV-0003', date: new Date(date) }),
      aggregate: async () => ({ _sum: { totalAmount: 0 } }),
    },
  })
  const base = { userId: 'u', type: 'credit-note', partyId: 'p1', originalTransactionId: 's1', noteTotal: 165 }

  test('a discount on a FY 2025-26 sale, on 1 December 2026, on a GST shop → refused with the date', async () => {
    const r = await validateNoteAgainstOriginal(db('2026-02-15T06:30:00Z'), { ...base, noteReason: 'post-sale-discount', chargesGst: true, noteDate: new Date(2026, 11, 1, 10) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/30 November 2026 \(section 34\(2\)\)/)
  })
  test('the same on 30 November → allowed', async () => {
    expect((await validateNoteAgainstOriginal(db('2026-02-15T06:30:00Z'), { ...base, noteReason: 'post-sale-discount', chargesGst: true, noteDate: new Date(2026, 10, 30, 10) })).ok).toBe(true)
  })
  test('a goods RETURN after the date is not refused — the goods did come back', async () => {
    expect((await validateNoteAgainstOriginal(db('2026-02-15T06:30:00Z'), { ...base, noteReason: 'return', chargesGst: true, noteDate: new Date(2026, 11, 1, 10) })).ok).toBe(true)
  })
  test('a shop that charges no GST has no GST to reduce → no date limit', async () => {
    expect((await validateNoteAgainstOriginal(db('2026-02-15T06:30:00Z'), { ...base, noteReason: 'post-sale-discount', chargesGst: false, noteDate: new Date(2027, 0, 5) })).ok).toBe(true)
  })
})

function roundTotal(p: { subtotal: number; cgst: number; sgst: number; igst: number }) {
  return Math.round((p.subtotal + p.cgst + p.sgst + p.igst) * 100) / 100
}
