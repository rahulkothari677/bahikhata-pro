/**
 * #351 (1 Nov 2026): a discount after the s.34(2) date, given outside GST.
 * The note must total exactly what was typed (no GST taken out of it), and the
 * server must refuse the flag on anything but a discount note on a bill.
 */
import { computeLineItems } from '@/lib/line-items'
import { discountLines } from '@/lib/post-sale-discount'
import { readCode } from '@/test-support/read-source'

const SALE = [
  { gstRate: 5, total: 1050, hsn: '1101', unit: 'kg' },
  { gstRate: 0, total: 600, hsn: '0713', unit: 'kg' },
]

test('₹165 outside GST: the note is ₹165, with no tax on any line', () => {
  const r = computeLineItems({ items: discountLines('INV-0003', SALE, 165) as never, productMap: new Map(), isInterState: false, orderDiscount: 0, type: 'credit-note', chargesGst: false })
  expect([r.cgst, r.sgst, r.igst]).toEqual([0, 0, 0])
  expect(Math.round((r.subtotal + r.cgst + r.sgst + r.igst) * 100) / 100).toBe(165)
})

describe('the server', () => {
  const create = readCode('src/app/api/transactions/route.ts')
  test('accepts the flag only on a discount credit note tied to its bill, with no goods back', () => {
    expect(create).toContain(`if (outsideGst && !(type === 'credit-note' && noteReason === 'post-sale-discount' && originalTransactionId && !affectsStock))`)
  })
  test('charges no GST on it, and the s.34(2) date does not bar it', () => {
    expect(create).toContain('chargesGst: chargesGstOnSales(gstStatus(setting)) && !outsideGst })')
    expect(create).toContain('chargesGst: chargesGstOnSales(gstStatus(setting)) && !outsideGst,')
  })
  test('an edit keeps it GST-free', () => {
    expect((readCode('src/app/api/transactions/[id]/route.ts').match(/&& !existing\.outsideGst/g) || []).length).toBe(3)
  })
})

describe('every GST return leaves it out', () => {
  test.each([
    ['src/app/api/gstr-1/route.ts', 2],
    ['src/app/api/gstr-3b/route.ts', 1],
    ['src/app/api/gstr-4/route.ts', 2],
    ['src/app/api/cmp-08/route.ts', 1],
    ['src/app/api/gstr-export/route.ts', 2],
    ['src/app/api/gst-readiness/route.ts', 1],
    ['src/app/api/reports/route.ts', 1],
  ])('%s (%i filter)', (file, n) => {
    const code = readCode(file as string)
    const filters = (code.match(/outsideGst: false|"outsideGst" = false/g) || []).length
    expect(filters).toBe(n)
  })
})
