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
import { isVisible, VISIBILITY_TOGGLES, type InvoiceVisibility } from './invoice-visibility'

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

  /*
   * 📄 Phase 4 — both NULL when the shop has the toggle off.
   *
   * Absence, not a flag. See the note on buildInvoiceDocument: a renderer that
   * is handed nothing cannot forget to hide it, whereas a renderer handed a
   * boolean can — and did, which is how the PDF once ignored the shop's theme
   * while the WhatsApp image honoured it.
   */
  /** The notes saved against this product in Inventory. */
  description: string | null
  /** "500 ml" — what was typed, when it differs from how it is stored. */
  altQty: string | null
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
  /*
   * 📄 Phase 3 shipped these as flat fields; Phase 4 moved every visibility
   * switch into `show` below. They are kept as INPUT only so Phase 3's tests
   * still exercise the old path unchanged, and as the RESOLVED output that
   * renderers read — after buildInvoiceDocument these are always a definite
   * boolean, never undefined. New callers set `show`.
   */
  showSignatureBox?: boolean
  showReceiverSignature?: boolean
  bank?: {
    name?: string | null
    accountName?: string | null
    accountNumber?: string | null
    ifsc?: string | null
    branch?: string | null
  } | null

  /**
   * 📄 Phase 4 — the shop's on/off answers. See lib/invoice-visibility.
   *
   * On the SHOP for the same reason as the fields above: these are identical
   * on every bill. Read through `isVisible()` so the DEFAULT for each toggle
   * has exactly one home — the registry — and never a second copy here.
   */
  show?: InvoiceVisibility
}

/** Where the bill stands. Drives the stamp every surface shows. */
export type InvoiceStatus = 'paid' | 'partial' | 'due'

export interface InvoiceDocument {
  title: string
  invoiceNo: string
  date: Date
  dateLabel: string
  /**
   * "07:45 PM", or null when the shop has the toggle off.
   *
   * 📄 Phase 4. Printed exactly as stored, never guessed at: a bill entered
   * with a back-dated date-picker carries midnight, and suppressing that on a
   * hunch is Cause 6 — inferring a fact instead of reading it.
   */
  timeLabel: string | null

  shop: InvoiceShop
  party: InvoiceParty | null

  /**
   * What this customer owes across ALL their bills — not this bill's due,
   * which is `due` below. Null when the toggle is off or nothing was supplied.
   *
   * 📄 Phase 4. Computed on the SERVER by computePartyBalance and handed in,
   * never worked out here: it is six aggregates over the party's whole
   * history, the database does that work, and an invoice renderer running in
   * a browser must not be issuing queries. See the BUILD FOR MILLIONS note in
   * CLAUDE.md — this is one indexed aggregate per bill, not one per line.
   */
  partyBalance: number | null
  /** "Outstanding as on 15 Aug 2026 — ₹12,400". Includes the date SPECIFICALLY
   *  because the figure moves: without it, two prints of one invoice disagree
   *  and neither says why. */
  partyBalanceLabel: string | null

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
  /** Product.notes, joined on by whoever loads the transaction. */
  description?: string | null
  /* What the shopkeeper actually typed, snapshotted on the line at save time
   * (line-items.ts). "500" + "ml" where the line stores 0.5 ltr. */
  enteredQuantity?: number | null
  enteredUnit?: string | null
}

export interface InvoiceSource {
  /** Setting.invoiceDueDays. Null or 0 prints no due date. */
  dueDays?: number | null
  /**
   * The party's total outstanding, from computePartyBalance on the server.
   *
   * Positive means they owe the shop. Anything else — zero, or a credit —
   * prints nothing: "Outstanding ₹0" is noise, and a negative number on a
   * customer's bill reads as a demand rather than as their credit.
   */
  partyBalance?: number | null
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
 * A Setting row → the shop half of an invoice.
 *
 * 📄 Phase 4. Three screens were each building this object by hand — the
 * transaction detail twice over, and the settings preview once — which is
 * GATE 2's "two things describing one thing" with a third on the way. Phase 3
 * had already left a comment at one of them warning that a field the document
 * can carry and no caller fills is a setting that silently does nothing; that
 * warning only holds if there is one place to add the field.
 *
 * Deliberately takes a loose shape: the client sees a JSON Setting, the server
 * sees a Prisma one, and neither should have to be converted before asking for
 * a shop.
 */
export function invoiceShopFromSetting(setting: Record<string, unknown> | null | undefined): InvoiceShop {
  const s = (setting ?? {}) as Record<string, never>
  const visibility: InvoiceVisibility = {}
  for (const t of VISIBILITY_TOGGLES) {
    if (typeof s[t.key] === 'boolean') visibility[t.key] = s[t.key]
  }

  return {
    name: s.shopName || 'My Shop',
    ownerName: s.ownerName,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    address: s.address,
    state: s.state,
    upiId: s.upiId,
    logoUrl: s.logoUrl,
    terms: s.invoiceTerms,
    thankYou: s.invoiceThankYou,
    signatureUrl: s.signatureUrl,
    bank: {
      name: s.bankName,
      accountName: s.bankAccountName,
      accountNumber: s.bankAccountNumber,
      ifsc: s.bankIfsc,
      branch: s.bankBranch,
    },
    show: visibility,
  }
}

/** "07:45 PM". Null on a date this codebase could not parse. */
function formatTime(d: Date): string | null {
  if (isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

/**
 * "500 ml" — but ONLY when it says something the qty column does not.
 *
 * A line entered as "2 kg" and stored as "2 kg" would otherwise print
 * "2 kg (2 kg)", which is the kind of detail that makes a bill look
 * machine-generated and careless. Exported so a test can exercise the rule
 * directly with both a differing and an identical pair, rather than by
 * rendering an invoice and squinting at it (CLAUDE.md, Cause 7).
 */
export function alternateQtyLabel(
  quantity: number,
  unit: string | null | undefined,
  enteredQuantity: number | null | undefined,
  enteredUnit: string | null | undefined,
): string | null {
  if (enteredQuantity == null || !enteredUnit) return null
  const sameUnit = (unit || '').trim().toLowerCase() === enteredUnit.trim().toLowerCase()
  if (sameUnit && enteredQuantity === quantity) return null
  return `${enteredQuantity} ${enteredUnit.trim()}`
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

  /*
   * ── 📄 Phase 4: the toggles are applied HERE, once. ──────────────────
   *
   * Every one resolves to a value or to null, and the renderers receive only
   * the result. None of them imports invoice-visibility, none of them branches
   * on a setting, and a guard proves it stays that way.
   *
   * That is the whole point. The invoiceTheme bug happened because four
   * renderers each had to remember to honour one setting and one of them
   * didn't. A renderer handed `null` has nothing left to get wrong.
   */
  /*
   * One resolved set of answers, from two possible inputs.
   *
   * Phase 3 put the signature switches on the shop as flat fields. Rather
   * than leave two ways to say the same thing, they are folded in here and
   * `show` is the only input callers use from Phase 4 on. The flat fields win
   * when present SPECIFICALLY so Phase 3's own test — which passes
   * `showSignatureBox: false` — keeps passing: if that test still goes green,
   * this refactor provably did not change what an existing shop's bill looks
   * like. Editing that test to match new behaviour would have hidden exactly
   * the regression it exists to catch.
   */
  const visibility: InvoiceVisibility = {
    ...shop.show,
    ...(typeof shop.showSignatureBox === 'boolean' ? { showSignatureBox: shop.showSignatureBox } : {}),
    ...(typeof shop.showReceiverSignature === 'boolean'
      ? { showReceiverSignature: shop.showReceiverSignature }
      : {}),
  }

  const showDescription = isVisible('showItemDescription', visibility)
  const showAltUnit = isVisible('showAlternateUnit', visibility)

  // Only a real, positive debt is worth printing. Zero is noise; a negative is
  // the customer in CREDIT, and "Outstanding −₹500" on a bill reads as a
  // demand for money they are actually owed.
  const balance = isVisible('showPartyBalance', visibility)
    && typeof src.partyBalance === 'number'
    && src.partyBalance > 0
    ? roundMoney(src.partyBalance)
    : null

  return {
    title: src.type === 'purchase' ? 'PURCHASE BILL' : 'TAX INVOICE',
    invoiceNo: src.invoiceNo || '—',
    date,
    dateLabel: formatDate(date),
    timeLabel: isVisible('showInvoiceTime', visibility) ? formatTime(date) : null,

    /*
     * The two `line` toggles are resolved through the registry too, so their
     * defaults live in ONE place. Renderers keep reading shop.showSignatureBox
     * exactly as Phase 3 left them — this only removes the second copy of the
     * default, it does not move the field.
     */
    shop: {
      ...shop,
      showSignatureBox: isVisible('showSignatureBox', visibility),
      showReceiverSignature: isVisible('showReceiverSignature', visibility),
    },
    party: src.party ?? null,

    partyBalance: balance,
    /*
     * The WORDS only — the figure is appended by each renderer using its own
     * money formatter.
     *
     * My first version baked the amount in here with a private formatter, and
     * the guard caught it: the PDF's own formatIndianDigits groups the Indian
     * way (₹12,40,000.00), so a lakh-rupee balance would have printed in a
     * different grouping from every other figure on the same page. A second
     * money formatter is GATE 2's "two things describing one thing", and this
     * one would have disagreed with its sibling six digits in.
     */
    partyBalanceLabel: balance === null
      ? null
      : `Outstanding as on ${formatDate(new Date())}`,

    items: src.items.map(i => ({
      name: i.productName,
      qtyValue: i.quantity,
      qty: i.unit ? `${i.quantity} ${i.unit}` : String(i.quantity),
      unit: i.unit,
      hsn: i.hsn ?? null,
      rate: roundMoney(i.unitPrice),
      gstRate: i.gstRate,
      total: roundMoney(i.total),
      description: showDescription ? (i.description?.trim() || null) : null,
      altQty: showAltUnit
        ? alternateQtyLabel(i.quantity, i.unit, i.enteredQuantity, i.enteredUnit)
        : null,
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
