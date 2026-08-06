'use client'

/**
 * DEV-ONLY invoice preview. Renders the WhatsApp share image from a sample
 * bill, so the layout can be judged as the thing a customer receives rather
 * than as code. Not linked from anywhere.
 */

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { buildInvoiceDocument } from '@/lib/invoice-document'
import { renderInvoiceImage } from '@/lib/invoice-share-image'
import { INVOICE_THEMES } from '@/lib/invoice-themes'

const SHOP = {
  name: 'Sharma Kirana & General Stores',
  ownerName: 'Rahul Sharma',
  phone: '+91 98765 43210',
  email: 'shop@sharmakirana.in',
  gstin: '27ABCDE1234F1Z5',
  address: 'Shop 14, Gandhi Market, Indore, MP - 452001',
  state: 'Madhya Pradesh',
  upiId: 'sharmakirana@okaxis',
  logoUrl: null,
}

const SRC = {
  invoiceNo: 'INV-00143',
  date: new Date('2026-08-05'),
  type: 'sale',
  party: {
    name: 'Gupta Provision Store',
    phone: '+91 90000 11111',
    gstin: '27FGHIJ5678K1Z2',
    address: '22 Sarafa Bazaar, Indore, Madhya Pradesh - 452002',
    state: 'Madhya Pradesh',
  },
  items: [
    { productName: 'Tata Salt 1kg', quantity: 24, unitPrice: 26, gstRate: 5, total: 655.2, unit: 'pkt', hsn: '25010020' },
    { productName: 'Fortune Sunflower Oil 5L', quantity: 4, unitPrice: 720, gstRate: 5, total: 3024, unit: 'can', hsn: '15121110' },
    { productName: 'Aashirvaad Atta 10kg', quantity: 6, unitPrice: 465, gstRate: 0, total: 2790, unit: 'bag', hsn: '11010000' },
    { productName: 'Parle-G Biscuit family pack', quantity: 30, unitPrice: 45, gstRate: 18, total: 1593, unit: 'pkt', hsn: '19053100' },
  ],
  subtotal: 7674,
  discountAmount: 150,
  cgst: 119.1,
  sgst: 119.1,
  igst: 0,
  totalAmount: 8062.2,
  roundOff: -0.2,
  paidAmount: 3000,
  paymentMode: 'UPI',
  isInterState: false,
  allocatedAmount: 0,
}

export default function DevInvoicePage() {
  const [url, setUrl] = useState<string | null>(null)
  const [themeId, setThemeId] = useState('classic')

  useEffect(() => {
    const doc = buildInvoiceDocument(SRC as never, SHOP)
    const svg = document.querySelector('#dev-qr svg')
    const render = (qrImage: HTMLImageElement | null) =>
      setUrl(renderInvoiceImage(doc, { qrImage, themeId }))
    // Exposed so every theme can be rendered and reviewed in one pass.
    ;(window as unknown as Record<string, unknown>).__renderAllInvoiceThemes = async () => {
      const svg = document.querySelector('#dev-qr svg')
      const qr = svg
        ? await new Promise<HTMLImageElement | null>(res => {
            const i = new Image()
            i.onload = () => res(i)
            i.onerror = () => res(null)
            i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
          })
        : null
      return INVOICE_THEMES.map(t => ({
        id: t.id,
        name: t.name,
        url: renderInvoiceImage(doc, { qrImage: qr, themeId: t.id }),
      }))
    }
    if (svg && doc.upiLink) {
      const img = new Image()
      img.onload = () => render(img)
      img.onerror = () => render(null)
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
    } else render(null)
  }, [themeId])

  return (
    <div className="min-h-screen bg-neutral-200 p-6">
      <div id="dev-qr" className="hidden">
        <QRCodeSVG value="upi://pay?pa=sharmakirana@okaxis&am=5062.20" size={220} level="M" />
      </div>
      <div className="max-w-md mx-auto mb-3">
        <select
          data-testid="dev-theme"
          value={themeId}
          onChange={e => setThemeId(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-white"
        >
          {INVOICE_THEMES.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="max-w-md mx-auto" data-testid="dev-invoice">
        {url && <img src={url} alt="Invoice preview" className="w-full shadow-xl" />}
      </div>
    </div>
  )
}
