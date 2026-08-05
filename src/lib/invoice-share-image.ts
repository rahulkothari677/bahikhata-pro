/**
 * The invoice as an image, built for a WhatsApp chat.
 *
 * 🎨 2026-08-05, Phase 2 of docs/INVOICE-PDF-PLAN.md. Rahul: "the main idea is
 * not providing them the bill but to share those bill to whatsapp."
 *
 * WHY AN IMAGE AND NOT THE PDF WE ALREADY HAVE. In WhatsApp a PDF arrives as a
 * grey document card with a filename on it. To read it the customer must tap,
 * wait for a viewer, and then pinch around an A4 page on a six-inch screen —
 * three decisions before they see what they owe. An image appears inline,
 * already readable, and is seen whether or not anyone decides to look. For a
 * shopkeeper whose goal is that the customer reads the bill and pays it, that
 * is the entire feature. Every competitor sends the PDF.
 *
 * WHY IT IS NOT JUST A NARROW A4. A4 is 1:1.41 and designed for arm's length.
 * A chat thumbnail is small and read on a phone, so this is a taller, simpler
 * document: one column instead of five, type that survives being previewed at
 * thumbnail size, and the amount due as the largest thing on it. It carries the
 * same Rule 46 fields as the PDF — a shared bill that omits them is not a tax
 * invoice — but arranges them for the screen it will actually be read on.
 *
 * Drawn on a canvas from the same `InvoiceDocument` the PDF uses, so the two
 * cannot disagree about the total. Same reasoning as the business card, where a
 * second renderer drifted and the export truncated an address the screen showed
 * in full.
 */

import type { InvoiceDocument, InvoiceDocumentItem } from './invoice-document'

/**
 * 1080px wide — the size WhatsApp keeps. It re-encodes anything larger, so a
 * bigger canvas buys nothing but upload time on a 3G connection.
 */
const W = 1080
const PAD = 48

/** Ink, chosen for readability at thumbnail size rather than for decoration. */
const INK = {
  bg: '#FFFFFF',
  head: '#0F172A',
  headText: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  line: '#E5E7EB',
  zebra: '#F9FAFB',
  accent: '#C2410C',
  due: '#B91C1C',
  paid: '#15803D',
  partial: '#B45309',
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function font(ctx: CanvasRenderingContext2D, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`
}

/** Truncates to fit, with an ellipsis. */
function clip(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s}…`
}

/** Wraps into at most `maxLines`; the last is ellipsised. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > max && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines) break
    } else line = next
  }
  if (lines.length < maxLines && line) lines.push(clip(ctx, line, max))
  return lines.slice(0, maxLines)
}

/**
 * Height is computed BEFORE drawing.
 *
 * A canvas cannot be resized without clearing it, so the layout is measured
 * first and drawn second. It also means a 3-item bill is not padded out to the
 * height of a 30-item one — in a chat, a bill the length of its contents reads
 * as deliberate.
 */
function measureHeight(itemCount: number, hasQr: boolean, addressLines: number): number {
  const header = 210
  const meta = 150
  const party = 90 + addressLines * 34
  const tableHead = 56
  const rows = itemCount * 78
  const totals = 250
  const dueBlock = 190
  const qr = hasQr ? 300 : 0
  const words = 84
  const footer = 150
  return header + meta + party + tableHead + rows + totals + dueBlock + qr + words + footer
}

export interface InvoiceImageOptions {
  /** A decoded QR for the UPI link. The caller owns QR encoding. */
  qrImage?: HTMLImageElement | null
  /** The shop's logo, already decoded. */
  logoImage?: HTMLImageElement | null
}

/**
 * Renders the invoice and returns a JPEG data URL.
 *
 * A data URL rather than a Blob for the same reason the card does it: the
 * native share path writes base64 to the filesystem, so producing base64
 * directly skips a Blob and a FileReader round trip.
 */
export function renderInvoiceImage(doc: InvoiceDocument, opts: InvoiceImageOptions = {}): string {
  const addressLines = doc.party?.address ? 2 : 0
  const H = measureHeight(doc.items.length, Boolean(opts.qrImage), addressLines)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not create a canvas to draw the bill.')

  ctx.fillStyle = INK.bg
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  let y = 0

  // ── header band: who is billing ──────────────────────────────────────
  const headH = 210
  ctx.fillStyle = INK.head
  ctx.fillRect(0, 0, W, headH)

  let textLeft = PAD
  if (opts.logoImage) {
    const box = 96
    const s = Math.min(box / opts.logoImage.width, box / opts.logoImage.height)
    const lw = opts.logoImage.width * s
    const lh = opts.logoImage.height * s
    // On a white plate: a logo designed for white paper disappears on the dark
    // band, and we cannot know which way round any given shop's logo works.
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(PAD - 8, 46 - 8, box + 16, box + 16)
    ctx.drawImage(opts.logoImage, PAD + (box - lw) / 2, 46 + (box - lh) / 2, lw, lh)
    textLeft = PAD + box + 28
  }

  ctx.fillStyle = INK.headText
  font(ctx, 46, 700)
  ctx.textAlign = 'left'
  ctx.fillText(clip(ctx, doc.shop.name, W - textLeft - PAD), textLeft, 92)

  font(ctx, 26, 400)
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  const shopBits = [doc.shop.phone, doc.shop.gstin ? `GSTIN ${doc.shop.gstin}` : null]
    .filter(Boolean)
    .join('   ·   ')
  if (shopBits) ctx.fillText(clip(ctx, shopBits, W - textLeft - PAD), textLeft, 132)
  if (doc.shop.address) {
    ctx.fillStyle = 'rgba(255,255,255,0.62)'
    font(ctx, 24, 400)
    ctx.fillText(clip(ctx, doc.shop.address, W - textLeft - PAD), textLeft, 168)
  }

  y = headH + 44

  // ── title, number, date, status ──────────────────────────────────────
  ctx.fillStyle = INK.text
  font(ctx, 34, 700)
  ctx.textAlign = 'left'
  ctx.fillText(doc.title, PAD, y)

  // The status stamp, right-aligned on the same line.
  const stampColour =
    doc.status === 'paid' ? INK.paid : doc.status === 'partial' ? INK.partial : INK.due
  const stampText = doc.status === 'paid' ? 'PAID' : doc.status === 'partial' ? 'PART PAID' : 'DUE'
  font(ctx, 24, 700)
  const stampW = ctx.measureText(stampText).width + 40
  ctx.fillStyle = stampColour
  roundRect(ctx, W - PAD - stampW, y - 30, stampW, 44, 22)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.fillText(stampText, W - PAD - stampW / 2, y + 1)

  ctx.textAlign = 'left'
  ctx.fillStyle = INK.muted
  font(ctx, 26, 400)
  ctx.fillText(`No. ${doc.invoiceNo}    ${doc.dateLabel}`, PAD, y + 44)
  y += 100

  // ── billed to ────────────────────────────────────────────────────────
  if (doc.party) {
    ctx.fillStyle = INK.muted
    font(ctx, 22, 600)
    ctx.fillText('BILLED TO', PAD, y)
    ctx.fillStyle = INK.text
    font(ctx, 32, 600)
    ctx.fillText(clip(ctx, doc.party.name, W - PAD * 2), PAD, y + 40)
    let py = y + 40
    font(ctx, 24, 400)
    ctx.fillStyle = INK.muted
    const partyBits = [doc.party.phone, doc.party.gstin ? `GSTIN ${doc.party.gstin}` : null]
      .filter(Boolean)
      .join('   ·   ')
    if (partyBits) {
      py += 34
      ctx.fillText(clip(ctx, partyBits, W - PAD * 2), PAD, py)
    }
    if (doc.party.address) {
      for (const line of wrap(ctx, doc.party.address, W - PAD * 2, 2)) {
        py += 32
        ctx.fillText(line, PAD, py)
      }
    }
    y = py + 46
  }

  // ── items ────────────────────────────────────────────────────────────
  const colQty = W - PAD - 430
  const colRate = W - PAD - 250
  const colAmt = W - PAD

  ctx.fillStyle = INK.zebra
  ctx.fillRect(PAD, y - 30, W - PAD * 2, 52)
  ctx.fillStyle = INK.muted
  font(ctx, 22, 600)
  ctx.textAlign = 'left'
  ctx.fillText('ITEM', PAD + 16, y)
  ctx.textAlign = 'right'
  ctx.fillText('QTY', colQty, y)
  ctx.fillText('RATE', colRate, y)
  ctx.fillText('AMOUNT', colAmt - 16, y)
  y += 56

  for (const item of doc.items) {
    drawItem(ctx, item, y, colQty, colRate, colAmt, doc.hasTax)
    y += 78
  }

  ctx.strokeStyle = INK.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, y - 24)
  ctx.lineTo(W - PAD, y - 24)
  ctx.stroke()
  y += 20

  // ── totals ───────────────────────────────────────────────────────────
  const totalRow = (label: string, value: string, bold = false, colour = INK.text) => {
    ctx.textAlign = 'left'
    ctx.fillStyle = bold ? INK.text : INK.muted
    font(ctx, bold ? 28 : 26, bold ? 700 : 400)
    ctx.fillText(label, W - PAD - 420, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = colour
    ctx.fillText(value, W - PAD, y)
    y += bold ? 46 : 40
  }

  totalRow('Subtotal', money(doc.subtotal))
  if (doc.discount > 0) totalRow('Discount', `− ${money(doc.discount)}`)
  if (doc.hasTax) {
    // Rule 46 wants the tax shown per head, not as one lump.
    if (doc.igst > 0) totalRow('IGST', money(doc.igst))
    else {
      if (doc.cgst > 0) totalRow('CGST', money(doc.cgst))
      if (doc.sgst > 0) totalRow('SGST', money(doc.sgst))
    }
  }
  if (doc.roundOff !== 0) totalRow('Round off', money(doc.roundOff))
  totalRow('Total', money(doc.total), true)
  if (doc.paid > 0) totalRow('Paid', money(doc.paid), false, INK.paid)

  y += 16

  // ── the amount due: the largest thing on the bill ────────────────────
  // This is what the customer opened the message to find out, and in a chat
  // thumbnail it may be the only thing they can read.
  const dueH = 150
  ctx.fillStyle = doc.due > 0 ? '#FEF2F2' : '#F0FDF4'
  roundRect(ctx, PAD, y, W - PAD * 2, dueH, 20)
  ctx.fill()
  ctx.strokeStyle = doc.due > 0 ? '#FECACA' : '#BBF7D0'
  ctx.lineWidth = 2
  roundRect(ctx, PAD, y, W - PAD * 2, dueH, 20)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = INK.muted
  font(ctx, 26, 600)
  ctx.fillText(doc.due > 0 ? 'AMOUNT DUE' : 'FULLY PAID', PAD + 32, y + 56)
  ctx.fillStyle = doc.due > 0 ? INK.due : INK.paid
  font(ctx, 62, 700)
  ctx.fillText(money(doc.due > 0 ? doc.due : doc.total), PAD + 32, y + 118)
  y += dueH + 40

  // ── amount in words ──────────────────────────────────────────────────
  ctx.fillStyle = INK.muted
  font(ctx, 24, 400)
  ctx.textAlign = 'left'
  // No "Rupees" prefix — `amountToWords` already ends every amount in
  // "… Rupees and … Paise Only", and prefixing produced "Rupees Eight Thousand
  // Sixty-Two Rupees and Twenty Paise Only" on the first render.
  for (const line of wrap(ctx, doc.totalInWords, W - PAD * 2, 2)) {
    ctx.fillText(line, PAD, y)
    y += 32
  }
  y += 24

  // ── pay by UPI ───────────────────────────────────────────────────────
  if (opts.qrImage) {
    const box = 220
    ctx.drawImage(opts.qrImage, PAD, y, box, box)
    ctx.fillStyle = INK.text
    font(ctx, 30, 700)
    ctx.textAlign = 'left'
    ctx.fillText('Scan to pay', PAD + box + 32, y + 58)
    ctx.fillStyle = INK.muted
    font(ctx, 24, 400)
    ctx.fillText('Any UPI app — GPay, PhonePe, Paytm', PAD + box + 32, y + 100)
    if (doc.shop.upiId) {
      ctx.fillText(clip(ctx, doc.shop.upiId, W - PAD - box - 64), PAD + box + 32, y + 140)
    }
    y += box + 40
  }

  // ── footer ───────────────────────────────────────────────────────────
  ctx.strokeStyle = INK.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, y)
  ctx.lineTo(W - PAD, y)
  ctx.stroke()
  y += 44

  ctx.fillStyle = INK.muted
  font(ctx, 22, 400)
  ctx.textAlign = 'left'
  if (doc.placeOfSupply) {
    // Rule 46 requires it whenever the buyer is registered or the supply is
    // inter-state; leaving it off a shared bill makes it not a tax invoice.
    ctx.fillText(`Place of supply: ${doc.placeOfSupply}`, PAD, y)
  }
  ctx.textAlign = 'right'
  ctx.fillText(`Payment: ${doc.paymentMode}`, W - PAD, y)

  return canvas.toDataURL('image/jpeg', 0.92)
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  item: InvoiceDocumentItem,
  y: number,
  colQty: number,
  colRate: number,
  colAmt: number,
  hasTax: boolean,
) {
  ctx.textAlign = 'left'
  ctx.fillStyle = INK.text
  font(ctx, 28, 500)
  ctx.fillText(clip(ctx, item.name, colQty - PAD - 40), PAD + 16, y)

  // HSN and the GST rate go UNDER the name rather than in columns of their
  // own — five columns at this width leaves nothing legible for the name,
  // which is the field a customer actually checks.
  const sub = [item.hsn ? `HSN ${item.hsn}` : null, hasTax ? `GST ${item.gstRate}%` : null]
    .filter(Boolean)
    .join('   ·   ')
  if (sub) {
    ctx.fillStyle = INK.muted
    font(ctx, 21, 400)
    ctx.fillText(sub, PAD + 16, y + 30)
  }

  ctx.textAlign = 'right'
  ctx.fillStyle = INK.text
  font(ctx, 26, 400)
  ctx.fillText(item.qty, colQty, y)
  ctx.fillText(money(item.rate), colRate, y)
  font(ctx, 27, 600)
  ctx.fillText(money(item.total), colAmt - 16, y)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Filename for the shared bill. */
export function invoiceImageFileName(doc: InvoiceDocument): string {
  const no = doc.invoiceNo.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `invoice-${no || 'bill'}.jpg`
}
