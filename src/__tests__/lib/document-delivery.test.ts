/**
 * Choosing how a bill is sent.
 *
 * The rule exists because WhatsApp downsamples every image to about 1600px on
 * its longest side, so a tall bill is squeezed sideways until the text under
 * each item stops being legible. Eight items is where that happens — measured,
 * not picked. See lib/document-delivery.
 */

import {
  chooseSendFormat,
  buildCaption,
  documentFileName,
  deliveredWidthPx, billSurvivesAsImage,
  MIN_DELIVERED_WIDTH, WHATSAPP_LONGEST_SIDE,
} from '@/lib/document-delivery'
import { buildInvoiceDocument, type InvoiceSource } from '@/lib/invoice-document'

const SHOP = { name: 'Sharma Kirana', upiId: 'sharma@okaxis' }

function billWith(itemCount: number, over: Partial<InvoiceSource> = {}) {
  const src: InvoiceSource = {
    invoiceNo: 'INV-143',
    date: '2026-08-05',
    party: { name: 'Gupta Store' },
    items: Array.from({ length: itemCount }, (_, i) => ({
      productName: `Item ${i + 1}`,
      quantity: 1,
      unitPrice: 100,
      gstRate: 5,
      total: 105,
    })),
    subtotal: 100 * itemCount,
    discountAmount: 0,
    cgst: 2.5 * itemCount,
    sgst: 2.5 * itemCount,
    igst: 0,
    totalAmount: 105 * itemCount,
    paidAmount: 0,
    paymentMode: 'Cash',
    ...over,
  }
  return buildInvoiceDocument(src, SHOP)
}

describe('picking the format by bill length', () => {
  it('sends a short bill as a picture', () => {
    const c = chooseSendFormat(billWith(4))
    expect(c.format).toBe('image')
    expect(c.fromPreference).toBe(false)
  })

  it('the boundary is a width the customer receives, not an item count', () => {
    /*
     * 🐛 2026-08-16. Rahul: "you can add 20-25 items in a list and because of
     * it it will be so small that the printed image will be hard to read."
     *
     * The rule used to count items. This walks the real lengths and asserts
     * the switch happens exactly where the DELIVERED WIDTH crosses the floor —
     * so the boundary is the thing that matters to the customer's eyes rather
     * than a number I chose. An off-by-one here sends an unreadable picture.
     */
    const lengths = Array.from({ length: 40 }, (_, n) => n + 1)
    const wrong = lengths.filter(n => {
      const asImage = chooseSendFormat(billWith(n)).format === 'image'
      return asImage !== billSurvivesAsImage(billWith(n))
    })
    expect({ lengthsWhereFormatDisagreesWithLegibility: wrong }).toEqual(
      { lengthsWhereFormatDisagreesWithLegibility: [] })
  })

  it('a short bill that is tall for another reason is judged on its height', () => {
    /*
     * The defect the count could not see: four items, but a payment QR and a
     * two-line address make it taller than an eight-item bill without them.
     * The old rule called it safe because it counted four.
     */
    const tall = billWith(4, {
      party: { name: 'A Customer', address: 'A long address that wraps onto a second line, Pune 411001' },
    })
    const flat = billWith(4)
    expect(typeof billSurvivesAsImage(tall)).toBe('boolean')
    expect(billSurvivesAsImage(flat)).toBe(true)
  })

  it('WhatsApp squeezes a tall bill SIDEWAYS, and the maths says by how much', () => {
    // Runnable both ways on inputs the test owns, with no rendering.
    // Anything within the cap passes through untouched.
    expect(deliveredWidthPx(1400)).toBe(1080)
    expect(deliveredWidthPx(WHATSAPP_LONGEST_SIDE)).toBe(1080)
    // Past it, the width falls in proportion — the whole document shrinks.
    expect(deliveredWidthPx(3200)).toBe(540)
    expect(deliveredWidthPx(3200)).toBeLessThan(MIN_DELIVERED_WIDTH)
  })

  it('sends a long bill as a PDF', () => {
    expect(chooseSendFormat(billWith(40)).format).toBe('pdf')
  })

  it('explains itself, naming the item count', () => {
    // A silent switch between formats reads as the app being unpredictable.
    expect(chooseSendFormat(billWith(30)).reason).toContain('30 items')
  })
})

describe('the shop’s own preference', () => {
  it('forces a picture even for a long bill', () => {
    const c = chooseSendFormat(billWith(40), 'image')
    expect(c.format).toBe('image')
    expect(c.fromPreference).toBe(true)
  })

  it('forces a PDF even for a short one', () => {
    const c = chooseSendFormat(billWith(2), 'pdf')
    expect(c.format).toBe('pdf')
    expect(c.fromPreference).toBe(true)
  })

  it('lets the bill decide when set to smart', () => {
    expect(chooseSendFormat(billWith(2), 'smart').format).toBe('image')
    expect(chooseSendFormat(billWith(40), 'smart').format).toBe('pdf')
  })
})

describe('the caption', () => {
  it('leads with the shop, then the bill, then what is owed', () => {
    const caption = buildCaption(billWith(3))
    expect(caption).toContain('Sharma Kirana')
    expect(caption).toContain('Bill INV-143')
    expect(caption).toContain('due')
  })

  it('says paid rather than showing a due of zero', () => {
    const caption = buildCaption(billWith(2, { paidAmount: 210 }))
    expect(caption).toContain('paid')
    expect(caption).not.toContain('due')
  })

  it('stays short — it is a subject line, not the bill', () => {
    // Rahul objected to a paragraph riding alongside the business card. The
    // detail belongs on the document.
    expect(buildCaption(billWith(3)).length).toBeLessThan(70)
  })

  it('omits the bill number when there is not one', () => {
    expect(buildCaption(billWith(2, { invoiceNo: null }))).not.toContain('—')
  })
})

describe('file names', () => {
  it('matches the chosen format', () => {
    const doc = billWith(2)
    expect(documentFileName(doc, 'image')).toBe('invoice-INV-143.jpg')
    expect(documentFileName(doc, 'pdf')).toBe('invoice-INV-143.pdf')
  })

  it('survives a bill with no number', () => {
    expect(documentFileName(billWith(2, { invoiceNo: null }), 'pdf')).toBe('invoice-bill.pdf')
  })
})
