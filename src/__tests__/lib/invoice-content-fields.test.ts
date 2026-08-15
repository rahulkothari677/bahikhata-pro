/**
 * Phase 3: the words the shop puts on its bill actually get printed.
 *
 * 📄 docs/INVOICE-ENGINE-PLAN.md Phase 3 — terms, thank-you, due date, bank
 * details, signature. Read from Rahul's myBillBook screenshots (Part 1 of that
 * document), which is where the list came from rather than my imagination.
 *
 * THE FAILURE THIS GUARDS. A setting that saves and never appears on the bill
 * is the invoiceTheme bug wearing different clothes: the shopkeeper types their
 * terms, sees "Saved", and their customer receives a bill without them. So each
 * field is followed from the schema, through the document, to the renderer.
 */

// jsdom has neither, and jspdf's PNG decoder needs both.
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util'
;(globalThis as unknown as Record<string, unknown>).TextEncoder ||= NodeTextEncoder
;(globalThis as unknown as Record<string, unknown>).TextDecoder ||= NodeTextDecoder

import { readCode } from '@/test-support/read-source'
import { dueDateFor, buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'
import { generateInvoicePDF } from '@/lib/invoice-pdf'

describe('dueDateFor — a date, never a term', () => {
  /*
   * Callable, so it can be exercised with a known-good and a known-bad input
   * rather than only by rendering a whole invoice — the 15 Aug guard rule.
   *
   * The bill prints "Please pay by 30 Aug 2026" and never "Net 15". Research on
   * invoice wording is consistent that a specific date outperforms the term,
   * and most shopkeepers — and most of their customers — have never met it.
   */
  const issued = new Date('2026-08-15T00:00:00Z')

  it('adds the shop\'s window to the invoice date', () => {
    const { dueDate, dueDateLabel } = dueDateFor(issued, 15, 1000)
    expect(dueDate?.getDate()).toBe(30)
    expect(dueDateLabel).toMatch(/30 Aug 2026/)
  })

  it('prints nothing when the shop has set no window', () => {
    expect(dueDateFor(issued, null, 1000).dueDate).toBeNull()
    expect(dueDateFor(issued, 0, 1000).dueDate).toBeNull()
    expect(dueDateFor(issued, -5, 1000).dueDate).toBeNull()
  })

  it('prints nothing on a bill that is already paid', () => {
    // A due date on a settled bill is a demand for money already received.
    expect(dueDateFor(issued, 15, 0).dueDate).toBeNull()
    expect(dueDateFor(issued, 15, -1).dueDate).toBeNull()
  })

  it('survives an unparseable invoice date', () => {
    expect(dueDateFor(new Date('nonsense'), 15, 1000).dueDate).toBeNull()
  })
})

describe('the content reaches the printed PDF', () => {
  const SHOP: InvoiceShop = {
    name: 'Rahul Grocery',
    phone: '8340228552',
    gstin: '10ABCDE1234F1Z5',
    state: 'Bihar',
    terms: 'Goods once sold will not be taken back. Disputes subject to Patna jurisdiction.',
    thankYou: 'Thank you for your business!',
    bank: {
      name: 'State Bank of India',
      accountName: 'Rahul Grocery',
      accountNumber: '1234567890',
      ifsc: 'SBIN0001234',
      branch: 'M.G. Road',
    },
  }

  const SRC: InvoiceSource = {
    invoiceNo: 'RG/26-27/1',
    date: '2026-08-15',
    party: { name: 'Gupta Provision' },
    items: [{ productName: 'Atta 10kg', quantity: 2, unitPrice: 450, gstRate: 5, total: 945, unit: 'bag', hsn: '1101' }],
    subtotal: 900, discountAmount: 0, cgst: 22.5, sgst: 22.5, igst: 0,
    totalAmount: 945, paidAmount: 0, paymentMode: 'cash',
    dueDays: 15,
  }

  const render = async (src = SRC, shop = SHOP): Promise<string> => {
    const blob = await generateInvoicePDF(buildInvoiceDocument(src, shop), { themeId: 'classic' })
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('could not read the PDF'))
      r.readAsBinaryString(blob)
    })
  }

  /*
   * jsPDF writes text as escaped octal inside parentheses, so a plain
   * `toContain` on a sentence will not match. Checking a distinctive WORD is
   * enough to prove the block was drawn, and does not depend on how the library
   * happens to encode punctuation.
   */
  const hasWord = (pdf: string, word: string) => pdf.includes(word)

  it('prints the terms', async () => {
    const pdf = await render()
    expect(hasWord(pdf, 'Terms')).toBe(true)
    expect(hasWord(pdf, 'jurisdiction')).toBe(true)
  }, 60000)

  it('prints the bank details', async () => {
    const pdf = await render()
    expect(hasWord(pdf, 'Bank Details')).toBe(true)
    expect(hasWord(pdf, '1234567890')).toBe(true)
    expect(hasWord(pdf, 'SBIN0001234')).toBe(true)
  }, 60000)

  it('prints the thank-you line', async () => {
    expect(hasWord(await render(), 'Thank you for your business')).toBe(true)
  }, 60000)

  it('prints the due date as a date', async () => {
    const pdf = await render()
    expect(hasWord(pdf, 'Please pay by')).toBe(true)
    expect(hasWord(pdf, '30 Aug 2026')).toBe(true)
    // And never the jargon.
    expect(pdf).not.toMatch(/Net\s?\d+/)
  }, 60000)

  it('prints none of it when the shop has filled nothing in', async () => {
    /*
     * The default must stay exactly as it was. A shop that has never opened
     * these settings gets the invoice it got yesterday.
     */
    const bare = await render({ ...SRC, dueDays: null }, { name: 'Rahul Grocery', state: 'Bihar' })
    expect(hasWord(bare, 'Terms')).toBe(false)
    expect(hasWord(bare, 'Bank Details')).toBe(false)
    expect(hasWord(bare, 'Please pay by')).toBe(false)
  }, 60000)

  it('still prints a signature line so the copy can be signed by hand', async () => {
    expect(hasWord(await render(), 'Authorised Signatory')).toBe(true)
  }, 60000)

  it('omits the signature block entirely when the shop turns it off', async () => {
    const pdf = await render(SRC, { ...SHOP, showSignatureBox: false })
    expect(hasWord(pdf, 'Authorised Signatory')).toBe(false)
  }, 60000)

  it('adds the receiver line only when asked', async () => {
    expect(hasWord(await render(), 'Receiver')).toBe(false)
    const withIt = await render(SRC, { ...SHOP, showReceiverSignature: true })
    expect(hasWord(withIt, 'Receiver')).toBe(true)
  }, 60000)
})

describe('the settings are wired end to end', () => {
  it('the API validates every new field', () => {
    const route = readCode('src/app/api/settings/route.ts')
    for (const f of ['invoicePrefix', 'invoiceTerms', 'invoiceThankYou', 'bankIfsc', 'signatureUrl']) {
      expect({ field: f, handled: route.includes(f) }).toEqual({ field: f, handled: true })
    }
    // Rule 46(b): a serial number below 1 is an invalid invoice, not a taste.
    expect(route).toContain('invoiceNextNumber')
    expect(route).toContain('must be a whole number, 1 or more')
  })

  it('the signature upload mirrors the logo route rather than inventing a second way', () => {
    const sig = readCode('src/app/api/settings/signature/route.ts')
    const logo = readCode('src/app/api/settings/logo/route.ts')
    for (const shared of ['getAuthUserIdWithModule', 'uploadBillImage', 'db.setting.upsert']) {
      expect({ shared, inSignature: sig.includes(shared), inLogo: logo.includes(shared) })
        .toEqual({ shared, inSignature: true, inLogo: true })
    }
    // And it never reports success on a failed upload.
    expect(sig).toContain('502')
  })

  it('the live preview shows the same fields the PDF prints', () => {
    // Otherwise the preview stops being a preview.
    const preview = readCode('src/components/settings/InvoicePreview.tsx')
    for (const f of ['terms', 'thankYou', 'signatureUrl', 'bank', 'dueDateLabel']) {
      expect({ field: f, shown: preview.includes(f) }).toEqual({ field: f, shown: true })
    }
  })
})
