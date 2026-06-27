#!/usr/bin/env python3
"""Replace the PrintInvoice + PrintInvoiceContent + generateInvoiceHTML section
in TransactionDetail.tsx with the redesigned, GST-compliant versions."""

import sys

FILE = '/home/z/my-project/src/components/ledger/TransactionDetail.tsx'

with open(FILE, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Lines 691 to 861 (1-indexed) — replace inclusive
# In Python list (0-indexed): start_idx=690, end_idx=861 (exclusive)
START = 690  # line 691 (0-indexed)
END = 861    # line 861 inclusive → end exclusive = 861

NEW_BLOCK = '''function PrintInvoice({ txn, setting }: { txn: any; setting: any }) {
  return (
    <div className="hidden print:block fixed inset-0 bg-white p-6 lg:p-10 z-50 overflow-y-auto">
      <PrintInvoiceContent txn={txn} setting={setting} />
    </div>
  )
}

function PrintInvoiceContent({ txn, setting }: { txn: any; setting: any }) {
  const isSale = txn.type === 'sale'
  const due = txn.totalAmount - txn.paidAmount
  const shopName = setting?.shopName || 'My Shop'
  const shopAddress = setting?.address
  const shopPhone = setting?.phone
  const shopGstin = setting?.gstin
  const shopState = setting?.state
  const ownerName = setting?.ownerName || shopName
  return (
    <div className="max-w-3xl mx-auto text-black">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-6 pb-5 mb-5 border-b-2 border-orange-600">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xl">{shopName?.[0]?.toUpperCase() || 'B'}</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{shopName}</h1>
            {shopAddress && <p className="text-xs text-gray-700 mt-0.5 max-w-xs">{shopAddress}</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-700 mt-1">
              {shopPhone && <span>Phone: {shopPhone}</span>}
              {shopGstin && <span className="font-mono">GSTIN: {shopGstin}</span>}
              {shopState && <span>State: {shopState}</span>}
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <h2 className="text-lg font-bold tracking-wide uppercase">{isSale ? 'Tax Invoice' : 'Purchase Bill'}</h2>
          <div className="text-xs text-gray-700 mt-1 space-y-0.5">
            <p><span className="text-gray-500">Invoice No:</span> <span className="font-mono font-medium">{txn.invoiceNo || txn.id.slice(-8)}</span></p>
            <p><span className="text-gray-500">Date:</span> <span className="font-medium">{formatDate(txn.date)}</span></p>
            <p><span className="text-gray-500">Payment:</span> <span className="font-medium uppercase">{txn.paymentMode}</span></p>
          </div>
        </div>
      </div>

      {/* Bill To / Supply Details */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-semibold">Bill To</p>
          <p className="font-bold text-sm">{txn.party?.name || 'Walk-in Customer'}</p>
          {txn.party?.phone && <p className="text-xs text-gray-700 mt-0.5">{txn.party.phone}</p>}
          {txn.party?.gstin && <p className="text-xs text-gray-700 font-mono mt-0.5">GSTIN: {txn.party.gstin}</p>}
          {txn.party?.address && <p className="text-xs text-gray-700 mt-0.5">{txn.party.address}</p>}
          {txn.party?.state && <p className="text-xs text-gray-700 mt-0.5">State: {txn.party.state}</p>}
        </div>
        <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-semibold">Supply Details</p>
          <div className="text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">GST Type:</span><span className="font-medium">{txn.isInterState ? 'IGST (Inter-state)' : 'CGST + SGST'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Items:</span><span className="font-medium">{txn.items.length}</span></div>
            {isSale && txn.grossProfit !== undefined && (
              <div className="flex justify-between"><span className="text-gray-500">Profit:</span><span className="font-medium text-emerald-700">Rs.{txn.grossProfit.toFixed(2)}</span></div>
            )}
          </div>
        </div>
      </div>

      {/* Items table */}
      <table className="w-full text-xs border border-gray-300 mb-4">
        <thead>
          <tr className="bg-orange-50 border-b border-gray-300">
            <th className="text-left py-2 px-2 font-semibold w-8">#</th>
            <th className="text-left py-2 px-2 font-semibold">Item / Description</th>
            <th className="text-right py-2 px-2 font-semibold w-16">HSN</th>
            <th className="text-right py-2 px-2 font-semibold w-16">Qty</th>
            <th className="text-right py-2 px-2 font-semibold w-24">Unit Price</th>
            <th className="text-right py-2 px-2 font-semibold w-16">GST%</th>
            <th className="text-right py-2 px-2 font-semibold w-28">Amount</th>
          </tr>
        </thead>
        <tbody>
          {txn.items.map((item: any, i: number) => (
            <tr key={i} className="border-b border-gray-200">
              <td className="py-2 px-2 text-gray-600">{i + 1}</td>
              <td className="py-2 px-2 font-medium">{item.productName}</td>
              <td className="py-2 px-2 text-right text-gray-600">{item.hsnCode || '\\u2014'}</td>
              <td className="py-2 px-2 text-right">{item.quantity}</td>
              <td className="py-2 px-2 text-right">Rs.{item.unitPrice.toFixed(2)}</td>
              <td className="py-2 px-2 text-right">{item.gstRate}%</td>
              <td className="py-2 px-2 text-right font-semibold">Rs.{item.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Amount in words + totals */}
      <div className="flex justify-between items-start gap-6 mb-5">
        <div className="flex-1">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-semibold">Amount in Words</p>
          <p className="text-xs italic font-medium text-gray-800 max-w-xs">{amountToWords(txn.totalAmount)}</p>
        </div>
        <div className="w-72 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="font-medium">Rs.{txn.subtotal.toFixed(2)}</span></div>
          {txn.discountAmount > 0 && <div className="flex justify-between"><span className="text-gray-600">Discount</span><span className="font-medium text-rose-700">-Rs.{txn.discountAmount.toFixed(2)}</span></div>}
          {txn.cgst > 0 && <div className="flex justify-between"><span className="text-gray-600">CGST</span><span className="font-medium">Rs.{txn.cgst.toFixed(2)}</span></div>}
          {txn.sgst > 0 && <div className="flex justify-between"><span className="text-gray-600">SGST</span><span className="font-medium">Rs.{txn.sgst.toFixed(2)}</span></div>}
          {txn.igst > 0 && <div className="flex justify-between"><span className="text-gray-600">IGST</span><span className="font-medium">Rs.{txn.igst.toFixed(2)}</span></div>}
          <div className="flex justify-between text-base font-bold border-t-2 border-black pt-2 mt-1">
            <span>Total</span><span>Rs.{txn.totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-emerald-700"><span>Paid</span><span className="font-medium">Rs.{txn.paidAmount.toFixed(2)}</span></div>
          {due > 0 && (
            <div className="flex justify-between text-rose-700 font-semibold"><span>Balance Due</span><span>Rs.{due.toFixed(2)}</span></div>
          )}
        </div>
      </div>

      {/* Terms + signature + footer */}
      <div className="grid grid-cols-2 gap-6 mt-10 pt-4 border-t border-gray-300">
        <div className="text-[10px] text-gray-600 leading-relaxed">
          <p className="font-semibold text-gray-700 mb-1">Terms &amp; Conditions</p>
          <p>&bull; Goods once sold will not be taken back or exchanged.</p>
          <p>&bull; All disputes are subject to local jurisdiction only.</p>
          {due > 0 && <p>&bull; Payment due within 30 days from invoice date.</p>}
        </div>
        <div className="text-right">
          <div className="border-t border-gray-400 mt-8 pt-1 inline-block w-40">
            <p className="text-[10px] text-gray-600 font-medium">Authorised Signatory</p>
          </div>
          <p className="text-xs font-semibold mt-2">{ownerName}</p>
        </div>
      </div>

      <div className="mt-6 pt-3 border-t border-gray-200 text-center text-[10px] text-gray-500">
        <p>This is a computer-generated invoice and does not require a physical signature.</p>
        <p>Generated by BahiKhata Pro on {formatDate(new Date())}</p>
      </div>
    </div>
  )
}

function generateInvoiceHTML(txn: any, setting: any): string {
  const isSale = txn.type === 'sale'
  const due = txn.totalAmount - txn.paidAmount
  const shopName = setting?.shopName || 'My Shop'
  const shopAddress = setting?.address || ''
  const shopPhone = setting?.phone || ''
  const shopGstin = setting?.gstin || ''
  const shopState = setting?.state || ''
  const ownerName = setting?.ownerName || shopName
  const amountInWords = amountToWords(txn.totalAmount)

  const itemsHTML = txn.items.map((item: any, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td>${item.productName}</td>
      <td style="text-align:right">${item.hsnCode || '\\u2014'}</td>
      <td style="text-align:right">${item.quantity}</td>
      <td style="text-align:right">Rs.${item.unitPrice.toFixed(2)}</td>
      <td style="text-align:right">${item.gstRate}%</td>
      <td style="text-align:right">Rs.${item.total.toFixed(2)}</td>
    </tr>
  `).join('')

  const party = txn.party || {}
  const partyLines = [
    party.phone ? `<p style="margin:3px 0; font-size:13px;">${party.phone}</p>` : '',
    party.gstin ? `<p style="margin:3px 0; font-size:13px; font-family:monospace;">GSTIN: ${party.gstin}</p>` : '',
    party.address ? `<p style="margin:3px 0; font-size:13px; color:#555;">${party.address}</p>` : '',
    party.state ? `<p style="margin:3px 0; font-size:13px; color:#555;">State: ${party.state}</p>` : '',
  ].join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${txn.invoiceNo || txn.id}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1a1a1a; background: #fff; }
    h1, h2, h3 { margin: 0; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 9px 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 13px; }
    th { background: #fef3e6; font-weight: 600; color: #444; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #d97706; padding-bottom: 18px; margin-bottom: 24px; }
    .logo { width: 56px; height: 56px; border-radius: 10px; background: linear-gradient(135deg, #f97316, #e11d48); color: white; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 700; }
    .shop-info { flex: 1; margin-left: 12px; }
    .shop-info h1 { font-size: 22px; }
    .shop-info p { margin: 2px 0; font-size: 12px; color: #555; }
    .invoice-meta { text-align: right; }
    .invoice-meta h2 { font-size: 18px; text-transform: uppercase; letter-spacing: 1px; color: #1a1a1a; }
    .invoice-meta .meta { margin-top: 6px; font-size: 12px; color: #555; }
    .invoice-meta .meta div { margin: 2px 0; }
    .invoice-meta .meta .label { color: #888; margin-right: 4px; }
    .invoice-meta .meta .value { font-weight: 600; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .party-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
    .party-box .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; margin-bottom: 6px; }
    .party-box .name { font-weight: 700; font-size: 14px; margin: 0; }
    .party-box p { margin: 3px 0; font-size: 12px; color: #555; }
    .totals-wrap { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 8px; }
    .amount-words { flex: 1; }
    .amount-words .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; margin-bottom: 4px; }
    .amount-words .value { font-size: 12px; font-style: italic; color: #333; max-width: 320px; }
    .totals { width: 280px; font-size: 13px; }
    .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals .grand { font-size: 18px; font-weight: bold; border-top: 2px solid #1a1a1a; padding-top: 8px; margin-top: 4px; }
    .totals .paid { color: #059669; }
    .totals .due { color: #dc2626; font-weight: 600; }
    .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 48px; padding-top: 16px; border-top: 1px solid #ddd; }
    .terms p { font-size: 11px; color: #555; margin: 2px 0; line-height: 1.5; }
    .terms .label { font-weight: 700; color: #333; margin-bottom: 4px; font-size: 11px; }
    .sign { text-align: right; }
    .sign .line { border-top: 1px solid #888; margin-top: 36px; padding-top: 4px; display: inline-block; width: 160px; }
    .sign .name { font-size: 13px; font-weight: 600; margin-top: 6px; }
    .footer { margin-top: 24px; padding-top: 14px; border-top: 1px solid #e5e7eb; text-align: center; color: #888; font-size: 11px; }
    .footer p { margin: 2px 0; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex; align-items:flex-start;">
      <div class="logo">${shopName[0]?.toUpperCase() || 'B'}</div>
      <div class="shop-info">
        <h1>${shopName}</h1>
        ${shopAddress ? `<p>${shopAddress}</p>` : ''}
        <p>
          ${shopPhone ? `Phone: ${shopPhone}` : ''}
          ${shopGstin ? ` &nbsp;|&nbsp; <span style="font-family:monospace;">GSTIN: ${shopGstin}</span>` : ''}
          ${shopState ? ` &nbsp;|&nbsp; State: ${shopState}` : ''}
        </p>
      </div>
    </div>
    <div class="invoice-meta">
      <h2>${isSale ? 'Tax Invoice' : 'Purchase Bill'}</h2>
      <div class="meta">
        <div><span class="label">Invoice No:</span><span class="value">${txn.invoiceNo || txn.id.slice(-8)}</span></div>
        <div><span class="label">Date:</span><span class="value">${formatDate(txn.date)}</span></div>
        <div><span class="label">Payment:</span><span class="value" style="text-transform:uppercase;">${txn.paymentMode}</span></div>
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party-box">
      <p class="label">Bill To</p>
      <p class="name">${party.name || 'Walk-in Customer'}</p>
      ${partyLines}
    </div>
    <div class="party-box">
      <p class="label">Supply Details</p>
      <p style="margin:3px 0;"><span style="color:#888;">GST Type:</span> <strong>${txn.isInterState ? 'IGST (Inter-state)' : 'CGST + SGST'}</strong></p>
      <p style="margin:3px 0;"><span style="color:#888;">Items:</span> <strong>${txn.items.length}</strong></p>
      ${isSale && txn.grossProfit !== undefined ? `<p style="margin:3px 0;"><span style="color:#888;">Profit:</span> <strong style="color:#059669;">Rs.${txn.grossProfit.toFixed(2)}</strong></p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:30px;">#</th>
        <th>Item / Description</th>
        <th style="text-align:right; width:70px;">HSN</th>
        <th style="text-align:right; width:60px;">Qty</th>
        <th style="text-align:right; width:90px;">Unit Price</th>
        <th style="text-align:right; width:60px;">GST</th>
        <th style="text-align:right; width:100px;">Amount</th>
      </tr>
    </thead>
    <tbody>${itemsHTML}</tbody>
  </table>

  <div class="totals-wrap">
    <div class="amount-words">
      <p class="label">Amount in Words</p>
      <p class="value">${amountInWords}</p>
    </div>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>Rs.${txn.subtotal.toFixed(2)}</span></div>
      ${txn.discountAmount > 0 ? `<div class="row"><span>Discount</span><span style="color:#dc2626;">-Rs.${txn.discountAmount.toFixed(2)}</span></div>` : ''}
      ${txn.cgst > 0 ? `<div class="row"><span>CGST</span><span>Rs.${txn.cgst.toFixed(2)}</span></div>` : ''}
      ${txn.sgst > 0 ? `<div class="row"><span>SGST</span><span>Rs.${txn.sgst.toFixed(2)}</span></div>` : ''}
      ${txn.igst > 0 ? `<div class="row"><span>IGST</span><span>Rs.${txn.igst.toFixed(2)}</span></div>` : ''}
      <div class="row grand"><span>Total</span><span>Rs.${txn.totalAmount.toFixed(2)}</span></div>
      <div class="row paid"><span>Paid</span><span>Rs.${txn.paidAmount.toFixed(2)}</span></div>
      ${due > 0 ? `<div class="row due"><span>Balance Due</span><span>Rs.${due.toFixed(2)}</span></div>` : ''}
    </div>
  </div>

  <div class="bottom">
    <div class="terms">
      <p class="label">Terms &amp; Conditions</p>
      <p>&bull; Goods once sold will not be taken back or exchanged.</p>
      <p>&bull; All disputes are subject to local jurisdiction only.</p>
      ${due > 0 ? '<p>&bull; Payment due within 30 days from invoice date.</p>' : ''}
    </div>
    <div class="sign">
      <div class="line"></div>
      <p style="font-size:11px; color:#888;">Authorised Signatory</p>
      <p class="name">${ownerName}</p>
    </div>
  </div>

  <div class="footer">
    <p>This is a computer-generated invoice and does not require a physical signature.</p>
    <p>Generated by BahiKhata Pro on ${formatDate(new Date())}</p>
  </div>
</body>
</html>`
}
'''

# Replace lines START..END (0-indexed [START, END-1]) with the new block
new_lines = lines[:START] + [NEW_BLOCK] + lines[END:]

with open(FILE, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"Replaced lines {START+1}-{END} ({END-START} lines) with new block ({len(NEW_BLOCK.splitlines())} lines)")
print(f"New file size: {sum(len(l) for l in new_lines)} chars, {len(new_lines)} lines")
