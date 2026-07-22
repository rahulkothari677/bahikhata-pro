/**
 * PDF Primitives — reusable building blocks for all PDF generators.
 *
 * V26 Phase 8 PDF Redesign: Shared functions that both the invoice and
 * statement PDFs use. This prevents the two-exporters-drift bug (R9-1)
 * from recurring — both documents share the same brand band, footer,
 * and QR block implementations.
 */

import { THEME, formatPDFMoney } from './theme'

/**
 * Draw the brand band — full-width colored header with shop info.
 */
export function drawBrandBand(
  doc: any,
  opts: {
    shopName: string
    address?: string
    phone?: string
    gstin?: string
    title: string // "INVOICE" or "ACCOUNT STATEMENT"
    subtitle?: string // invoice number + date, or statement period
  }
): number {
  const { margin, pageWidth, brand, white } = THEME
  const bandHeight = 32

  // Filled brand-color band
  doc.setFillColor(brand.r, brand.g, brand.b)
  doc.rect(0, 0, pageWidth, bandHeight, 'F')

  // Shop name (white, bold, 20pt)
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(white.r, white.g, white.b)
  doc.text(opts.shopName || 'My Shop', margin, 12)

  // Shop details (white, 8pt)
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  let detailY = 17
  let detailLine = ''
  if (opts.phone) detailLine += 'Phone: ' + opts.phone
  if (opts.gstin) detailLine += (detailLine ? '  |  ' : '') + 'GSTIN: ' + opts.gstin
  if (detailLine) {
    doc.text(detailLine, margin, detailY)
    detailY += 4
  }
  if (opts.address) {
    const truncated = opts.address.length > 70 ? opts.address.slice(0, 67) + '...' : opts.address
    doc.text(truncated, margin, detailY)
  }

  // Title (right side, white, 14pt, letter-spaced)
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(14)
  doc.text(opts.title, pageWidth - margin, 12, { align: 'right' })

  // Subtitle (right side, white, 9pt)
  if (opts.subtitle) {
    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(9)
    doc.text(opts.subtitle, pageWidth - margin, 18, { align: 'right' })
  }

  // Reset color
  doc.setTextColor(THEME.text.r, THEME.text.g, THEME.text.b)
  return bandHeight + 6 // return Y position after the band
}

/**
 * Draw a status pill — PAID / PARTIAL / DUE.
 */
export function drawStatusPill(
  doc: any,
  x: number,
  y: number,
  status: 'paid' | 'partial' | 'due'
): void {
  const labels = { paid: 'PAID', partial: 'PARTIAL', due: 'DUE' }
  const colors = { paid: THEME.paid, partial: THEME.partial, due: THEME.due }
  const color = colors[status]
  const label = labels[status]
  const pillWidth = 25
  const pillHeight = 7

  doc.setFillColor(color.r, color.g, color.b)
  doc.roundedRect(x, y, pillWidth, pillHeight, 2, 2, 'F')

  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(9)
  doc.setTextColor(THEME.white.r, THEME.white.g, THEME.white.b)
  doc.text(label, x + pillWidth / 2, y + 5, { align: 'center' })
  doc.setTextColor(THEME.text.r, THEME.text.g, THEME.text.b)
}

/**
 * Draw the footer on every page.
 * V26 Phase 8: Removed "Terms" line (user requested removal). Increased font
 * size from 7pt to 9pt for visibility. Made "Made with EkBook" bold + brand color.
 */
export function drawFooter(doc: any, pageNum?: number, totalPages?: number): void {
  const { margin, pageWidth, pageHeight, brand, textMuted } = THEME
  const y = pageHeight - 15

  // Thin brand rule
  doc.setDrawColor(brand.r, brand.g, brand.b)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)

  // Footer text — larger for visibility
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)

  if (pageNum && totalPages) {
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, y + 6, { align: 'center' })
  }

  doc.setFont(THEME.font, 'bold')
  doc.setTextColor(brand.r, brand.g, brand.b)
  doc.text('Made with EkBook', pageWidth - margin, y + 6, { align: 'right' })

  doc.setTextColor(THEME.text.r, THEME.text.g, THEME.text.b)
}

/**
 * Draw a UPI QR code block for "Scan to pay".
 * Only renders when upiId is provided and amount > 0.
 */
export async function drawUPIQRBlock(
  doc: any,
  x: number,
  y: number,
  opts: {
    upiId: string
    shopName: string
    amount: number
    note?: string
  }
): Promise<number> {
  if (!opts.upiId || opts.amount <= 0) return y

  try {
    const QRCode = (await import('qrcode')).default
    const upiLink = `upi://pay?pa=${encodeURIComponent(opts.upiId)}&pn=${encodeURIComponent(opts.shopName)}&am=${opts.amount.toFixed(2)}&tn=${encodeURIComponent(opts.note || 'Payment')}&cu=INR`
    const qrDataUrl = await QRCode.toDataURL(upiLink, { margin: 0, width: 256 })

    // QR code (28x28 mm)
    doc.addImage(qrDataUrl, 'PNG', x, y, 28, 28)

    // Caption below QR
    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(9)
    doc.setTextColor(THEME.text.r, THEME.text.g, THEME.text.b)
    doc.text(`Scan to pay ${formatPDFMoney(opts.amount)}`, x + 14, y + 32, { align: 'center' })

    // UPI ID below caption
    doc.setFont(THEME.font, 'normal')
    doc.setFontSize(7)
    doc.setTextColor(THEME.textMuted.r, THEME.textMuted.g, THEME.textMuted.b)
    doc.text(opts.upiId, x + 14, y + 36, { align: 'center' })

    return y + 38 // return Y after the block
  } catch (err) {
    console.warn('[pdf] QR generation failed:', err)
    return y
  }
}

/**
 * Check if we need a new page, and add one if needed.
 * Returns the new Y position (top of new page).
 */
export function newPageIfNeeded(doc: any, y: number, needed: number, drawHeaderRow?: () => void): number {
  if (y + needed > THEME.pageHeight - 25) {
    doc.addPage()
    if (drawHeaderRow) drawHeaderRow()
    return 25
  }
  return y
}
