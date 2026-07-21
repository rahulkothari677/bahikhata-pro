/**
 * generateInvoicePDF — creates a professional, branded PDF invoice using jsPDF.
 *
 * V26 Phase 8 PDF Redesign: Complete rewrite with:
 * - Brand band (shop's theme color, white text)
 * - Status pill (PAID / PARTIAL / DUE)
 * - Bill To card with GSTIN
 * - Zebra-striped item table with HSN column
 * - Totals box with grand total in brand color
 * - Amount in words (Indian convention)
 * - UPI QR code "Scan to pay" block
 * - Signature block + branded footer
 * - Unicode font (DejaVu Sans) for rupee symbol support
 *
 * Returns a Blob that can be shared via WhatsApp or downloaded.
 */

import { registerUnicodeFont, THEME, formatPDFMoney } from './pdf/theme'
import { drawBrandBand, drawStatusPill, drawFooter, drawUPIQRBlock, newPageIfNeeded } from './pdf/primitives'
import { amountToWords } from './amount-to-words'

interface InvoiceItem {
  productName: string
  quantity: number
  unitPrice: number
  gstRate: number
  total: number
  unit?: string
  hsn?: string | null
}

interface InvoiceData {
  invoiceNo: string | null
  date: string | Date
  party?: {
    name: string
    phone?: string
    gstin?: string | null
    address?: string | null
    state?: string | null
  } | null
  items: InvoiceItem[]
  subtotal: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  totalAmount: number
  roundOff?: number
  paidAmount: number
  paymentMode: string
  isInterState?: boolean
}

interface ShopSetting {
  shopName: string
  ownerName?: string
  phone?: string
  email?: string
  gstin?: string
  address?: string
  state?: string
  upiId?: string
}

function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return String(date)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function generateInvoicePDF(txn: InvoiceData, setting: ShopSetting): Promise<Blob> {
  const jsPDFMod: any = await import('jspdf')
  const doc = new jsPDFMod.jsPDF({ unit: 'mm', format: 'a4' })

  // Register Unicode font (DejaVu Sans — supports rupee sign)
  // MUST be called before any text is drawn.
  await registerUnicodeFont(doc)

  const { margin, pageWidth, pageHeight, brand, brandLight, text, textMuted, border, zebra, cardBg, white } = THEME
  const dateStr = formatDate(txn.date)

  // === 1. BRAND BAND ===
  let y = drawBrandBand(doc, {
    shopName: setting.shopName || 'My Shop',
    address: setting.address,
    phone: setting.phone,
    gstin: setting.gstin,
    title: 'INVOICE',
    subtitle: `${txn.invoiceNo || ''}  |  ${dateStr}`,
  })

  // === 2. STATUS PILL (top-right, below band) ===
  const due = txn.totalAmount - txn.paidAmount
  const status: 'paid' | 'partial' | 'due' = due <= 0 ? 'paid' : txn.paidAmount > 0 ? 'partial' : 'due'
  drawStatusPill(doc, pageWidth - margin - 25, y, status)

  // === 3. BILL TO CARD ===
  const cardX = margin
  const cardWidth = pageWidth - 2 * margin
  const cardHeight = 25

  doc.setFillColor(cardBg.r, cardBg.g, cardBg.b)
  doc.roundedRect(cardX, y + 2, cardWidth, cardHeight, 2, 2, 'F')
  doc.setDrawColor(border.r, border.g, border.b)
  doc.setLineWidth(0.3)
  doc.roundedRect(cardX, y + 2, cardWidth, cardHeight, 2, 2, 'S')

  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(7)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  doc.text('BILL TO', cardX + 4, y + 8)

  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(text.r, text.g, text.b)
  doc.text(txn.party?.name || 'Walk-in Customer', cardX + 4, y + 14)

  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  const billDetails: string[] = []
  if (txn.party?.phone) billDetails.push('Phone: ' + txn.party.phone)
  if (txn.party?.gstin) billDetails.push('GSTIN: ' + txn.party.gstin)
  if (billDetails.length > 0) {
    doc.text(billDetails.join('  |  '), cardX + 4, y + 18)
  }

  y += cardHeight + 8

  // === 4. ITEM TABLE ===
  const colWidths = {
    idx: 8,
    item: 55,
    hsn: 22,
    qty: 20,
    rate: 25,
    gst: 18,
    amount: 0,
  }
  const colX = {
    idx: margin,
    item: margin + colWidths.idx,
    hsn: margin + colWidths.idx + colWidths.item,
    qty: margin + colWidths.idx + colWidths.item + colWidths.hsn,
    rate: margin + colWidths.idx + colWidths.item + colWidths.hsn + colWidths.qty,
    gst: margin + colWidths.idx + colWidths.item + colWidths.hsn + colWidths.qty + colWidths.rate,
    amount: pageWidth - margin,
  }

  const drawTableHeader = () => {
    doc.setFillColor(brandLight.r, brandLight.g, brandLight.b)
    doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F')
    doc.setFont(THEME.font, 'bold')
    doc.setFontSize(8)
    doc.setTextColor(brand.r, brand.g, brand.b)
    doc.text('#', colX.idx + 1, y + 1)
    doc.text('ITEM', colX.item, y + 1)
    doc.text('HSN', colX.hsn, y + 1)
    doc.text('QTY', colX.qty + colWidths.qty - 1, y + 1, { align: 'right' })
    doc.text('RATE', colX.rate + colWidths.rate - 1, y + 1, { align: 'right' })
    doc.text('GST%', colX.gst + colWidths.gst - 1, y + 1, { align: 'right' })
    doc.text('AMOUNT', colX.amount - 1, y + 1, { align: 'right' })
    doc.setTextColor(text.r, text.g, text.b)
    return y + 8
  }

  y = drawTableHeader()

  // Table rows with zebra striping
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)

  txn.items.forEach((item, i) => {
    y = newPageIfNeeded(doc, y, 8, () => {
      y = drawTableHeader()
    })

    // Zebra stripe (even rows)
    if (i % 2 === 1) {
      doc.setFillColor(zebra.r, zebra.g, zebra.b)
      doc.rect(margin, y - 4, pageWidth - 2 * margin, 7, 'F')
    }

    const name = item.productName.length > 30 ? item.productName.slice(0, 27) + '...' : item.productName
    const qty = `${item.quantity} ${item.unit || 'pcs'}`
    const hsn = item.hsn || '-'

    doc.setTextColor(text.r, text.g, text.b)
    doc.text(String(i + 1), colX.idx + 1, y)
    doc.text(name, colX.item, y)
    doc.setFontSize(7)
    doc.text(hsn, colX.hsn, y)
    doc.setFontSize(9)
    doc.text(qty, colX.qty + colWidths.qty - 1, y, { align: 'right' })
    doc.text(item.unitPrice.toFixed(2), colX.rate + colWidths.rate - 1, y, { align: 'right' })
    doc.text(item.gstRate + '%', colX.gst + colWidths.gst - 1, y, { align: 'right' })
    doc.text(item.total.toFixed(2), colX.amount - 1, y, { align: 'right' })
    y += 7
  })

  // === 5. TOTALS BLOCK (right side) ===
  y += 4
  // Make totals block wider to prevent text overflow
  const totalsBlockWidth = 65
  const labelX = pageWidth - margin - totalsBlockWidth
  const valueX = pageWidth - margin - 2

  doc.setFontSize(9)
  doc.setFont(THEME.font, 'normal')
  doc.setTextColor(text.r, text.g, text.b)

  doc.text('Subtotal:', labelX, y)
  doc.text(formatPDFMoney(txn.subtotal), valueX, y, { align: 'right' })
  y += 5

  if (txn.discountAmount > 0) {
    doc.text('Discount:', labelX, y)
    doc.text('- ' + formatPDFMoney(txn.discountAmount), valueX, y, { align: 'right' })
    y += 5
  }

  const taxableValue = txn.subtotal - txn.discountAmount
  doc.setFont(THEME.font, 'bold')
  doc.text('Taxable Value:', labelX, y)
  doc.text(formatPDFMoney(taxableValue), valueX, y, { align: 'right' })
  y += 5
  doc.setFont(THEME.font, 'normal')

  if (txn.cgst > 0) {
    doc.text('CGST:', labelX, y)
    doc.text(formatPDFMoney(txn.cgst), valueX, y, { align: 'right' })
    y += 5
  }
  if (txn.sgst > 0) {
    doc.text('SGST:', labelX, y)
    doc.text(formatPDFMoney(txn.sgst), valueX, y, { align: 'right' })
    y += 5
  }
  if (txn.igst > 0) {
    doc.text('IGST:', labelX, y)
    doc.text(formatPDFMoney(txn.igst), valueX, y, { align: 'right' })
    y += 5
  }
  if (txn.roundOff && Math.abs(txn.roundOff) >= 0.005) {
    doc.text('Round Off:', labelX, y)
    doc.text((txn.roundOff > 0 ? '+ ' : '- ') + formatPDFMoney(Math.abs(txn.roundOff)), valueX, y, { align: 'right' })
    y += 5
  }

  // Grand total in brand-colored box — wider + taller to prevent overflow
  y += 2
  const grandTotalBoxHeight = 12
  doc.setFillColor(brand.r, brand.g, brand.b)
  doc.rect(labelX - 2, y - 4, pageWidth - margin - labelX, grandTotalBoxHeight, 'F')
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(12)
  doc.setTextColor(white.r, white.g, white.b)
  doc.text('GRAND TOTAL', labelX + 2, y + 3)
  doc.text(formatPDFMoney(txn.totalAmount), valueX - 2, y + 3, { align: 'right' })
  y += grandTotalBoxHeight + 2

  // Paid + Balance Due
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(text.r, text.g, text.b)
  doc.text('Paid: ' + formatPDFMoney(txn.paidAmount) + ' (' + txn.paymentMode.toUpperCase() + ')', labelX, y)
  y += 5
  if (due > 0) {
    doc.setFont(THEME.font, 'bold')
    doc.setTextColor(THEME.due.r, THEME.due.g, THEME.due.b)
    doc.text('Balance Due: ' + formatPDFMoney(due), labelX, y)
    doc.setTextColor(text.r, text.g, text.b)
    y += 5
  }

  // === 6. AMOUNT IN WORDS ===
  y += 4
  doc.setFillColor(brandLight.r, brandLight.g, brandLight.b)
  doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F')
  doc.setFont(THEME.font, 'italic')
  doc.setFontSize(9)
  doc.setTextColor(text.r, text.g, text.b)
  const wordsStr = amountToWords(txn.totalAmount)
  // Truncate if too long (amountToWords can produce very long strings for large amounts)
  const wordsLabel = 'Amount in words: ' + wordsStr
  const displayWords = wordsLabel.length > 95 ? wordsLabel.slice(0, 92) + '...' : wordsLabel
  doc.text(displayWords, margin + 2, y + 1)
  y += 10

  // === 7. UPI QR BLOCK (left side, only when upiId exists and balance > 0) ===
  if (setting.upiId && due > 0) {
    y = await drawUPIQRBlock(doc, margin, y, {
      upiId: setting.upiId,
      shopName: setting.shopName || 'My Shop',
      amount: due,
      note: txn.invoiceNo || 'Invoice Payment',
    })
  }

  // === 8. SIGNATURE BLOCK (right side) ===
  const sigX = pageWidth - margin - 50
  const sigY = Math.max(y, pageHeight - 50)
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  doc.text('For ' + (setting.shopName || 'My Shop'), sigX, sigY)
  doc.setDrawColor(border.r, border.g, border.b)
  doc.line(sigX, sigY + 12, sigX + 40, sigY + 12)
  doc.text('Authorised Signatory', sigX, sigY + 16)

  // === 9. FOOTER — improved visibility (no terms, larger text) ===
  const footerY = pageHeight - 15
  doc.setDrawColor(brand.r, brand.g, brand.b)
  doc.setLineWidth(0.5)
  doc.line(margin, footerY, pageWidth - margin, footerY)

  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9) // Was 7 — too small to read
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  doc.text('Page 1 of 1', pageWidth / 2, footerY + 6, { align: 'center' })

  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(9)
  doc.setTextColor(brand.r, brand.g, brand.b)
  doc.text('Made with EkBook', pageWidth - margin, footerY + 6, { align: 'right' })

  doc.setTextColor(text.r, text.g, text.b)

  return doc.output('blob')
}
