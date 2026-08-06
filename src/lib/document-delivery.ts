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

export type SendFormat = 'image' | 'pdf'
/** What the shop has chosen. 'smart' lets the bill decide. */
export type SendFormatPreference = 'smart' | SendFormat

/**
 * The most items that still read after WhatsApp's compression.
 *
 * Eight, measured rather than picked: a nine-item bill lands under 780px wide
 * once WhatsApp is done with it, which is where the HSN line under each item
 * stops being legible on a phone. Erring low costs a shopkeeper nothing — the
 * PDF is a perfectly good bill — while erring high sends something the customer
 * cannot read, which is the failure that matters.
 */
export const IMAGE_ITEM_LIMIT = 8

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

  const count = doc.items.length
  if (count > IMAGE_ITEM_LIMIT) {
    return {
      format: 'pdf',
      // Named plainly. "Long bill" is a reason a shopkeeper can act on; a
      // silent switch between formats reads as the app being unpredictable.
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
