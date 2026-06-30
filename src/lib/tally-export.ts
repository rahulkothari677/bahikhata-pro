/**
 * Tally Export — generates a Tally-compatible XML file for importing
 * sales/purchase transactions into Tally.ERP 9 / Tally Prime.
 *
 * Format: Tally XML import format (Vouchers)
 * Indian accountants use Tally — this makes BahiKhata Pro the perfect
 * frontend that exports to their existing accounting system.
 *
 * Usage:
 *   exportToTally(transactions, setting, 'sale')
 *   → downloads .xml file
 */

import { formatINR } from './utils'
import { formatDate } from './utils'

export function exportToTally(
  transactions: any[],
  setting: any,
  type: 'sale' | 'purchase' | 'all'
) {
  const shopName = setting?.shopName || 'My Shop'
  const filtered = type === 'all'
    ? transactions
    : transactions.filter(t => t.type === type)

  if (filtered.length === 0) return

  // Build Tally XML vouchers
  const vouchers = filtered.map(t => {
    const isSale = t.type === 'sale'
    const voucherType = isSale ? 'Sales' : t.type === 'purchase' ? 'Purchase' : t.type === 'income' ? 'Receipt' : 'Payment'
    const partyName = t.party?.name || 'Walk-in Customer'
    const date = convertToTallyDate(t.date)
    const amount = t.totalAmount.toFixed(2)

    // Build ledger entries (debit/credit)
    const partyLedger = isSale || t.type === 'income'
      ? `<LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT>`
      : `<LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT>`

    const salesLedger = isSale
      ? `<LEDGERNAME>Sales Account</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-t.subtotal).toFixed(2)}</AMOUNT>`
      : t.type === 'purchase'
        ? `<LEDGERNAME>Purchase Account</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.subtotal.toFixed(2)}</AMOUNT>`
        : t.type === 'income'
          ? `<LEDGERNAME>${escapeXml(t.category || 'Other Income')}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-t.totalAmount).toFixed(2)}</AMOUNT>`
          : `<LEDGERNAME>${escapeXml(t.category || 'Indirect Expenses')}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.totalAmount.toFixed(2)}</AMOUNT>`

    // Tax ledgers
    const taxLedgers = []
    if (t.cgst > 0) taxLedgers.push(`<LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.cgst.toFixed(2)}</AMOUNT>`)
    if (t.sgst > 0) taxLedgers.push(`<LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.sgst.toFixed(2)}</AMOUNT>`)
    if (t.igst > 0) taxLedgers.push(`<LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.igst.toFixed(2)}</AMOUNT>`)

    // Round off
    const allLedgerEntries = [partyLedger, salesLedger, ...taxLedgers]

    return `
    <VOUCHER VCHTYPE="${voucherType}" ACTION="Create">
      <DATE>${date}</DATE>
      <VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${escapeXml(t.invoiceNo || '')}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${escapeXml(partyName)}</PARTYLEDGERNAME>
      <NARRATION>${escapeXml(t.notes || `Transaction ${t.invoiceNo || t.id.slice(-6)}`)}</NARRATION>
      <ALLLEDGERENTRIES.LIST>
        ${allLedgerEntries.map(entry => `<ALLLEDGERENTRIES.LIST>${entry}</ALLLEDGERENTRIES.LIST>`).join('\n        ')}
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>`
  }).join('\n')

  // Full Tally XML envelope
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(shopName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          ${vouchers}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`

  // Download as XML
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Tally_Export_${type}_${formatDate(new Date()).replace(/\//g, '-')}.xml`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Generate UPI payment link for outstanding dues.
 * Format: upi://pay?pa=UPI_ID&pn=NAME&am=AMOUNT&tn=NOTE
 */
export function generateUPILink(
  upiId: string,
  payeeName: string,
  amount: number,
  note: string
): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: note,
  })
  return `upi://pay?${params.toString()}`
}

/**
 * Generate WhatsApp message with UPI payment link for outstanding dues.
 */
export function generatePaymentReminderMessage(
  partyName: string,
  balance: number,
  upiId?: string,
  shopName?: string,
): string {
  const lines = [
    `Dear ${partyName},`,
    ``,
    `You have an outstanding balance of Rs. ${balance.toFixed(2)} with ${shopName || 'our shop'}.`,
    `Please clear the payment at your earliest convenience.`,
  ]
  if (upiId) {
    const upiLink = generateUPILink(upiId, shopName || 'Shop', balance, `Payment to ${shopName || 'shop'}`)
    lines.push(``)
    lines.push(`Pay via UPI: ${upiLink}`)
  }
  lines.push(``)
  lines.push(`Thank you for your business!`)
  return lines.join('\n')
}

// ─── Helpers ─────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function convertToTallyDate(dateStr: string): string {
  // Tally expects YYYYMMDD format
  const d = new Date(dateStr)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}
