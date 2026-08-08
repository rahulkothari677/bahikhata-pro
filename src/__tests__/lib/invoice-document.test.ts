/**
 * The invoice document model.
 *
 * 🎨 Phase 1 of docs/INVOICE-PDF-PLAN.md. An invoice now has to reach a
 * WhatsApp image, an A4 PDF and eventually a thermal receipt. Written as three
 * renderers over three copies of the data they WILL disagree, and the field
 * they would disagree about is the amount due — the one number that is computed
 * rather than copied. These tests pin the arithmetic to one place.
 */

import { buildInvoiceDocument, buildUpiLink, type InvoiceSource } from '@/lib/invoice-document'

const SHOP = {
  name: 'Sharma Kirana',
  gstin: '23ABCDE1234F1Z5',
  state: 'Madhya Pradesh',
  upiId: 'sharma@okaxis',
}

const BASE: InvoiceSource = {
  invoiceNo: 'INV-1',
  date: '2026-08-05',
  type: 'sale',
  party: { name: 'Gupta Store', state: 'Madhya Pradesh' },
  items: [
    { productName: 'Salt', quantity: 2, unitPrice: 26, gstRate: 5, total: 54.6, unit: 'pkt', hsn: '2501' },
  ],
  subtotal: 52,
  discountAmount: 0,
  cgst: 1.3,
  sgst: 1.3,
  igst: 0,
  totalAmount: 54.6,
  paidAmount: 0,
  paymentMode: 'Cash',
  isInterState: false,
}

describe('what is still owed', () => {
  it('counts payments settled against the bill AFTER it was raised', () => {
    // The audit fix that made the PDF agree with the ledger. `total - paid`
    // alone showed a customer the original amount on a bill they had already
    // part-settled, and the status stamp contradicted the shop's own books.
    const doc = buildInvoiceDocument({ ...BASE, paidAmount: 20, allocatedAmount: 34.6 }, SHOP)
    expect(doc.due).toBe(0)
    expect(doc.status).toBe('paid')
  })

  it('reports part-paid when something is left', () => {
    const doc = buildInvoiceDocument({ ...BASE, paidAmount: 20 }, SHOP)
    expect(doc.due).toBe(34.6)
    expect(doc.paid).toBe(20)
    expect(doc.status).toBe('partial')
  })

  it('reports due when nothing has been paid', () => {
    expect(buildInvoiceDocument(BASE, SHOP).status).toBe('due')
  })

  it('never reports a negative amount due', () => {
    // An over-allocation must not print as "you owe minus fifty rupees".
    const doc = buildInvoiceDocument({ ...BASE, paidAmount: 100 }, SHOP)
    expect(doc.due).toBe(0)
    expect(doc.status).toBe('paid')
  })

  it('treats a sub-paise remainder as settled', () => {
    // Floating point leaves 0.004 behind on ordinary sums. Stamping DUE on a
    // bill that is paid, over four-tenths of a paise, is the kind of thing a
    // customer telephones about.
    const doc = buildInvoiceDocument(
      { ...BASE, totalAmount: 54.6, paidAmount: 54.599 },
      SHOP,
    )
    expect(doc.due).toBe(0)
    expect(doc.status).toBe('paid')
  })
})

describe('tax presentation', () => {
  it('adds the heads up once so no renderer repeats the sum', () => {
    const doc = buildInvoiceDocument(BASE, SHOP)
    expect(doc.taxTotal).toBe(2.6)
    expect(doc.hasTax).toBe(true)
  })

  it('knows when there is no tax to show', () => {
    // A composition dealer shows no tax breakup at all.
    const doc = buildInvoiceDocument({ ...BASE, cgst: 0, sgst: 0, igst: 0 }, SHOP)
    expect(doc.hasTax).toBe(false)
    expect(doc.taxTotal).toBe(0)
  })
})

describe('place of supply (Rule 46)', () => {
  it('is shown when the buyer is registered', () => {
    const doc = buildInvoiceDocument(
      { ...BASE, party: { name: 'Gupta', gstin: '23FGHIJ5678K1Z2', state: 'Madhya Pradesh' } },
      SHOP,
    )
    expect(doc.placeOfSupply).toBe('Madhya Pradesh')
  })

  it('is shown on an inter-state supply even to an unregistered buyer', () => {
    const doc = buildInvoiceDocument(
      { ...BASE, isInterState: true, party: { name: 'Gupta', state: 'Maharashtra' } },
      SHOP,
    )
    expect(doc.placeOfSupply).toBe('Maharashtra')
  })

  it('is omitted for a local sale to an unregistered walk-in', () => {
    expect(buildInvoiceDocument(BASE, SHOP).placeOfSupply).toBeNull()
  })
})

describe('the UPI pay link', () => {
  it('asks for exactly what is still owed, not the invoice total', () => {
    const doc = buildInvoiceDocument({ ...BASE, paidAmount: 20 }, SHOP)
    expect(doc.upiLink).toContain('am=34.60')
    expect(doc.upiLink).toContain('pa=sharma%40okaxis')
  })

  it('is absent once the bill is settled', () => {
    // A pay button on a paid bill invites a second payment.
    expect(buildInvoiceDocument({ ...BASE, paidAmount: 54.6 }, SHOP).upiLink).toBeNull()
  })

  it('is absent when the shop has no UPI id', () => {
    // A button that opens a UPI app and then fails is worse than no button.
    expect(buildUpiLink({ name: 'X' }, 500)).toBeNull()
  })
})

describe('presentation', () => {
  it('joins quantity and unit so renderers cannot format them differently', () => {
    expect(buildInvoiceDocument(BASE, SHOP).items[0].qty).toBe('2 pkt')
  })

  it('titles a purchase differently from a sale', () => {
    expect(buildInvoiceDocument({ ...BASE, type: 'purchase' }, SHOP).title).toBe('PURCHASE BILL')
    expect(buildInvoiceDocument(BASE, SHOP).title).toBe('TAX INVOICE')
  })

  it('carries the amount in words already suffixed', () => {
    // The image prefixed "Rupees" on its first render and produced "Rupees
    // Fifty-Four Rupees and Sixty Paise Only".
    const words = buildInvoiceDocument(BASE, SHOP).totalInWords
    expect(words).toContain('Rupees')
    expect(words.startsWith('Rupees')).toBe(false)
  })

  it('shows a dash rather than nothing when a bill has no number', () => {
    expect(buildInvoiceDocument({ ...BASE, invoiceNo: null }, SHOP).invoiceNo).toBe('—')
  })
})

describe('e-invoice details reach the printed document', () => {
  /*
   * WHY (2026-08-08). Rule 48(4) requires the IRN and the SIGNED QR from the
   * portal to appear on an invoice covered by e-invoicing. An invoice issued
   * without them counts as NON-ISSUANCE — penalties under Section 122, and the
   * buyer's input tax credit on it is at risk.
   *
   * The app stored both on the transaction and printed neither. Every document
   * it produced for an e-invoicing shop — PDF, WhatsApp image, share page — was
   * legally not an invoice.
   */
  it('carries the IRN and signed QR through to the document', () => {
    const doc = buildInvoiceDocument(
      { ...BASE, irn: 'a'.repeat(64), signedQR: 'eyJhbGciOiJSUzI1NiJ9.signed-payload' } as never,
      SHOP,
    )
    expect(doc.irn).toBe('a'.repeat(64))
    expect(doc.signedQR).toBe('eyJhbGciOiJSUzI1NiJ9.signed-payload')
  })

  it('leaves both null for a shop that does not e-invoice', () => {
    // The great majority: under ₹5 crore, correctly no IRN. The block must not
    // render an empty e-invoice section on an ordinary bill.
    const doc = buildInvoiceDocument(BASE as never, SHOP)
    expect(doc.irn).toBeNull()
    expect(doc.signedQR).toBeNull()
  })

  it('keeps the IRN even when the QR is missing', () => {
    /*
     * These arrive together from the portal, but a partial store is possible —
     * the app lets a shopkeeper paste the IRN and the QR separately. The IRN
     * alone still identifies the e-invoice, so it must not be dropped because
     * its companion is absent.
     */
    const doc = buildInvoiceDocument({ ...BASE, irn: 'b'.repeat(64) } as never, SHOP)
    expect(doc.irn).toBe('b'.repeat(64))
    expect(doc.signedQR).toBeNull()
  })
})
