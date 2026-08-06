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
  opts: { preference?: SendFormatPreference; override?: SendFormat } = {},
): Promise<SendBillResult> {
  const doc = buildInvoiceDocument(src, shop)
  const chosen = opts.override
    ? { format: opts.override, reason: '', fromPreference: true }
    : chooseSendFormat(doc, opts.preference ?? 'smart')

  const filename = documentFileName(doc, chosen.format)
  const caption = buildCaption(doc)

  if (chosen.format === 'image') {
    const [qrImage, logoImage] = await Promise.all([
      doc.upiLink ? renderQr(doc.upiLink) : Promise.resolve(null),
      loadLogo(shop.logoUrl),
    ])
    const dataUrl = renderInvoiceImage(doc, { qrImage, logoImage })
    await shareCardImage(dataUrl, filename, {
      title: `Bill ${doc.invoiceNo}`,
      // A SHORT caption, unlike the business card which carries none. In a chat
      // list the image is only a thumbnail, and the shop name with the amount
      // is what makes someone open it. Rahul agreed to one line, not a
      // paragraph — the detail belongs on the bill.
      text: caption,
      dialogTitle: 'Send bill',
    })
    return { format: 'image', reason: chosen.reason }
  }

  const pdfBlob = await generateInvoicePDF(src as never, shop as never)
  const dataUrl = await blobToDataUrl(pdfBlob)
  await shareCardImage(dataUrl, filename, {
    title: `Bill ${doc.invoiceNo}`,
    text: caption,
    dialogTitle: 'Send bill',
  })
  return { format: 'pdf', reason: chosen.reason }
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
