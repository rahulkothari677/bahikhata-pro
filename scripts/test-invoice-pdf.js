/**
 * Test script: generate a sample invoice PDF matching invoice-INV-0023.pdf
 * to verify the new invoice-pdf.ts layout visually.
 *
 * Output: /home/z/my-project/download/invoice-INV-0023-test.pdf
 */

const path = require('path')
const fs = require('fs')

async function main() {
  // Polyfill fetch + btoa for the PDF font registration (which fetches
  // /fonts/DejaVuSans-*.ttf). We bypass fetch by reading font files from disk.
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

  // Require the compiled invoice-pdf module
  const { generateInvoicePDF } = require('/home/z/my-project/scripts/_pdf-build/invoice-pdf.js')

  // Test data matching invoice-INV-0023.pdf
  const txn = {
    invoiceNo: 'INV-0023',
    date: new Date('2026-07-21'),
    party: {
      name: 'rahul2',
      phone: '9876543210',
      gstin: '27ABCDE1234F1Z5',
      address: 'Mumbai, Maharashtra',
      state: 'Maharashtra',
    },
    items: [
      {
        productName: 'Basmati Rice 1kg',
        quantity: 1,
        unitPrice: 120,
        gstRate: 0,
        total: 120,
        unit: 'kg',
        hsn: null,
      },
    ],
    subtotal: 120,
    discountAmount: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalAmount: 120,
    paidAmount: 10,
    paymentMode: 'CASH',
    isInterState: false,
  }

  const setting = {
    shopName: 'My Shop',
    phone: '8340228552',
    gstin: '27ABCDE1234F1Z5',
    address: 'Pune, Maharashtra, India',
    state: 'Maharashtra',
    upiId: '8340228552@ybl',
  }

  const blob = await generateInvoicePDF(txn, setting)
  const buf = Buffer.from(await blob.arrayBuffer())
  const outPath = '/home/z/my-project/download/invoice-INV-0023-test.pdf'
  fs.writeFileSync(outPath, buf)
  console.log('OK wrote ' + outPath + ' (' + buf.length + ' bytes)')
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
