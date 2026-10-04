/**
 * Phase 2c (#114) — every PDF design prints the place of supply SAVED on the
 * bill and the delivery address. Rule 46(n): place of supply with the State
 * name on an inter-state supply; Rule 46(o): the delivery address where it
 * differs from the place of supply.
 *
 * One design (the "supply & payment" card) printed the party's state as
 * typed, ignoring the document; a courier sale would have printed the
 * customer's home state as the place of supply. So every layout is drawn and
 * its text read back — a design added later cannot quietly drop either line.
 */

// jsdom has neither, and jspdf's PNG decoder needs both.
import { TextEncoder as NE, TextDecoder as ND } from 'util'
;(globalThis as unknown as Record<string, unknown>).TextEncoder ||= NE
;(globalThis as unknown as Record<string, unknown>).TextDecoder ||= ND

import { INVOICE_LAYOUTS } from '@/lib/invoice-layouts'
import { buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'
import { generateInvoicePDF } from '@/lib/invoice-pdf'

const SHOP: InvoiceShop = { name: 'Jaipur Kurta House', gstin: '08AAJFG2468H1Z7', state: 'Rajasthan', address: 'Johari Bazaar, Jaipur' }

/** A courier sale: customer recorded in Rajasthan ("RJ"), goods sent to Lucknow. */
const COURIER: InvoiceSource = {
  invoiceNo: 'INV-0006',
  date: '2026-10-04',
  type: 'sale',
  party: { name: 'Asha Verma', phone: '9876500000', address: 'Malviya Nagar, Jaipur', state: 'RJ' },
  items: [{ productName: 'Kurta', quantity: 1, unitPrice: 242.86, gstRate: 5, total: 255, cgst: 0, sgst: 0, igst: 12.14 } as never],
  subtotal: 242.86, discountAmount: 0, cgst: 0, sgst: 0, igst: 12.14, totalAmount: 255, paidAmount: 255,
  paymentMode: 'cash', isInterState: true,
  placeOfSupply: '09', deliveryState: 'Uttar Pradesh', deliveryAddress: '12 MG Road, Hazratganj, Lucknow 226001',
}

/*
 * jsPDF gives every document its own `text` method, so the constructor is
 * wrapped: each sheet the renderer creates records what it draws. The factory
 * runs lazily, on the renderer's first import — after the polyfill above.
 */
const drawn: string[] = []
jest.mock('jspdf', () => {
  const actual = jest.requireActual('jspdf')
  function Recording(this: unknown, ...args: unknown[]) {
    const sheet = new actual.jsPDF(...args)
    const draw = sheet.text.bind(sheet)
    sheet.text = (t: unknown, ...rest: unknown[]) => {
      drawn.push(Array.isArray(t) ? t.join(' ') : String(t))
      return draw(t, ...rest)
    }
    return sheet
  }
  Object.assign(Recording, actual.jsPDF)
  return { ...actual, jsPDF: Recording, default: Recording }
})

/** Bill-to-ship-to: a registered Jaipur dealer (state typed "RJ") has the goods sent to their customer in Pune. */
const SHIP_TO_DEALER: InvoiceSource = {
  ...COURIER,
  invoiceNo: 'INV-0007',
  party: { name: 'Gupta Traders', gstin: '08AAJFG2468H1Z7', address: 'MI Road, Jaipur', state: 'RJ' },
  cgst: 6.07, sgst: 6.07, igst: 0, isInterState: false,
  placeOfSupply: '08', deliveryState: 'Maharashtra', deliveryAddress: 'Koregaon Park, Pune 411001',
}

async function textsDrawn(templateId: string, src: InvoiceSource = COURIER): Promise<string> {
  drawn.length = 0
  await generateInvoicePDF(buildInvoiceDocument(src, SHOP), { templateId, themeId: 'classic' })
  return drawn.join('\n')
}

describe.each(INVOICE_LAYOUTS.map(t => [t.id, t.name] as [string, string]))('PDF design %s (%s)', (templateId: string) => {
  it('prints the delivery address with its state (Rule 46(o))', async () => {
    expect(await textsDrawn(templateId)).toContain('Ship to: 12 MG Road, Hazratganj, Lucknow 226001 — Uttar Pradesh (09)')
  })
  it('never prints the customer\'s typed state as the place of supply', async () => {
    for (const src of [COURIER, SHIP_TO_DEALER]) {
      const text = await textsDrawn(templateId, src)
      expect(text).not.toMatch(/Place of Supply:\s*RJ/i)
      expect(text).not.toMatch(/State:\s*RJ/)
    }
  })
  it('bill-to-ship-to: the buyer\'s state is the place of supply, the other state is the ship-to', async () => {
    const text = await textsDrawn(templateId, SHIP_TO_DEALER)
    expect(text).toContain('Ship to: Koregaon Park, Pune 411001 — Maharashtra (27)')
    expect(text).toMatch(/Rajasthan \(08\)/)
  })
})

describe('the design with a place-of-supply line prints the saved one (Rule 46(n))', () => {
  it('at least one design prints "Uttar Pradesh (09)" as the place of supply', async () => {
    const all = await Promise.all(INVOICE_LAYOUTS.map(l => textsDrawn(l.id)))
    expect(all.some(t => /Place of Supply:?\s*Uttar Pradesh \(09\)|State: Uttar Pradesh \(09\)/i.test(t))).toBe(true)
  })
})
