/**
 * The end-to-end proof: does the chosen theme actually come out on the PDF?
 *
 * 📄 2026-08-15, Phase 1 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * WHY THIS EXISTS ALONGSIDE THE IMPORT GUARD. `invoice-renderers-single-source`
 * checks the wiring — that the PDF is handed a theme id and asks the palette for
 * it. That is a claim about the source. This renders the real document twice and
 * reads the colour operators back out of the produced file, which is a claim
 * about the OUTPUT. The bug being prevented lived exactly in the gap between
 * those two: `Setting.invoiceTheme` was stored, read, and shown in a picker with
 * eight options, and the PDF printed saffron every time, while the setting said
 * in as many words that it applied to "the bill picture, the bill link and the
 * PDF".
 *
 * A test that only checked the wiring would have passed on a renderer that
 * asked for the palette and then ignored it.
 */

// jsdom has neither, and jspdf's PNG decoder needs both.
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util'
;(globalThis as unknown as Record<string, unknown>).TextEncoder ||= NodeTextEncoder
;(globalThis as unknown as Record<string, unknown>).TextDecoder ||= NodeTextDecoder

import { buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'
import { generateInvoicePDF } from '@/lib/invoice-pdf'
import { INVOICE_THEMES, getInvoiceTheme } from '@/lib/invoice-themes'
import { parseCssColor } from '@/lib/pdf/palette'

const SHOP: InvoiceShop = {
  name: 'Rahul Grocery',
  phone: '8340228552',
  gstin: '10ABCDE1234F1Z5',
  address: 'Main Road, Patna',
  state: 'Bihar',
  upiId: 'rahul@upi',
}

const SRC: InvoiceSource = {
  invoiceNo: 'INV-0001',
  date: '2026-08-15',
  party: { name: 'Gupta Provision', gstin: '10ZZZZZ1234F1Z5', state: 'Bihar' },
  items: [
    { productName: 'Atta 10kg', quantity: 2, unitPrice: 450, gstRate: 5, total: 945, unit: 'bag', hsn: '1101' },
    { productName: 'Sugar 1kg', quantity: 5, unitPrice: 45, gstRate: 5, total: 236.25, unit: 'pkt', hsn: '1701' },
  ],
  subtotal: 1125,
  discountAmount: 0,
  cgst: 28.13,
  sgst: 28.13,
  igst: 0,
  totalAmount: 1181.25,
  paidAmount: 200,
  paymentMode: 'cash',
}

/** Render the invoice and hand back the raw PDF bytes as a latin1 string. */
async function renderWith(themeId: string): Promise<string> {
  const blob = await generateInvoicePDF(buildInvoiceDocument(SRC, SHOP), { themeId })
  // jsdom's Blob has no arrayBuffer(); FileReader does exist.
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('could not read the produced PDF'))
    r.readAsBinaryString(blob)
  })
}

/** jsPDF writes fills as `r g b rg`, each channel 0-1. */
function fillOperators(pdf: string): Set<string> {
  return new Set(
    [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map(m => `${m[1]},${m[2]},${m[3]}`),
  )
}

/** Is `#rrggbb` among the fills, allowing for jsPDF's 0-1 rounding? */
function containsColor(fills: Set<string>, hex: string): boolean {
  const rgb = parseCssColor(hex)!.rgb
  return [...fills].some(f => {
    const [r, g, b] = f.split(',').map(Number)
    return (
      Math.abs(r * 255 - rgb.r) <= 1.5 &&
      Math.abs(g * 255 - rgb.g) <= 1.5 &&
      Math.abs(b * 255 - rgb.b) <= 1.5
    )
  })
}

describe('the shop\'s invoice theme reaches the printed PDF', () => {
  it('prints a different document for Saffron than for Midnight', async () => {
    const [saffron, midnight] = await Promise.all([renderWith('saffron'), renderWith('midnight')])
    const a = fillOperators(saffron)
    const b = fillOperators(midnight)

    expect(a.size).toBeGreaterThan(3)
    expect([...a].sort().join('|')).not.toEqual([...b].sort().join('|'))
  }, 60000)

  it('prints the exact header and accent colours the registry defines', async () => {
    /*
     * Not "they differ" but "they are the right ones". The other two renderers
     * read `headerBg` and `accent` straight from invoice-themes.ts, so checking
     * the same two values here is what makes all three provably one look.
     */
    for (const id of ['midnight', 'emerald', 'crimson'] as const) {
      const theme = getInvoiceTheme(id)
      const fills = fillOperators(await renderWith(id))
      expect({ id, header: containsColor(fills, theme.headerBg) }).toEqual({ id, header: true })
      expect({ id, accent: containsColor(fills, theme.accent) }).toEqual({ id, accent: true })
    }
  }, 120000)

  it('leaves NO trace of the old hardcoded saffron in a dark invoice', async () => {
    /*
     * 🐛 The assertion this file was missing, and the reason it is here.
     *
     * The first version only checked that the chosen colours were PRESENT. They
     * were — and a third of the document was still printing the old hardcoded
     * `THEME.brand` regardless, because `pdf/primitives.ts` drew the footer rule
     * and the "Made with EkBook" line from its own constant. A Midnight invoice
     * came out dark blue with a saffron stripe across the bottom.
     *
     * I did not find that by reading the guard. I found it in a stray jsPDF font
     * warning that happened to print the offending line. Checking for ABSENCE is
     * what makes the guard able to fail.
     */
    const OLD_HARDCODED_SAFFRON = '#D96E1B'  // THEME.brand: {217,110,27}
    const fills = fillOperators(await renderWith('midnight'))
    expect(containsColor(fills, OLD_HARDCODED_SAFFRON)).toBe(false)

    // And the same for the strokes, which is where the footer rule lives.
    const pdf = await renderWith('midnight')
    const strokes = new Set(
      [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) RG/g)].map(m => `${m[1]},${m[2]},${m[3]}`),
    )
    expect(containsColor(strokes, OLD_HARDCODED_SAFFRON)).toBe(false)
  }, 60000)

  it('falls back to the default theme rather than failing, for an unknown id', async () => {
    // A theme deleted from the registry must not stop a shop printing a bill.
    const fills = fillOperators(await renderWith('a-theme-we-removed'))
    const fallback = getInvoiceTheme(null)
    expect(containsColor(fills, fallback.headerBg)).toBe(true)
  }, 60000)

  it('renders every theme in the registry without throwing', async () => {
    // Cheap insurance: a malformed colour string in one entry would otherwise
    // only surface when a shopkeeper picked that one.
    for (const t of INVOICE_THEMES) {
      const pdf = await renderWith(t.id)
      expect({ theme: t.id, ok: pdf.startsWith('%PDF') }).toEqual({ theme: t.id, ok: true })
    }
  }, 180000)
})
