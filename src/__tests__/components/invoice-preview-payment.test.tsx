/**
 * The preview draws the payment QR — the thing it was silently not doing.
 *
 * 🐛 2026-08-15. Rahul: "neither QR code has been added." He was right. The QR
 * was wired into the PDF and the WhatsApp picture and NOT into the preview,
 * which is the surface he actually looks at. A shopkeeper uploads the code
 * from their counter, opens the preview, sees no change, and concludes the
 * upload is broken.
 *
 * A rendered DOM assertion rather than a source grep, because the failure was
 * "this markup does not exist" and only building the markup can prove it does.
 */

import { render } from '@testing-library/react'
import { InvoicePreview } from '@/components/settings/InvoicePreview'
import { buildInvoiceDocument, type InvoiceShop } from '@/lib/invoice-document'

;(globalThis as unknown as Record<string, unknown>).ResizeObserver ||= class {
  observe() {} ; unobserve() {} ; disconnect() {}
}

const SRC = {
  invoiceNo: 'SM/1', date: '2026-08-16', party: { name: 'Walk-in' },
  items: [{ productName: 'Crocin 500', quantity: 2, unitPrice: 30, gstRate: 12, total: 67.2 }],
  subtotal: 60, discountAmount: 0, cgst: 3.6, sgst: 3.6, igst: 0,
  totalAmount: 67.2, paidAmount: 0, paymentMode: 'credit',
}

const draw = (shop: InvoiceShop) =>
  render(<InvoicePreview doc={buildInvoiceDocument(SRC, shop)} />)

describe('the payment QR reaches the preview', () => {
  it('draws a QR block for a shop with a UPI id', () => {
    const { container } = draw({ name: 'Sharma Medical', upiId: 'sharma@ybl' })
    expect(container.textContent).toContain('Scan to pay')
    expect(container.textContent).toContain('sharma@ybl')
  })

  it("draws the shop's OWN uploaded code when there is one", () => {
    const { container } = draw({
      name: 'Sharma Medical', upiId: 'sharma@ybl',
      paymentQrUrl: 'https://cdn.test/counter-qr.png',
    })
    const img = container.querySelector('img[src="https://cdn.test/counter-qr.png"]')
    expect(img).not.toBeNull()
    /*
     * And it says to ENTER the amount. A photographed code cannot carry one,
     * so printing "Scan to pay ₹67.20" over it would be a small lie that ends
     * with someone paying a number they guessed.
     */
    expect(container.textContent).toContain('Enter ₹67.20')
    // The UPI id is NOT shown beside an uploaded code — it is not what will
    // be scanned, and two payees on one bill is a question, not information.
    expect(container.textContent).not.toContain('sharma@ybl')
  })

  it('draws nothing when the shop has neither', () => {
    const { container } = draw({ name: 'Sharma Medical' })
    expect(container.textContent).not.toContain('Scan to pay')
  })
})

describe('a field the shop just defined shows up', () => {
  /*
   * The other half of the same complaint: "i tried to add the field but it's
   * not working in the preview." The preview draws the most recent BILL, and a
   * bill raised before the field existed has no value for it — correct, and
   * useless. A defined-but-unfilled field now draws with a dash.
   */
  it('shows a dash for a field this bill has no value for', () => {
    const { container } = render(
      <InvoicePreview
        doc={buildInvoiceDocument(SRC, { name: 'Sharma Medical' })}
        pendingFields={[
          { key: 'batch_no', label: 'Batch No.', entity: 'item' },
          { key: 'po_number', label: 'PO Number', entity: 'invoice' },
        ]}
      />,
    )
    expect(container.textContent).toContain('Batch No.: —')
    expect(container.textContent).toContain('PO Number: —')
  })

  it('does not repeat a column the line already carries', () => {
    // The per-line bug found while verifying: presence was pooled across all
    // items, so a value on one line blanked the dash on every other.
    const withValue = {
      ...SRC,
      items: [{
        ...SRC.items[0],
        customCols: [{ key: 'batch_no', label: 'Batch No.', type: 'text', value: 'A-118', show: true }],
      }],
    }
    const { container } = render(
      <InvoicePreview
        doc={buildInvoiceDocument(withValue, { name: 'Sharma Medical' })}
        pendingFields={[{ key: 'batch_no', label: 'Batch No.', entity: 'item' }]}
      />,
    )
    expect(container.textContent).toContain('Batch No.: A-118')
    expect(container.textContent).not.toContain('Batch No.: —')
  })
})
