/**
 * Paper size: the sheet, and whether it reaches what the customer receives.
 *
 * 📄 2026-08-15. Rahul: "add the size option in setting too so the user can
 * select the size they want and that type of size should be … when user
 * download or send on whatsapp."
 *
 * The last clause is the whole test. A picker that changes a preview and not
 * the file is the invoiceTheme bug again — eight designs offered, one printed —
 * so these assertions follow the value all the way to the two places a bill
 * actually leaves the app.
 */

// jsdom has neither, and jspdf's PNG decoder needs both.
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util'
;(globalThis as unknown as Record<string, unknown>).TextEncoder ||= NodeTextEncoder
;(globalThis as unknown as Record<string, unknown>).TextDecoder ||= NodeTextDecoder

import { readCode } from '@/test-support/read-source'
import { PAPER_SIZES, DEFAULT_PAPER_ID, getPaperSize, paperPx, MM_TO_PX } from '@/lib/invoice-paper'
import { isPreviewable } from '@/components/settings/InvoiceSettingsPage'

describe('the paper registry', () => {
  it('offers A4 and A5, with A4 the default', () => {
    expect(PAPER_SIZES.map(p => p.id).sort()).toEqual(['a4', 'a5'])
    expect(DEFAULT_PAPER_ID).toBe('a4')
  })

  it('carries the real ISO millimetres', () => {
    // jsPDF is created in mm, so these ARE the page — a wrong number here is a
    // wrong-sized sheet, not a rounding detail.
    const a4 = getPaperSize('a4')
    expect([a4.widthMm, a4.heightMm]).toEqual([210, 297])
    const a5 = getPaperSize('a5')
    expect([a5.widthMm, a5.heightMm]).toEqual([148, 210])
    /*
     * A5 is A4 halved along the long edge — 297/2 is 148.5, and ISO 216 rounds
     * every dimension DOWN to a whole millimetre, so the real sheet is 148.
     * My first version of this assertion demanded 148.5 and failed against the
     * correct number, which is a good reminder that a test asserting my
     * arithmetic rather than the standard is just a second place to be wrong.
     */
    expect(Math.abs(a5.widthMm - a4.heightMm / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(a5.heightMm - a4.widthMm)).toBeLessThanOrEqual(1)
  })

  it('falls back to A4 for null, undefined or a size we removed', () => {
    // A retired size must never stop a shop printing a bill.
    expect(getPaperSize(null).id).toBe('a4')
    expect(getPaperSize(undefined).id).toBe('a4')
    expect(getPaperSize('foolscap').id).toBe('a4')
  })

  it('converts to pixels at 96dpi for the preview', () => {
    expect(Math.round(210 * MM_TO_PX)).toBe(paperPx(getPaperSize('a4')).width)
    expect(paperPx(getPaperSize('a5')).width).toBeLessThan(paperPx(getPaperSize('a4')).width)
  })
})

describe('the chosen sheet reaches what the customer receives', () => {
  const pdf = readCode('src/lib/invoice-pdf.ts')

  it('creates the jsPDF document at the chosen size, not a hardcoded a4', () => {
    expect(pdf).toContain("format: paper.id")
    expect(pdf).not.toMatch(/format:\s*'a4'/)
  })

  it('takes page geometry from the sheet rather than the A4 constants', () => {
    // THEME.pageWidth/pageHeight are A4. Using them on an A5 page would put the
    // footer 87mm below the paper — i.e. nowhere.
    expect(pdf).toContain('paper.widthMm')
    expect(pdf).toContain('paper.heightMm')
    expect(pdf).not.toContain('const { margin, pageWidth, pageHeight } = THEME')
  })

  it('breaks pages at the sheet height', () => {
    // A5 holds far fewer rows; breaking at 297mm would run the table off it.
    expect(pdf).toMatch(/newPageIfNeeded\([\s\S]*?pageHeight\)/)
  })

  it('is passed on BOTH the download and the WhatsApp paths', () => {
    /*
     * The clause that matters. The download path is TransactionDetail's
     * generateInvoicePDF; the WhatsApp path is sendBill. The theme bug happened
     * because one of the two was wired and the other was not.
     */
    const detail = readCode('src/components/ledger/TransactionDetail.tsx')
    expect(detail).toMatch(/generateInvoicePDF\([\s\S]{0,200}paperId/)
    expect(detail).toMatch(/sendBill\([\s\S]{0,900}paperId/)

    const send = readCode('src/lib/send-bill.ts')
    expect(send).toMatch(/generateInvoicePDF\(doc,[\s\S]{0,160}paperId/)
  })

  it('is validated against the registry by the API', () => {
    const route = readCode('src/app/api/settings/route.ts')
    expect(route).toContain('PAPER_SIZES')
    expect(route).toContain('Unknown paper size')
  })
})

describe('the produced PDF really is the chosen sheet', () => {
  /*
   * The end-to-end proof, and the one the on-screen check cannot give.
   *
   * A4 and A5 share the same 1:sqrt(2) ratio, so a preview that changed size
   * would look identical either way — measuring its aspect proves nothing. The
   * page box inside the produced file is the only honest answer.
   *
   * PDF units are points: 1mm = 72/25.4. A4 is 595x842pt, A5 is 420x595pt.
   */
  const renderTo = async (paperId: string): Promise<string> => {
    const { buildInvoiceDocument } = await import('@/lib/invoice-document')
    const { generateInvoicePDF } = await import('@/lib/invoice-pdf')
    const doc = buildInvoiceDocument(
      {
        invoiceNo: 'INV-1', date: '2026-08-15',
        party: { name: 'Gupta Provision' },
        items: [{ productName: 'Atta 10kg', quantity: 2, unitPrice: 450, gstRate: 5, total: 945, unit: 'bag', hsn: '1101' }],
        subtotal: 900, discountAmount: 0, cgst: 22.5, sgst: 22.5, igst: 0,
        totalAmount: 945, paidAmount: 0, paymentMode: 'cash',
      },
      { name: 'Rahul Grocery', phone: '8340228552', gstin: '10ABCDE1234F1Z5', state: 'Bihar' },
    )
    const blob = await generateInvoicePDF(doc, { themeId: 'classic', paperId })
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('could not read the PDF'))
      r.readAsBinaryString(blob)
    })
  }

  const mediaBox = (pdf: string) => {
    const m = pdf.match(/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
    return m ? { w: Math.round(+m[3]), h: Math.round(+m[4]) } : null
  }

  it('produces an A4 page for a4', async () => {
    expect(mediaBox(await renderTo('a4'))).toEqual({ w: 595, h: 842 })
  }, 60000)

  it('produces a genuinely SMALLER A5 page for a5', async () => {
    const box = mediaBox(await renderTo('a5'))
    expect(box).toEqual({ w: 420, h: 595 })
  }, 60000)

  it('falls back to A4 for an unknown size rather than failing', async () => {
    expect(mediaBox(await renderTo('foolscap'))).toEqual({ w: 595, h: 842 })
  }, 60000)

  it('keeps the footer ON the A5 page', async () => {
    /*
     * The concrete risk of the old A4 constants: a footer drawn 15mm up from
     * 297 would land at 282mm, which is 72mm past the bottom edge of an A5
     * sheet — printed nowhere. jsPDF happily draws off-page, so this checks
     * that the text exists AND that nothing was placed beyond the box.
     */
    const pdf = await renderTo('a5')
    expect(pdf).toContain('Made with EkBook')
    const box = mediaBox(pdf)!
    const ys = [...pdf.matchAll(/([\d.]+) ([\d.]+) Td/g)].map(m => +m[2])
    const offPage = ys.filter(y => y < -5 || y > box.h + 5)
    expect(offPage).toEqual([])
  }, 60000)
})

describe('isPreviewable — when the demo bill stands in', () => {
  /*
   * Rahul: "if the user didn't created any bill then there should be a bill too
   * by default so user can check everything for demo."
   *
   * Extracted from the component so it can be called with two arguments and
   * watched both ways, per the 15 Aug guard rule.
   */
  const line = (over: Record<string, unknown> = {}) =>
    ({ productName: 'Atta', quantity: 1, unitPrice: 450, total: 472.5, ...over })

  it('uses the demo when there is no bill at all', () => {
    expect(isPreviewable(null)).toBe(false)
    expect(isPreviewable(undefined)).toBe(false)
    expect(isPreviewable({})).toBe(false)
    expect(isPreviewable({ items: [], totalAmount: 100 })).toBe(false)
  })

  it('uses the demo when the LINES carry no money', () => {
    // The real bug: a genuine invoice whose items came back without amounts,
    // rendering ₹0.00 beside a ₹70,800 total.
    expect(isPreviewable({
      totalAmount: 70800,
      items: [line({ total: 0, unitPrice: 0 })],
    })).toBe(false)
  })

  it('uses the real bill when it is complete', () => {
    expect(isPreviewable({ totalAmount: 472.5, items: [line()] })).toBe(true)
    // A rate but no line total is still enough to draw honestly.
    expect(isPreviewable({
      totalAmount: 472.5,
      items: [line({ total: undefined })],
    })).toBe(true)
  })
})
