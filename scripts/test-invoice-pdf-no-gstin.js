/**
 * Test script: generate a sample invoice PDF where the party has NO GSTIN,
 * to verify the right "SUPPLY & PAYMENT" card disappears and Bill To spans
 * full width per the auditor spec.
 *
 * Output: /home/z/my-project/download/invoice-INV-0024-no-gstin-test.pdf
 */

const path = require('path')
const fs = require('fs')

async function main() {
  globalThis.fetch = async (url) => {
    if (url === '/fonts/DejaVuSans-Regular.ttf') {
      const buf = fs.readFileSync('/home/z/my-project/public/fonts/DejaVuSans-Regular.ttf')
      return { ok: true, arrayBuffer: () => Promise.resolve(buf.buffer) }
    }
    if (url === '/fonts/DejaVuSans-Bold.ttf') {
      const buf = fs.readFileSync('/home/z/my-project/public/fonts/DejaVuSans-Bold.ttf')
      return { ok: true, arrayBuffer: () => Promise.resolve(buf.buffer) }
    }
    return { ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }
  }
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64')

  const { generateInvoicePDF } = require('/home/z/my-project/scripts/_pdf-build/invoice-pdf.js')

  // Test data: walk-in customer, no GSTIN, no state
  const txn = {
    invoiceNo: 'INV-0024',
    date: new Date('2026-07-21'),
    party: {
      name: 'Walk-in Customer',
      phone: undefined,
      gstin: null,
      address: null,
      state: null,
    },
    items: [
      { productName: 'Tea 250g', quantity: 2, unitPrice: 60, gstRate: 5, total: 120, unit: 'pcs', hsn: '0902' },
      { productName: 'Sugar 1kg', quantity: 1, unitPrice: 45, gstRate: 5, total: 45, unit: 'kg', hsn: '1701' },
    ],
    subtotal: 165,
    discountAmount: 0,
    cgst: 4.13,
    sgst: 4.12,
    igst: 0,
    totalAmount: 173.25,
    paidAmount: 173.25,
    paymentMode: 'CASH',
    isInterState: false,
  }

  const setting = {
    shopName: 'Sharma Kirana Store',
    phone: '9876543210',
    gstin: '27ABCDE1234F1Z5',
    address: 'Shop 12, Main Bazaar, Pune, Maharashtra 411001',
    state: 'Maharashtra',
    upiId: 'sharma@okaxis',
  }

  const blob = await generateInvoicePDF(txn, setting)
  const buf = Buffer.from(await blob.arrayBuffer())
  const outPath = '/home/z/my-project/download/invoice-INV-0024-no-gstin-test.pdf'
  fs.writeFileSync(outPath, buf)
  console.log('OK wrote ' + outPath + ' (' + buf.length + ' bytes)')
}

main().catch((err) => { console.error('FAIL', err); process.exit(1) })
