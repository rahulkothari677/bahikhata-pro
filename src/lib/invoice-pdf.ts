/**
 * generateInvoicePDF — creates a professional, branded PDF invoice using jsPDF.
 *
 * V26 Phase 8 PDF Redesign v2: Inspired by Razorpay, Stripe, and ClearTax
 * invoice designs. Key improvements over v1:
 * - Compact header (no wasted vertical space)
 * - Two-column layout: Bill To (left) + Invoice meta (right) in one row
 * - Tighter item table with better column proportions
 * - Totals on the right, aligned with the table edge
 * - Amount in words as a subtle strip, not a big box
 * - UPI QR + signature side by side at the bottom
 * - No floating elements — everything is aligned to a grid
 */

import { registerUnicodeFont, THEME, formatPDFMoney } from './pdf/theme'
import { drawFooter, drawUPIQRBlock, newPageIfNeeded } from './pdf/primitives'
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

  await registerUnicodeFont(doc)

  const { margin, pageWidth, pageHeight, brand, brandLight, text, textMuted, border, zebra, cardBg, white, paid, partial, due } = THEME
  const dateStr = formatDate(txn.date)
  const dueAmount = txn.totalAmount - txn.paidAmount
  const status: 'paid' | 'partial' | 'due' = dueAmount <= 0 ? 'paid' : txn.paidAmount > 0 ? 'partial' : 'due'
  const statusLabels = { paid: 'PAID', partial: 'PARTIAL', due: 'DUE' }
  const statusColors = { paid, partial, due }

  // ═══════════════════════════════════════════════════════════════════
  // 1. HEADER — compact brand band (full width, 28mm)
  // ═══════════════════════════════════════════════════════════════════
  const bandHeight = 28
  doc.setFillColor(brand.r, brand.g, brand.b)
  doc.rect(0, 0, pageWidth, bandHeight, 'F')

  // Shop name (white, bold, 18pt)
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(18)
  doc.setTextColor(white.r, white.g, white.b)
  doc.text(setting.shopName || 'My Shop', margin, 12)

  // Shop details (white, 8pt)
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  let detailY = 17
  const shopDetails: string[] = []
  if (setting.phone) shopDetails.push(setting.phone)
  if (setting.gstin) shopDetails.push('GSTIN: ' + setting.gstin)
  if (setting.address) {
    const truncated = setting.address.length > 60 ? setting.address.slice(0, 57) + '...' : setting.address
    shopDetails.push(truncated)
  }
  if (shopDetails.length > 0) {
    doc.text(shopDetails.join('  |  '), margin, detailY)
  }

  // Right side: INVOICE + invoice no + date
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(16)
  doc.text('INVOICE', pageWidth - margin, 11, { align: 'right' })
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.text(`${txn.invoiceNo || ''}  |  ${dateStr}`, pageWidth - margin, 17, { align: 'right' })

  // Status badge (right, below invoice meta)
  const statusColor = statusColors[status]
  const statusLabel = statusLabels[status]
  const badgeW = 22
  const badgeH = 6
  const badgeX = pageWidth - margin - badgeW
  const badgeY = 20
  doc.setFillColor(statusColor.r, statusColor.g, statusColor.b)
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, 'F')
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(8)
  doc.setTextColor(white.r, white.g, white.b)
  doc.text(statusLabel, badgeX + badgeW / 2, badgeY + 4, { align: 'center' })

  doc.setTextColor(text.r, text.g, text.b)
  let y = bandHeight + 8

  // ═══════════════════════════════════════════════════════════════════
  // 2. BILL TO + INVOICE DETAILS — two columns, one row
  // ═══════════════════════════════════════════════════════════════════
  const leftColWidth = 90
  const rightColX = margin + leftColWidth + 10

  // Left: Bill To
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(7)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  doc.text('BILL TO', margin, y)

  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(11)
  doc.setTextColor(text.r, text.g, text.b)
  doc.text(txn.party?.name || 'Walk-in Customer', margin, y + 6)

  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  let billY = y + 11
  if (txn.party?.phone) {
    doc.text(txn.party.phone, margin, billY)
    billY += 4
  }
  if (txn.party?.gstin) {
    doc.text('GSTIN: ' + txn.party.gstin, margin, billY)
    billY += 4
  }
  if (txn.party?.address) {
    const addrLines = doc.splitTextToSize(txn.party.address, leftColWidth)
    doc.text(addrLines.slice(0, 2), margin, billY)
  }

  // Right: Invoice details (only if there's useful info)
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(7)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  doc.text('INVOICE DETAILS', rightColX, y)

  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(text.r, text.g, text.b)
  let detailRightY = y + 6
  doc.text('Invoice No: ' + (txn.invoiceNo || '-'), rightColX, detailRightY)
  detailRightY += 4
  doc.text('Date: ' + dateStr, rightColX, detailRightY)
  detailRightY += 4
  doc.text('Payment: ' + txn.paymentMode.toUpperCase(), rightColX, detailRightY)

  // Use the taller of the two columns
  y = Math.max(billY, detailRightY + 4) + 6

  // ═══════════════════════════════════════════════════════════════════
  // 3. ITEM TABLE — tight, professional
  // ═══════════════════════════════════════════════════════════════════
  const tableWidth = pageWidth - 2 * margin
  const colStart = margin
  // Column proportions (must sum to tableWidth = 180)
  // # | Item | HSN | Qty | Rate | GST% | Amount
  // 8 | 58  | 20  | 18  | 24   | 18   | 34
  const cols = [
    { name: '#', x: colStart + 1, w: 8, align: 'left' },
    { name: 'ITEM', x: colStart + 10, w: 58, align: 'left' },
    { name: 'HSN', x: colStart + 68, w: 20, align: 'left' },
    { name: 'QTY', x: colStart + 88, w: 18, align: 'right' },
    { name: 'RATE', x: colStart + 106, w: 24, align: 'right' },
    { name: 'GST%', x: colStart + 130, w: 18, align: 'right' },
    { name: 'AMOUNT', x: colStart + 168, w: 0, align: 'right' },
  ]
  const colEnd = pageWidth - margin - 1

  // Header row
  const headerHeight = 8
  doc.setFillColor(brand.r, brand.g, brand.b)
  doc.rect(colStart, y, tableWidth, headerHeight, 'F')
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(8)
  doc.setTextColor(white.r, white.g, white.b)
  cols.forEach(c => {
    if (c.align === 'right') {
      doc.text(c.name, c.x + c.w - 1, y + 5.5, { align: 'right' })
    } else {
      doc.text(c.name, c.x, y + 5.5)
    }
  })
  doc.setTextColor(text.r, text.g, text.b)
  y += headerHeight

  // Item rows
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  const rowHeight = 7

  txn.items.forEach((item, i) => {
    y = newPageIfNeeded(doc, y, rowHeight + 2, () => {
      // Redraw header on new page
      doc.setFillColor(brand.r, brand.g, brand.b)
      doc.rect(colStart, y, tableWidth, headerHeight, 'F')
      doc.setFont(THEME.font, 'bold')
      doc.setFontSize(8)
      doc.setTextColor(white.r, white.g, white.b)
      cols.forEach(c => {
        if (c.align === 'right') {
          doc.text(c.name, c.x + c.w - 1, y + 5.5, { align: 'right' })
        } else {
          doc.text(c.name, c.x, y + 5.5)
        }
      })
      doc.setTextColor(text.r, text.g, text.b)
      doc.setFont(THEME.font, 'normal')
      doc.setFontSize(9)
      y += headerHeight
    })

    // Zebra stripe
    if (i % 2 === 1) {
      doc.setFillColor(zebra.r, zebra.g, zebra.b)
      doc.rect(colStart, y, tableWidth, rowHeight, 'F')
    }

    const name = item.productName.length > 32 ? item.productName.slice(0, 29) + '...' : item.productName
    doc.setTextColor(text.r, text.g, text.b)
    doc.text(String(i + 1), cols[0].x, y + 5)
    doc.text(name, cols[1].x, y + 5)
    doc.setFontSize(7)
    doc.text(item.hsn || '-', cols[2].x, y + 5)
    doc.setFontSize(9)
    doc.text(`${item.quantity} ${item.unit || 'pcs'}`, cols[3].x + cols[3].w - 1, y + 5, { align: 'right' })
    doc.text(item.unitPrice.toFixed(2), cols[4].x + cols[4].w - 1, y + 5, { align: 'right' })
    doc.text(item.gstRate + '%', cols[5].x + cols[5].w - 1, y + 5, { align: 'right' })
    doc.text(formatPDFMoney(item.total), colEnd, y + 5, { align: 'right' })
    y += rowHeight
  })

  // Table bottom border
  doc.setDrawColor(border.r, border.g, border.b)
  doc.setLineWidth(0.3)
  doc.line(colStart, y, colStart + tableWidth, y)
  y += 6

  // ═══════════════════════════════════════════════════════════════════
  // 4. TOTALS — right-aligned, clean
  // ═══════════════════════════════════════════════════════════════════
  const totalsWidth = 70
  const totalsX = pageWidth - margin - totalsWidth
  const totalsValueX = pageWidth - margin - 1

  doc.setFontSize(9)
  doc.setFont(THEME.font, 'normal')
  doc.setTextColor(text.r, text.g, text.b)

  const totalsLine = (label: string, value: string, bold?: boolean) => {
    if (bold) doc.setFont(THEME.font, 'bold')
    doc.text(label, totalsX, y)
    doc.text(value, totalsValueX, y, { align: 'right' })
    if (bold) doc.setFont(THEME.font, 'normal')
    y += 5
  }

  totalsLine('Subtotal', formatPDFMoney(txn.subtotal))
  if (txn.discountAmount > 0) {
    totalsLine('Discount', '- ' + formatPDFMoney(txn.discountAmount))
  }
  totalsLine('Taxable Value', formatPDFMoney(txn.subtotal - txn.discountAmount), true)
  if (txn.cgst > 0) totalsLine('CGST', formatPDFMoney(txn.cgst))
  if (txn.sgst > 0) totalsLine('SGST', formatPDFMoney(txn.sgst))
  if (txn.igst > 0) totalsLine('IGST', formatPDFMoney(txn.igst))
  if (txn.roundOff && Math.abs(txn.roundOff) >= 0.005) {
    totalsLine('Round Off', (txn.roundOff > 0 ? '+ ' : '- ') + formatPDFMoney(Math.abs(txn.roundOff)))
  }

  // Grand total — filled brand box
  y += 1
  const gtHeight = 11
  doc.setFillColor(brand.r, brand.g, brand.b)
  doc.rect(totalsX - 2, y - 4, totalsWidth + 2, gtHeight, 'F')
  doc.setFont(THEME.font, 'bold')
  doc.setFontSize(12)
  doc.setTextColor(white.r, white.g, white.b)
  doc.text('GRAND TOTAL', totalsX, y + 3)
  doc.text(formatPDFMoney(txn.totalAmount), totalsValueX, y + 3, { align: 'right' })
  y += gtHeight + 2

  // Paid + Balance Due
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(text.r, text.g, text.b)
  doc.text('Paid: ' + formatPDFMoney(txn.paidAmount) + ' (' + txn.paymentMode.toUpperCase() + ')', totalsX, y)
  y += 5
  if (dueAmount > 0) {
    doc.setFont(THEME.font, 'bold')
    doc.setTextColor(THEME.due.r, THEME.due.g, THEME.due.b)
    doc.text('Balance Due: ' + formatPDFMoney(dueAmount), totalsX, y)
    doc.setTextColor(text.r, text.g, text.b)
    y += 5
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. AMOUNT IN WORDS — subtle strip
  // ═══════════════════════════════════════════════════════════════════
  y += 4
  doc.setFillColor(brandLight.r, brandLight.g, brandLight.b)
  doc.rect(margin, y - 3, tableWidth, 7, 'F')
  doc.setFont(THEME.font, 'italic')
  doc.setFontSize(8)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  const wordsStr = amountToWords(txn.totalAmount)
  const wordsLabel = 'Amount in words: ' + wordsStr
  const displayWords = wordsLabel.length > 100 ? wordsLabel.slice(0, 97) + '...' : wordsLabel
  doc.text(displayWords, margin + 2, y + 1)
  y += 8

  // ═══════════════════════════════════════════════════════════════════
  // 6. BOTTOM SECTION — UPI QR (left) + Signature (right)
  // ═══════════════════════════════════════════════════════════════════
  const bottomY = Math.max(y + 5, pageHeight - 70)

  // UPI QR (left side, only when upiId exists and balance > 0)
  if (setting.upiId && dueAmount > 0) {
    await drawUPIQRBlock(doc, margin, bottomY, {
      upiId: setting.upiId,
      shopName: setting.shopName || 'My Shop',
      amount: dueAmount,
      note: txn.invoiceNo || 'Invoice Payment',
    })
  }

  // Signature (right side)
  const sigX = pageWidth - margin - 50
  doc.setFont(THEME.font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(textMuted.r, textMuted.g, textMuted.b)
  doc.text('For ' + (setting.shopName || 'My Shop'), sigX, bottomY)
  doc.setDrawColor(border.r, border.g, border.b)
  doc.line(sigX, bottomY + 12, sigX + 40, bottomY + 12)
  doc.text('Authorised Signatory', sigX, bottomY + 16)

  // ═══════════════════════════════════════════════════════════════════
  // 7. FOOTER — clean, readable
  // ═══════════════════════════════════════════════════════════════════
  drawFooter(doc, 1, 1)

  return doc.output('blob')
}
