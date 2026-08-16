/**
 * Choosing HOW a bill is sent, and saying so.
 *
 * 🎨 2026-08-05, Phase 3 of docs/DOCUMENT-ENGINE-PLAN.md.
 *
 * Rahul: "if the bills have so many items then it won't be possible to add
 * everything in one images ... so it's good for small bills."
 *
 * He was right, and the measurement is worse than the intuition. WHATSAPP
 * DOWNSAMPLES EVERY IMAGE TO ABOUT 1600px ON ITS LONGEST SIDE, so a tall bill
 * is squeezed SIDEWAYS. Rendered at 1080px wide, the width that survives is:
 *
 *      4 items → 929px    readable
 *      8 items → 796px    borderline
 *     15 items → 636px    unreadable
 *     30 items → 444px    unreadable
 *
 * A kirana bill is often three to ten lines; a distributor bill is often forty.
 * So neither format wins outright and something has to choose.
 *
 * WHY THE APP CHOOSES RATHER THAN ASKING. Rahul asked for a format the user
 * picks, and the capability is right — but a shopkeeper billing forty customers
 * a day does not want forty format decisions. Every question asked at the
 * moment of sending is a tax on the thing they do most. So: the app picks by
 * length, SAYS which it picked and why, one setting changes the default
 * forever, and one tap changes it for the exception.
 */

import type { InvoiceDocument } from './invoice-document'
import { measureHeight, IMAGE_WIDTH } from './invoice-share-image'

export type SendFormat = 'image' | 'pdf'
/** What the shop has chosen. 'smart' lets the bill decide. */
export type SendFormatPreference = 'smart' | SendFormat

/**
 * WhatsApp's ceiling: every image is downsampled to about this, on its LONGEST
 * side. Confirmed again on 16 Aug 2026 — ~1600px, re-encoded at 60-70% JPEG.
 * Sending as a *document* escapes it, but then it is no longer a picture that
 * opens in the chat, which is the entire reason to send one.
 */
export const WHATSAPP_LONGEST_SIDE = 1600

/**
 * The narrowest a bill may arrive and still be read on a phone.
 *
 * A bill is a TABLE. It is not read like a photograph — the eye goes to one
 * cell, so what matters is whether a column of digits is still separable.
 * Below about 700px of delivered width the rate, tax and amount columns of an
 * eleven-column bill run together, which is precisely what Rahul's A5 bill
 * showed on paper for the same reason.
 *
 * Erring low costs a shopkeeper nothing — a PDF is a perfectly good bill.
 * Erring high sends something the customer cannot read, which is the failure
 * that matters.
 */
export const MIN_DELIVERED_WIDTH = 700

/**
 * What the customer's phone actually receives, in pixels of width.
 *
 * 🐛 2026-08-16. Rahul: *"you can add 20-25 items in a list and because of it
 * it will be so small that the printed image will be hard to read."*
 *
 * He is right, and the mechanism is worse than "small". The bill is rendered
 * 1080px wide and grows DOWNWARDS with each item. WhatsApp caps the LONGEST
 * side — which on a bill is the height — so a long bill is squeezed SIDEWAYS.
 * The more items, the narrower the whole document arrives:
 *
 *      5 items →  924px    readable
 *     11 items →  739px    small          ← the bill he sent
 *     25 items →  503px    unreadable
 *     40 items →  376px    unreadable
 *
 * A plain function over two numbers so a test can run it at any length
 * without rendering anything (CLAUDE.md, Cause 7).
 */
export function deliveredWidthPx(contentHeightPx: number, width = IMAGE_WIDTH): number {
  const longest = Math.max(width, contentHeightPx)
  if (longest <= WHATSAPP_LONGEST_SIDE) return width
  return Math.round(width * (WHATSAPP_LONGEST_SIDE / longest))
}

/**
 * Does this exact bill survive the trip as a picture?
 *
 * Asks the RENDERER how tall it will be rather than counting items, so a bill
 * that is tall for any other reason — a payment QR, a long address — is judged
 * on what it actually is.
 */
export function billSurvivesAsImage(doc: InvoiceDocument): boolean {
  const addressLines = doc.party?.address ? 2 : 0
  const hasQr = doc.due > 0 && !!(doc.shop.upiId || doc.shop.paymentQrUrl)
  const height = measureHeight(doc.items.length, hasQr, addressLines)
  return deliveredWidthPx(height) >= MIN_DELIVERED_WIDTH
}

export interface FormatChoice {
  format: SendFormat
  /** Shown to the shopkeeper so the choice never looks arbitrary. */
  reason: string
  /** True when the shop's own preference decided it, not the length rule. */
  fromPreference: boolean
}

export function chooseSendFormat(
  doc: InvoiceDocument,
  preference: SendFormatPreference = 'smart',
): FormatChoice {
  if (preference === 'image') {
    return { format: 'image', reason: 'Sending as a picture, as you set', fromPreference: true }
  }
  if (preference === 'pdf') {
    return { format: 'pdf', reason: 'Sending as a PDF, as you set', fromPreference: true }
  }

  /*
   * 🐛 2026-08-16 — this counted ITEMS. Rahul asked the right question:
   * "if it's just one page then it should go into image unless i choose pdf."
   *
   * A count cannot answer that. His eleven-item bill fits one A4 page with
   * room to spare and was being sent as a PDF; a four-item bill with a QR, a
   * two-line address and bank details is TALLER and was being called safe.
   * The count was measuring the wrong thing, and it was a second opinion about
   * a height the renderer already knew.
   */
  if (!billSurvivesAsImage(doc)) {
    const count = doc.items.length
    return {
      format: 'pdf',
      // Named plainly. A reason a shopkeeper can act on; a silent switch
      // between formats reads as the app being unpredictable.
      reason: `${count} items — sending as a PDF so it stays readable`,
      fromPreference: false,
    }
  }
  return { format: 'image', reason: 'Sending as a picture — opens straight in the chat', fromPreference: false }
}

/**
 * The one line that rides along with the file.
 *
 * For the business card the answer was no caption: it repeated what the picture
 * said. A bill is different — in a chat LIST the image is a thumbnail, and the
 * shop name with the amount is what makes someone open it. Rahul agreed to a
 * short one.
 *
 * Deliberately short. The bill carries the detail; this is a subject line, and
 * a paragraph beside a picture is what he objected to on the card.
 */
export function buildCaption(doc: InvoiceDocument): string {
  const amount = (n: number) =>
    `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`

  const bits = [doc.shop.name]
  if (doc.invoiceNo && doc.invoiceNo !== '—') bits.push(`Bill ${doc.invoiceNo}`)
  bits.push(doc.due > 0 ? `${amount(doc.due)} due` : `${amount(doc.total)} — paid`)
  return bits.join(' · ')
}

/** Filename for whichever format was chosen. */
export function documentFileName(doc: InvoiceDocument, format: SendFormat): string {
  const no = doc.invoiceNo.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `invoice-${no || 'bill'}.${format === 'image' ? 'jpg' : 'pdf'}`
}
