/**
 * Sending a bill: build it, pick the format, hand it to the share sheet.
 *
 * 🎨 2026-08-05, Phase 3 of docs/DOCUMENT-ENGINE-PLAN.md.
 *
 * One entry point, because there were three before this: a Download that made a
 * PDF, a WhatsApp share that made the SAME PDF again with different filename
 * logic, and a print. Each carried its own copy of the Capacitor branch, its own
 * FileReader, and its own idea of what to call the file. Three copies of a
 * native-share path is three places for the bug that made the business card
 * share silently do nothing on a phone.
 */

import { buildInvoiceDocument, type InvoiceShop, type InvoiceSource } from './invoice-document'
import { renderInvoiceImage } from './invoice-share-image'
import { generateInvoicePDF } from './invoice-pdf'
import {
  chooseSendFormat,
  buildCaption,
  documentFileName,
  type SendFormat,
  type SendFormatPreference,
} from './document-delivery'
import { shareCardImage } from './share-file'
import { dataUrlBase64 } from './card-canvas'

export interface SendBillResult {
  format: SendFormat
  reason: string
  /** The public link, when the shop has them switched on. */
  link?: string | null
  /**
   * Set when money is owed but the shop has no UPI id, so the bill went out
   * with no way to pay it.
   *
   * 🐛 2026-08-06. Rahul asked why there was no Pay button on his bill links.
   * There was nothing wrong with the button — his shop had no UPI id, and
   * `buildUpiLink` correctly returns null rather than opening a UPI app that
   * then fails. But failing SILENTLY meant the customer saw money owed with no
   * way to act and he had no idea why. The app should say so.
   */
  missingUpiId?: boolean
}

/**
 * Mints (or reuses) the shareable link for a bill.
 *
 * Returns null on ANY failure. A link is an enhancement to the message; a bill
 * that will not send because the link server was slow is a worse outcome than a
 * bill sent without one.
 */
async function mintLink(transactionId: string): Promise<string | null> {
  try {
    const r = await fetch('/api/bill-share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId }),
    })
    if (!r.ok) return null
    const data = await r.json()
    if (!data?.token) return null
    return `${window.location.origin}/b/${data.token}`
  } catch {
    return null
  }
}

/**
 * Renders the QR the invoice image carries, as a decoded image.
 *
 * Encoded here rather than lifted out of the DOM: the bill can be sent from a
 * list, where no QR is on screen to borrow. `qrcode.react` is already a
 * dependency and its SVG output has no external references, so it decodes as an
 * image without a network round trip.
 */
async function renderQr(value: string, size = 440): Promise<HTMLImageElement | null> {
  try {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { QRCodeSVG } = await import('qrcode.react')
    const { createElement } = await import('react')
    const svg = renderToStaticMarkup(
      createElement(QRCodeSVG, { value, size, level: 'M', bgColor: '#FFFFFF', fgColor: '#111111' }),
    )
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      // A missing QR costs the bill its pay button, never the bill itself.
      img.onerror = () => resolve(null)
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
  } catch {
    return null
  }
}

/** The shop logo, decoded, or null. */
async function loadLogo(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return null
  return await new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Builds the bill and opens the share sheet.
 *
 * Returns which format went, so the caller can tell the shopkeeper — a silent
 * switch between a picture and a PDF reads as the app being unpredictable.
 */
export async function sendBill(
  src: InvoiceSource,
  shop: InvoiceShop,
  opts: {
    preference?: SendFormatPreference
    override?: SendFormat
    /** Setting.docShareLink. Off by default; see the schema note. */
    shareLink?: boolean
    /** The bill's id, needed to mint a link. */
    transactionId?: string
    /** The shop's invoice look. See lib/invoice-themes. */
    themeId?: string | null
  } = {},
): Promise<SendBillResult> {
  const doc = buildInvoiceDocument(src, shop)
  const chosen = opts.override
    ? { format: opts.override, reason: '', fromPreference: true }
    : chooseSendFormat(doc, opts.preference ?? 'smart')

  const filename = documentFileName(doc, chosen.format)

  /*
   * The link, when the shop has it on.
   *
   * It also fixes something a caption alone could not. ANDROID DOES NOT ALLOW A
   * FILE AND TEXT IN ONE SHARE — the platform's own guidance is that supplying
   * both EXTRA_TEXT and EXTRA_STREAM is not allowed, and WhatsApp honours the
   * text for images but drops it for documents. That is why Rahul saw a caption
   * on a picture and none on a PDF; it is not a bug in our code and cannot be
   * fixed in it. A LINK is text, so a bill sent as a link carries its caption.
   */
  const link =
    opts.shareLink && opts.transactionId ? await mintLink(opts.transactionId) : null

  const caption = link ? `${buildCaption(doc)}
${link}` : buildCaption(doc)

  // Money owed, but nowhere for it to go.
  const missingUpiId = doc.due > 0 && !shop.upiId

  if (chosen.format === 'image') {
    const [qrImage, logoImage] = await Promise.all([
      doc.upiLink ? renderQr(doc.upiLink) : Promise.resolve(null),
      loadLogo(shop.logoUrl),
    ])
    const dataUrl = renderInvoiceImage(doc, { qrImage, logoImage, themeId: opts.themeId })
    await shareCardImage(dataUrl, filename, {
      title: `Bill ${doc.invoiceNo}`,
      // A SHORT caption, unlike the business card which carries none. In a chat
      // list the image is only a thumbnail, and the shop name with the amount
      // is what makes someone open it. Rahul agreed to one line, not a
      // paragraph — the detail belongs on the bill.
      text: caption,
      dialogTitle: 'Send bill',
    })
    return { format: 'image', reason: chosen.reason, link, missingUpiId }
  }

  // The link goes ON the PDF, because Android will not carry it beside one.
  /*
   * 📄 2026-08-15: the SAME `doc` built at the top of this function.
   *
   * This line used to pass the raw `src` with two `as never` casts, which
   * silenced the type system precisely where it was trying to say that the
   * PDF was being handed something different from every other surface. The
   * document was already built eight lines above and thrown away here.
   *
   * `themeId` was passed to the image renderer on the line above and not to
   * this one — the whole of the PDF theme bug, visible in one function.
   */
  const pdfBlob = await generateInvoicePDF(doc, { themeId: opts.themeId, shareLink: link })
  const dataUrl = await blobToDataUrl(pdfBlob)
  await shareCardImage(dataUrl, filename, {
    title: `Bill ${doc.invoiceNo}`,
    text: caption,
    dialogTitle: 'Send bill',
  })
  return { format: 'pdf', reason: chosen.reason, link, missingUpiId }
}

/**
 * jsPDF hands back a Blob, and the native share path wants base64.
 *
 * The image renderer avoids this by producing a data URL directly; the PDF
 * library gives no such option, so this is the one place the conversion still
 * happens.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the generated bill.'))
    reader.readAsDataURL(blob)
  })
}

/** Exported for tests: proves the base64 handed to Filesystem is the file. */
export const __internal = { blobToDataUrl, dataUrlBase64 }
