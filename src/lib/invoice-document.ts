/**
 * InvoiceDocument — what is ON an invoice, separated from how it is drawn.
 *
 * 🎨 2026-08-05, Phase 1 of docs/INVOICE-PDF-PLAN.md.
 *
 * An invoice now has to reach three surfaces that look nothing alike: a
 * WhatsApp image built for a phone screen, an A4 PDF, and eventually a 58mm
 * thermal receipt. Written as three renderers over three copies of the data,
 * they WILL disagree — and the thing they would disagree about is the amount
 * due, because that is the one field computed rather than copied.
 *
 * So the arithmetic happens exactly once, here, and the renderers only lay out
 * what they are given. This is the same split that made the business card work:
 * `card-templates.ts` says what is on the card, `TemplateCard` and `card-canvas`
 * both draw it, and the exported file cannot drift from the screen because
 * neither owns the numbers.
 *
 * Everything is presentation-ready: money is already rounded and the strings
 * are already formatted. A renderer that has to decide how to format a rupee
 * figure is a renderer that can format it differently from its sibling.
 */

import { computeInvoiceDue } from './invoice-due'
import { roundMoney } from './money'
import { amountToWords } from './amount-to-words'

export interface InvoiceDocumentItem {
  name: string
  /** "2 kg", "3 pcs" — quantity and unit already joined for display. */
  qty: string
  /** Raw quantity, for renderers that lay out numerals separately. */
  qtyValue: number
  unit?: string
  hsn: string | null
  rate: number
  gstRate: number
  /** Line total INCLUDING this line's tax, as the ledger holds it. */
  total: number
}

export interface InvoiceParty {
  name: string
  phone?: string | null
  gstin?: string | null
  address?: string | null
  state?: string | null
}

export interface InvoiceShop {
  name: string
  ownerName?: string | null
  phone?: string | null
  email?: string | null
  gstin?: string | null
  address?: string | null
  state?: string | null
  upiId?: string | null
  logoUrl?: string | null

  /*
   * 📄 Phase 3 — what the shop puts ON the bill.
   *
   * On the SHOP and not the invoice because it is identical on every bill;
   * putting it on the document per-invoice would invite a renderer to read one
   * from the transaction and another from settings, which is precisely how the
   * PDF came to disagree with the picture.
   */
  terms?: string | null
  thankYou?: string | null
  signatureUrl?: string | null
  showSignatureBox?: boolean
  showReceiverSignature?: boolean
  bank?: {
    name?: string | null
    accountName?: string | null
    accountNumber?: string | null
    ifsc?: string | null
    branch?: string | null
  } | null
}

/** Where the bill stands. Drives the stamp every surface shows. */
export type InvoiceStatus = 'paid' | 'partial' | 'due'

export interface InvoiceDocument {
  title: string
  invoiceNo: string
  date: Date
  dateLabel: string

  shop: InvoiceShop
  party: InvoiceParty | null

  items: InvoiceDocumentItem[]

  subtotal: number
  discount: number
  cgst: number
  sgst: number
  igst: number
  /** cgst + sgst + igst, so no renderer has to add them up again. */
  taxTotal: number
  roundOff: number
  total: number

  paid: number
  /** What is STILL owed, after payments settled against this bill later. */
  due: number
  status: InvoiceStatus
  paymentMode: string

  /** Rupees in words, for the strip every Indian invoice carries. */
  totalInWords: string

  isInterState: boolean
  /** Rule 46: the place of supply, shown when the buyer is registered. */
  placeOfSupply: string | null
  /** True when GST applies at all — a composition dealer shows no tax breakup. */
  hasTax: boolean

  /** `upi://pay?...`, or null when the shop has no VPA or nothing is owed. */
  upiLink: string | null

  /**
   * When payment is due, as a real DATE.
   *
   * Computed here so every surface prints the same day. A date rather than a
   * term: research on invoice wording is consistent that "Please pay by 15
   * December" outperforms "Net 30" — and most shopkeepers, and most of their
   * customers, have never met the jargon.
   *
   * Null when the shop has not set a period, or when nothing is owed: a paid
   * bill with a due date on it is a demand for money already received.
   */
  dueDate: Date | null
  dueDateLabel: string | null

  /*
   * e-invoice details, when this invoice has been registered with the portal.
   *
   * Rule 48(4): an invoice covered by e-invoicing must carry the IRN and the
   * SIGNED QR code returned by the IRP. An invoice issued without them counts
   * as non-issuance — penalties under Section 122, and the buyer can lose their
   * input tax credit on it.
   *
   * The app stored both on the transaction and printed neither: every document
   * it produced for an e-invoicing shop — PDF, WhatsApp image, share page —
   * was legally not an invoice.
   *
   * Null for the overwhelming majority of shops, who are under the ₹5 crore
   * threshold and correctly have no IRN at all.
   */
  irn: string | null
  /** The signed QR string from the IRP. Rendered as a QR image, not as text. */
  signedQR: string | null
}

interface SourceItem {
  productName: string
  quantity: number
  unitPrice: number
  gstRate: number
  total: number
  unit?: string
  hsn?: string | null
}

export interface InvoiceSource {
  /** Setting.invoiceDueDays. Null or 0 prints no due date. */
  dueDays?: number | null
  irn?: string | null
  signedQR?: string | null
  invoiceNo?: string | null
  date: string | Date
  type?: string | null
  party?: InvoiceParty | null
  items: SourceItem[]
  subtotal: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  totalAmount: number
  roundOff?: number
  paidAmount: number
  paymentMode?: string | null
  isInterState?: boolean
  /**
   * Payments settled against this bill AFTER it was raised.
   *
   * 🔒 Carried over from the PDF's audit fix: `total − paid` alone ignores
   * later settlements, so a customer handed a bill they had part-paid saw the
   * original amount, and the status stamp contradicted the shop's own ledger.
   */
  allocatedAmount?: number
}

function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return String(date)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Builds the document every surface renders.
 *
 * The ONLY place invoice arithmetic happens. If a number appears on the image
 * and on the PDF, it was computed here once.
 */
export function buildInvoiceDocument(src: InvoiceSource, shop: InvoiceShop): InvoiceDocument {
  const date = typeof src.date === 'string' ? new Date(src.date) : src.date

  const due = computeInvoiceDue({
    totalAmount: src.totalAmount,
    paidAmount: src.paidAmount,
    allocatedAmount: src.allocatedAmount || 0,
  })

  const total = roundMoney(src.totalAmount)
  // Rounded before comparing: a due of ₹0.004 is paid, and a renderer that
  // compared raw floats would stamp DUE on a settled bill.
  const paidSoFar = roundMoney(total - due)

  const status: InvoiceStatus = due <= 0 ? 'paid' : paidSoFar > 0 ? 'partial' : 'due'

  const cgst = roundMoney(src.cgst)
  const sgst = roundMoney(src.sgst)
  const igst = roundMoney(src.igst)
  const taxTotal = roundMoney(cgst + sgst + igst)

  return {
    title: src.type === 'purchase' ? 'PURCHASE BILL' : 'TAX INVOICE',
    invoiceNo: src.invoiceNo || '—',
    date,
    dateLabel: formatDate(date),

    shop,
    party: src.party ?? null,

    items: src.items.map(i => ({
      name: i.productName,
      qtyValue: i.quantity,
      qty: i.unit ? `${i.quantity} ${i.unit}` : String(i.quantity),
      unit: i.unit,
      hsn: i.hsn ?? null,
      rate: roundMoney(i.unitPrice),
      gstRate: i.gstRate,
      total: roundMoney(i.total),
    })),

    subtotal: roundMoney(src.subtotal),
    discount: roundMoney(src.discountAmount),
    cgst,
    sgst,
    igst,
    taxTotal,
    roundOff: roundMoney(src.roundOff || 0),
    total,

    paid: paidSoFar,
    due,
    status,
    paymentMode: src.paymentMode || 'Cash',

    totalInWords: amountToWords(total),

    isInterState: Boolean(src.isInterState),
    // Rule 46 requires place of supply on an inter-state supply and whenever
    // the recipient is registered; the party's state is what it is.
    placeOfSupply: src.party?.gstin || src.isInterState ? src.party?.state ?? null : null,
    hasTax: taxTotal > 0,

    upiLink: buildUpiLink(shop, due),
    ...dueDateFor(date, src.dueDays ?? null, due),
    // Carried through so every renderer — PDF, share image, public page — can
    // print them. Rule 48(4) requires both on an e-invoice.
    irn: src.irn ?? null,
    signedQR: src.signedQR ?? null,
  }
}

/**
 * The due date, or nulls.
 *
 * Exported so it can be called with two arguments and tested both ways rather
 * than only exercised by building a whole document — the guard rule earned on
 * 15 Aug.
 */
export function dueDateFor(
  issued: Date,
  dueDays: number | null,
  due: number,
): { dueDate: Date | null; dueDateLabel: string | null } {
  // No period set, a nonsense period, or nothing left to pay.
  if (!dueDays || dueDays <= 0 || due <= 0 || isNaN(issued.getTime())) {
    return { dueDate: null, dueDateLabel: null }
  }
  const d = new Date(issued)
  d.setDate(d.getDate() + dueDays)
  return {
    dueDate: d,
    dueDateLabel: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  }
}

/**
 * A UPI intent link for the outstanding amount.
 *
 * Null when there is nothing to collect or no VPA to collect it into — a pay
 * button that opens an app and then fails is worse than no button.
 */
export function buildUpiLink(shop: InvoiceShop, due: number): string | null {
  if (!shop.upiId || due <= 0) return null
  const params = new URLSearchParams({
    pa: shop.upiId,
    pn: shop.name,
    am: due.toFixed(2),
    cu: 'INR',
  })
  return `upi://pay?${params.toString()}`
}
