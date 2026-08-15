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

/*
 * 🗑️ 2026-08-15 — THE SHAREABLE BILL LINK IS GONE.
 *
 * Rahul: "remove the link which we can share with the bill in pdf … sharing
 * link or directly paying option sometimes cause fear in the mind of general
 * public."
 *
 * That is a product judgement about Indian customers receiving a bill on
 * WhatsApp, and he is the one who knows them. A shopkeeper's customer who
 * gets an unfamiliar link asking them to pay has every reason to treat it as
 * a scam — the same instinct the whole country has been taught. The bill is
 * now a picture or a PDF and nothing else: nothing to tap, nowhere to go.
 *
 * Payment stays, as a QR the customer SCANS — either generated from the
 * shop's UPI id or an image of their own QR. Scanning a code sitting on a
 * bill you already trust is a different act from following a link.
 *
 * `mintLink`, /api/bill-share, /b/[token] and lib/bill-share are deleted. The
 * BillShare TABLE is deliberately kept, with its rows: links already minted
 * are the shop's own records, and this codebase does not delete a user's data
 * to tidy up a feature. Old links simply 404 now.
 */

export interface SendBillResult {
  format: SendFormat
  reason: string
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
    /** The shop's invoice look. See lib/invoice-themes. */
    themeId?: string | null
    /*
     * 📄 2026-08-15: the layout and the sheet, carried through to what the
     * customer actually receives. Passing only themeId is exactly how the PDF
     * came to ignore the shop's chosen design — the picture got the setting
     * and the file did not.
     */
    templateId?: string | null
    paperId?: string | null
  } = {},
): Promise<SendBillResult> {
  const doc = buildInvoiceDocument(src, shop)
  const chosen = opts.override
    ? { format: opts.override, reason: '', fromPreference: true }
    : chooseSendFormat(doc, opts.preference ?? 'smart')

  const filename = documentFileName(doc, chosen.format)

  /*
   * A caption, and nothing else in it.
   *
   * Worth keeping the old note here, because it explains a limit that is still
   * true: ANDROID DOES NOT ALLOW A FILE AND TEXT IN ONE SHARE — supplying both
   * EXTRA_TEXT and EXTRA_STREAM is not allowed, and WhatsApp honours the text
   * for images but drops it for documents. So a PDF still reaches the customer
   * without its caption. That used to be the argument for putting a link on
   * the PDF itself; with the link gone, the answer is that everything the
   * customer needs is ON the bill, which is where it should have been.
   */
  const caption = buildCaption(doc)

  // Money owed, but nowhere for it to go.
  const missingUpiId = doc.due > 0 && !shop.upiId

  if (chosen.format === 'image') {
    /*
     * The shop's uploaded QR wins over the generated one — the SAME order the
     * PDF uses. If these two disagreed, the picture and the file would show
     * the customer different ways to pay, which is the invoiceTheme bug again
     * with money attached.
     */
    const [qrImage, logoImage] = await Promise.all([
      shop.paymentQrUrl
        ? loadLogo(shop.paymentQrUrl)
        : doc.upiLink ? renderQr(doc.upiLink) : Promise.resolve(null),
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
    return { format: 'image', reason: chosen.reason, missingUpiId }
  }

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
  const pdfBlob = await generateInvoicePDF(doc, { themeId: opts.themeId, templateId: opts.templateId, paperId: opts.paperId })
  const dataUrl = await blobToDataUrl(pdfBlob)
  await shareCardImage(dataUrl, filename, {
    title: `Bill ${doc.invoiceNo}`,
    text: caption,
    dialogTitle: 'Send bill',
  })
  return { format: 'pdf', reason: chosen.reason, missingUpiId }
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
