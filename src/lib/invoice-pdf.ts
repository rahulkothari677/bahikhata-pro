/**
 * generateInvoicePDF — creates a professional PDF invoice using jsPDF.
 *
 * Generates a clean, branded invoice with:
 * - Shop name + details header
 * - Invoice number + date
 * - Customer details
 * - Itemized table (name, qty, price, GST, total)
 * - Subtotal, discount, tax breakdown, grand total
 * - Payment status (paid/due)
 * - Footer with thank you message
 *
 * Returns a Blob that can be shared via WhatsApp or downloaded.
 */

import { jsPDF } from 'jspdf'

interface InvoiceItem {
  productName: string
  quantity: number
  unitPrice: number
  gstRate: number
  total: number
  unit?: string
}

interface InvoiceData {
  invoiceNo: string | null
  date: string | Date
  party?: {
    name: string
    phone?: string
    gstin?: string
    address?: string
  } | null
  items: InvoiceItem[]
  subtotal: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  totalAmount: number
  paidAmount: number
  paymentMode: string
}

interface ShopSetting {
  shopName: string
  ownerName?: string
  phone?: string
  email?: string
  gstin?: string
  address?: string
  state?: string
}

export function generateInvoicePDF(txn: InvoiceData, setting: ShopSetting): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const pageHeight = 297
  const margin = 15
  let y = 20

  // === HEADER ===
  // Shop name (large, bold)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(0)
  doc.text(setting.shopName || 'My Shop', margin, y)

  // Shop details (smaller, regular)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  y += 6
  let detailLine = ''
  if (setting.phone) detailLine += `Phone: ${setting.phone}  `
  if (setting.gstin) detailLine += `GSTIN: ${setting.gstin}`
  if (detailLine) {
    doc.text(detailLine, margin, y)
    y += 4
  }
  if (setting.address) {
    doc.text(setting.address, margin, y)
    y += 4
  }
  if (setting.email) {
    doc.text(setting.email, margin, y)
    y += 4
  }

  // Horizontal line
  y += 2
  doc.setDrawColor(200)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  // === INVOICE TITLE + META ===
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('INVOICE', margin, y)

  // Right side: invoice no + date
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const invNo = txn.invoiceNo || `TXN-${String(txn.date).slice(-6)}`
  const dateStr = typeof txn.date === 'string' ? txn.date : txn.date.toLocaleDateString('en-IN')
  doc.text(`Invoice No: ${invNo}`, pageWidth - margin, y, { align: 'right' })
  y += 5
  doc.text(`Date: ${dateStr}`, pageWidth - margin, y, { align: 'right' })

  // === BILL TO ===
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Bill To:', margin, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  if (txn.party?.name) {
    doc.text(txn.party.name, margin, y)
    y += 4
  }
  if (txn.party?.phone) {
    doc.text(`Phone: ${txn.party.phone}`, margin, y)
    y += 4
  }
  if (txn.party?.gstin) {
    doc.text(`GSTIN: ${txn.party.gstin}`, margin, y)
    y += 4
  }

  // === ITEMS TABLE ===
  y += 6
  // Table header
  doc.setFillColor(240, 240, 240)
  doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('#', margin + 2, y)
  doc.text('Product', margin + 10, y)
  doc.text('Qty', margin + 95, y, { align: 'right' })
  doc.text('Price', margin + 125, y, { align: 'right' })
  doc.text('GST', margin + 150, y, { align: 'right' })
  doc.text('Amount', pageWidth - margin - 2, y, { align: 'right' })
  y += 6

  // Table rows
  doc.setFont('helvetica', 'normal')
  txn.items.forEach((item, i) => {
    // Check if we need a new page
    if (y > pageHeight - 60) {
      doc.addPage()
      y = 20
    }

    const idx = String(i + 1)
    const name = item.productName.length > 40 ? item.productName.slice(0, 37) + '...' : item.productName
    const qty = `${item.quantity} ${item.unit || 'pcs'}`
    const price = `Rs. ${item.unitPrice.toFixed(2)}`
    const gst = `${item.gstRate}%`
    const amount = `Rs. ${item.total.toFixed(2)}`

    doc.text(idx, margin + 2, y)
    doc.text(name, margin + 10, y)
    doc.text(qty, margin + 95, y, { align: 'right' })
    doc.text(price, margin + 125, y, { align: 'right' })
    doc.text(gst, margin + 150, y, { align: 'right' })
    doc.text(amount, pageWidth - margin - 2, y, { align: 'right' })
    y += 5
  })

  // === TOTALS ===
  y += 4
  doc.setDrawColor(200)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6

  const labelX = pageWidth - margin - 50
  const valueX = pageWidth - margin - 2

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Subtotal:', labelX, y)
  doc.text(`Rs. ${txn.subtotal.toFixed(2)}`, valueX, y, { align: 'right' })
  y += 5

  if (txn.discountAmount > 0) {
    doc.text('Discount:', labelX, y)
    doc.text(`- Rs. ${txn.discountAmount.toFixed(2)}`, valueX, y, { align: 'right' })
    y += 5
  }

  if (txn.cgst > 0) {
    doc.text('CGST:', labelX, y)
    doc.text(`Rs. ${txn.cgst.toFixed(2)}`, valueX, y, { align: 'right' })
    y += 5
  }
  if (txn.sgst > 0) {
    doc.text('SGST:', labelX, y)
    doc.text(`Rs. ${txn.sgst.toFixed(2)}`, valueX, y, { align: 'right' })
    y += 5
  }
  if (txn.igst > 0) {
    doc.text('IGST:', labelX, y)
    doc.text(`Rs. ${txn.igst.toFixed(2)}`, valueX, y, { align: 'right' })
    y += 5
  }

  // Grand total (bold, highlighted)
  y += 2
  doc.setFillColor(240, 240, 240)
  doc.rect(labelX - 2, y - 4, pageWidth - margin - labelX, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Total:', labelX, y)
  doc.text(`Rs. ${txn.totalAmount.toFixed(2)}`, valueX, y, { align: 'right' })
  y += 8

  // Payment status
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Paid: Rs. ${txn.paidAmount.toFixed(2)}  (${txn.paymentMode.toUpperCase()})`, labelX, y)
  y += 5
  const due = txn.totalAmount - txn.paidAmount
  if (due > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(200, 0, 0)
    doc.text(`Balance Due: Rs. ${due.toFixed(2)}`, labelX, y)
    doc.setTextColor(0)
    y += 5
  }

  // === FOOTER ===
  y = pageHeight - 30
  doc.setDrawColor(200)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.text('Thank you for your business!', pageWidth / 2, y, { align: 'center' })
  y += 5
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text('Generated by BahiKhata Pro — India\'s Smartest Ledger App', pageWidth / 2, y, { align: 'center' })

  // Return as Blob
  return doc.output('blob')
}
