/**
 * The bill carries no link. Payment is a code the customer scans.
 *
 * 🗑️ 2026-08-15. Rahul: "remove the link which we can share with the bill in
 * pdf … sharing link or directly paying option sometimes cause fear in the
 * mind of general public. i just want a section in the app where the user can
 * add the image of there QR or add upi id for billing."
 *
 * That is a judgement about the people who receive these bills, and it is
 * right: a customer sent an unfamiliar URL asking them to pay has every reason
 * to treat it as a scam, because most of the time it is one. A QR sitting on a
 * bill they already have is a different act — nothing to click, nothing to
 * land on, nothing that can be spoofed by a lookalike domain.
 *
 * WHY A TEST AND NOT JUST A DELETION. A removed feature comes back by
 * accident: someone adds a "share" button, or restores a file, and nothing
 * objects. This is the objection. It is also documentation — anyone who trips
 * it reads the reason before deciding.
 *
 * The BillShare model and its rows are deliberately NOT deleted. See
 * prisma/schema.prisma: a shopkeeper's minted links are their own record, and
 * withdrawing a feature is not a licence to erase their data.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { readCode } from '@/test-support/read-source'
import { buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'

const SRC: InvoiceSource = {
  invoiceNo: 'RG/1', date: '2026-08-15', party: { name: 'Gupta' },
  items: [{ productName: 'Atta', quantity: 1, unitPrice: 100, gstRate: 5, total: 105 }],
  subtotal: 100, discountAmount: 0, cgst: 2.5, sgst: 2.5, igst: 0,
  totalAmount: 105, paidAmount: 0, paymentMode: 'cash',
}

describe('the shareable bill link is gone', () => {
  it.each([
    'src/app/b/[token]/page.tsx',
    'src/app/b/[token]/PublicBill.tsx',
    'src/app/api/bill-share/route.ts',
    'src/lib/bill-share.ts',
  ])('%s no longer exists', file => {
    expect({ file, exists: existsSync(join(process.cwd(), file)) })
      .toEqual({ file, exists: false })
  })

  it('the PDF prints no link of any kind', () => {
    const pdf = readCode('src/lib/invoice-pdf.ts')
    // textWithLink is the only way jsPDF makes a clickable annotation.
    expect(pdf).not.toContain('textWithLink')
    expect(pdf).not.toContain('shareLink')
  })

  it('the send path mints nothing and carries no link', () => {
    const send = readCode('src/lib/send-bill.ts')
    expect(send).not.toContain('/api/bill-share')
    expect(send).not.toContain('mintLink')
    expect(send).not.toContain('shareLink')
  })

  it('the settings API refuses to store the old switch', () => {
    /*
     * The COLUMN stays so no shop's row is rewritten. What must not come back
     * is a way to set it: a setting the app still saves and never reads is
     * how a dead feature returns to life by accident.
     */
    const route = readCode('src/app/api/settings/route.ts')
    expect(route).not.toContain('sanitized.docShareLink')
  })

  it('the schema keeps BillShare and its rows', () => {
    // Data is never destroyed to tidy up a withdrawn feature — the standing
    // rule on this project, and the reason old links 404 rather than vanish.
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    expect(schema).toContain('model BillShare')
    expect(schema).toContain('docShareLink')
  })
})

describe('payment is a QR, and the shop chooses which one', () => {
  const shopWithUpi: InvoiceShop = { name: 'Rahul Grocery', upiId: 'rahul@ybl' }

  it('generates a upi:// code from the UPI id', () => {
    const doc = buildInvoiceDocument(SRC, shopWithUpi)
    expect(doc.upiLink).toContain('upi://pay')
    // A UPI intent, never an https link to a page we host.
    expect(doc.upiLink).not.toMatch(/^https?:/)
  })

  it("carries the shop's own uploaded QR when there is one", () => {
    const doc = buildInvoiceDocument(SRC, { ...shopWithUpi, paymentQrUrl: 'https://cdn.test/qr.png' })
    expect(doc.shop.paymentQrUrl).toBe('https://cdn.test/qr.png')
  })

  it('prefers the uploaded QR in BOTH renderers, or they disagree', () => {
    /*
     * The precedence is a decision, and it is made twice — once in the PDF and
     * once in the WhatsApp picture. If the two ever diverge, a customer gets
     * one way to pay in the file and a different one in the image, which is
     * the invoiceTheme bug with money attached.
     */
    const pdf = readCode('src/lib/invoice-pdf.ts')
    expect(pdf).toContain('invoice.shop.paymentQrUrl')
    // The uploaded branch must come FIRST, or upiId always wins.
    expect(pdf.indexOf('paymentQrUrl')).toBeLessThan(pdf.indexOf('invoice.shop.upiId && dueAmount'))

    const send = readCode('src/lib/send-bill.ts')
    expect(send).toContain('shop.paymentQrUrl')
    expect(send.indexOf('shop.paymentQrUrl')).toBeLessThan(send.indexOf('doc.upiLink ? renderQr'))
  })

  it('tells the customer to type the amount on an uploaded QR', () => {
    /*
     * A upi:// code carries the amount; a photographed one cannot. Printing
     * "Scan to pay ₹945" over a code that opens an empty amount box would be
     * a small lie on a legal document, and the kind that ends with someone
     * paying the wrong number.
     */
    expect(readCode('src/lib/pdf/primitives.ts')).toContain('Enter ')
    expect(readCode('src/lib/invoice-share-image.ts')).toContain('Enter ')
  })
})
