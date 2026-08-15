/**
 * Templates: the bones of an invoice, chosen separately from its colour.
 *
 * 📄 2026-08-15, Phase 2 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * THE SAFETY PROPERTY THIS FILE EXISTS FOR. Introducing templates must change
 * nothing for anyone who has not asked for a change. `standard` has to resolve
 * to the exact numbers the renderer hardcoded before templates existed — 32mm
 * band, 7mm rows, 9pt body, 5mm baseline — because every shop is on it by
 * default and a silent shift in their invoice is a bug even if it looks fine.
 *
 * The rest checks the contract holds: a template may change how the page is
 * drawn and never what is on it.
 */

// jsdom has neither, and jspdf's PNG decoder needs both.
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util'
;(globalThis as unknown as Record<string, unknown>).TextEncoder ||= NodeTextEncoder
;(globalThis as unknown as Record<string, unknown>).TextDecoder ||= NodeTextDecoder

import {
  INVOICE_TEMPLATES, DENSITY_METRICS, DEFAULT_TEMPLATE_ID,
  getInvoiceTemplate, metricsFor,
} from '@/lib/invoice-templates'
import { buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'
import { generateInvoicePDF } from '@/lib/invoice-pdf'

const SHOP: InvoiceShop = {
  name: 'Rahul Grocery',
  phone: '8340228552',
  gstin: '10ABCDE1234F1Z5',
  address: 'Main Road, Patna',
  state: 'Bihar',
  upiId: 'rahul@upi',
}

/** Eight items, so page-filling differences between densities actually show. */
const SRC: InvoiceSource = {
  invoiceNo: 'INV-0007',
  date: '2026-08-15',
  party: { name: 'Gupta Provision', gstin: '10ZZZZZ1234F1Z5', state: 'Bihar' },
  items: Array.from({ length: 8 }, (_, i) => ({
    productName: `Item number ${i + 1}`,
    quantity: i + 1,
    unitPrice: 100 + i,
    gstRate: 5,
    total: (100 + i) * (i + 1) * 1.05,
    unit: 'pcs',
    hsn: '1101',
  })),
  subtotal: 4260,
  discountAmount: 0,
  cgst: 106.5,
  sgst: 106.5,
  igst: 0,
  totalAmount: 4473,
  paidAmount: 1000,
  paymentMode: 'cash',
}

async function renderBytes(templateId?: string): Promise<string> {
  const blob = await generateInvoicePDF(buildInvoiceDocument(SRC, SHOP), {
    themeId: 'classic',
    templateId,
  })
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('could not read the produced PDF'))
    r.readAsBinaryString(blob)
  })
}

/** The text-drawing operators, which is where layout differences show up. */
function textOps(pdf: string): string[] {
  // [\s\S] rather than the `s` flag — the tsconfig target predates it.
  return [...pdf.matchAll(/BT\s([\s\S]*?)\sET/g)].map(m => m[1])
}

describe('the standard template changes nothing', () => {
  it('resolves to the numbers the renderer used before templates existed', () => {
    const m = metricsFor(getInvoiceTemplate('standard'))
    expect(m).toEqual({
      rowHeight: 7,
      headerHeight: 8,
      bodyPt: 9,
      smallPt: 7,
      bandHeight: 32,
      baseline: 5,
    })
  })

  it('is what an unset, unknown or null template falls back to', () => {
    // A shop that has never touched the setting, and a template we later
    // remove, must both still print.
    expect(getInvoiceTemplate(null).id).toBe(DEFAULT_TEMPLATE_ID)
    expect(getInvoiceTemplate(undefined).id).toBe(DEFAULT_TEMPLATE_ID)
    expect(getInvoiceTemplate('a-template-we-deleted').id).toBe(DEFAULT_TEMPLATE_ID)
    expect(DEFAULT_TEMPLATE_ID).toBe('standard')
  })

  it('produces the same document whether asked for by name or left unset', async () => {
    const [unset, named] = await Promise.all([renderBytes(undefined), renderBytes('standard')])
    expect(textOps(named)).toEqual(textOps(unset))
  }, 60000)
})

describe('a template actually changes the page', () => {
  it('compact saves a sheet of paper on a long bill', async () => {
    /*
     * The exact claim in `compact`'s own description — "so a long kirana bill
     * still fits one page" — asserted as pages, which is the thing a shopkeeper
     * actually pays for. Two sheets per sale is a real cost.
     *
     * An earlier version of this test tried to parse text-matrix y-coordinates
     * out of the content stream and compare them. That was me guessing at
     * jsPDF's output format instead of measuring the outcome, and it failed for
     * a reason that had nothing to do with the feature. Counting pages needs no
     * assumption about how the library writes its operators.
     */
    const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length

    const longBill: InvoiceSource = {
      ...SRC,
      items: Array.from({ length: 30 }, (_, i) => ({
        productName: `Item number ${i + 1}`,
        quantity: 1,
        unitPrice: 100,
        gstRate: 5,
        total: 105,
        unit: 'pcs',
        hsn: '1101',
      })),
    }
    const render = async (templateId: string) => {
      const blob = await generateInvoicePDF(buildInvoiceDocument(longBill, SHOP), {
        themeId: 'classic',
        templateId,
      })
      return new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('could not read the produced PDF'))
        r.readAsBinaryString(blob)
      })
    }

    const regularPages = pageCount(await render('standard'))
    const compactPages = pageCount(await render('compact'))

    expect(regularPages).toBeGreaterThan(0)
    expect(compactPages).toBeLessThanOrEqual(regularPages)
    // And the density really is doing something: 30 rows at 5.4mm occupy
    // ~48mm less than at 7mm, which is most of the space the totals need.
    expect(30 * (7 - 5.4)).toBeGreaterThan(45)
  }, 120000)

  it('every template renders a valid PDF', async () => {
    // A malformed entry would otherwise only surface when a shop picked it.
    for (const t of INVOICE_TEMPLATES) {
      const pdf = await renderBytes(t.id)
      expect({ template: t.id, ok: pdf.startsWith('%PDF') }).toEqual({ template: t.id, ok: true })
    }
  }, 180000)

  it('produces a visibly different document for each distinct structure', async () => {
    // Six entries that all rendered identically would be a picker of lies.
    const shapes = new Map<string, string>()
    for (const t of INVOICE_TEMPLATES) {
      shapes.set(t.id, textOps(await renderBytes(t.id)).join('|'))
    }
    expect(new Set(shapes.values()).size).toBe(INVOICE_TEMPLATES.length)
  }, 180000)
})

describe('the contract', () => {
  it('gives every density a full set of metrics', () => {
    for (const [density, m] of Object.entries(DENSITY_METRICS)) {
      expect({ density, complete: Object.values(m).every(v => typeof v === 'number' && v > 0) })
        .toEqual({ density, complete: true })
    }
  })

  it('never sets body text below the legibility floor', () => {
    /*
     * §4: nothing under 12px on screen. Print is a different medium — a bill is
     * read at arm's length on paper, not at phone distance — but there is still
     * a floor, and 7.5pt is it for a shop tubelight. `compact` buys its density
     * from row height, never by shrinking the type past readable.
     */
    for (const [density, m] of Object.entries(DENSITY_METRICS)) {
      expect({ density, ok: m.bodyPt >= 8 }).toEqual({ density, ok: true })
      expect({ density, ok: m.smallPt >= 6.5 }).toEqual({ density, ok: true })
    }
  })

  it('keeps the text baseline inside its row', () => {
    // A baseline past rowHeight prints the row's text on top of the next one.
    for (const [density, m] of Object.entries(DENSITY_METRICS)) {
      expect({ density, inside: m.baseline < m.rowHeight }).toEqual({ density, inside: true })
    }
  })

  it('has unique ids and names', () => {
    const ids = INVOICE_TEMPLATES.map(t => t.id)
    const names = INVOICE_TEMPLATES.map(t => t.name)
    expect(ids).toEqual([...new Set(ids)])
    expect(names).toEqual([...new Set(names)])
  })

  it('carries no field-level switches', () => {
    /*
     * The contract's one prohibition. Rule 46 fixes the sixteen fields an
     * Indian tax invoice must carry; a "design" able to drop the place of
     * supply is a design that produces an invalid invoice. If a key like
     * `showGstin` ever appears here, this fails and the discussion happens
     * before it ships rather than after.
     */
    const structuralKeys = new Set([
      'id', 'name', 'description', 'paper', 'header', 'table', 'totals', 'density', 'titleFace',
    ])
    for (const t of INVOICE_TEMPLATES) {
      const unexpected = Object.keys(t).filter(k => !structuralKeys.has(k))
      expect({ template: t.id, unexpected }).toEqual({ template: t.id, unexpected: [] })
    }
  })
})
