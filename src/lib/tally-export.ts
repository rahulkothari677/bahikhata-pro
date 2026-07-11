/**
 * Tally Export — generates a Tally-compatible XML file for importing
 * sales/purchase transactions into Tally.ERP 9 / Tally Prime.
 *
 * Format: Tally XML import format (Vouchers)
 * Indian accountants use Tally — this makes EkBook the perfect
 * frontend that exports to their existing accounting system.
 *
 * Usage:
 *   exportToTally(transactions, setting, 'sale')
 *   → downloads .xml file
 */

import { formatINR } from './utils'
import { formatDate } from './utils'
import { shareOrDownload } from './csv-export'

export async function exportToTally(
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
    const isPurchase = t.type === 'purchase'
    const isCreditNote = t.type === 'credit-note'
    const isDebitNote = t.type === 'debit-note'
    // 🔒 V17 Audit Phase 4: Added Credit Note and Debit Note voucher types.
    // Was: only sale/purchase/income/expense. Credit notes were exported as
    // 'Sales' (wrong — they're reversals) and debit notes as 'Purchase' (wrong).
    const voucherType = isSale ? 'Sales'
      : isPurchase ? 'Purchase'
      : isCreditNote ? 'Credit Note'
      : isDebitNote ? 'Debit Note'
      : t.type === 'income' ? 'Receipt'
      : 'Payment'
    const partyName = t.party?.name || 'Walk-in Customer'
    const date = convertToTallyDate(t.date)
    const amount = t.totalAmount.toFixed(2)

    // 🔒 FIX H10: Voucher must balance (Total Debits = Total Credits).
    // Was: Sales credited with gross subtotal, but party debited with
    // totalAmount (= subtotal - discount + tax + roundOff). These don't
    // balance when discount > 0 or roundOff ≠ 0.
    // Now: Sales credited with (subtotal - discount), plus a Round Off
    // entry for the rounding adjustment. Tally rejects unbalanced vouchers.

    const discount = t.discountAmount || 0
    const taxableAmount = t.subtotal - discount  // post-discount taxable

    // Build ledger entries (debit/credit)
    // Convention: positive AMOUNT = Debit, negative AMOUNT = Credit
    // 🔒 V17 Audit Phase 4: Credit notes REVERSE sales (party credited, sales debited).
    // Debit notes REVERSE purchases (party debited, purchase credited).
    const partyLedger = (isSale || t.type === 'income')
      ? `<LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT>`
      : (isPurchase || t.type === 'expense')
        ? `<LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT>`
        : isCreditNote
          // Credit Note: party is CREDITED (we owe them), sales is DEBITED (reversal)
          ? `<LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT>`
          : isDebitNote
            // Debit Note: party is DEBITED (they owe us), purchase is CREDITED (reversal)
            ? `<LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT>`
            : `<LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT>`

    // Sales/Purchase: credit/debit the POST-DISCOUNT taxable amount
    // 🔒 V17 Audit Phase 4: Credit notes DEBIT sales (reversal). Debit notes CREDIT purchase (reversal).
    const salesLedger = isSale
      ? `<LEDGERNAME>Sales Account</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-taxableAmount).toFixed(2)}</AMOUNT>`
      : isPurchase
        ? `<LEDGERNAME>Purchase Account</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${taxableAmount.toFixed(2)}</AMOUNT>`
        : isCreditNote
          // Credit Note: DEBIT Sales (reversal of credit)
          ? `<LEDGERNAME>Sales Account</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${taxableAmount.toFixed(2)}</AMOUNT>`
          : isDebitNote
            // Debit Note: CREDIT Purchase (reversal of debit)
            ? `<LEDGERNAME>Purchase Account</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-taxableAmount).toFixed(2)}</AMOUNT>`
            : t.type === 'income'
              ? `<LEDGERNAME>${escapeXml(t.category || 'Other Income')}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-t.totalAmount).toFixed(2)}</AMOUNT>`
              : `<LEDGERNAME>${escapeXml(t.category || 'Indirect Expenses')}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.totalAmount.toFixed(2)}</AMOUNT>`

    // Tax ledgers — for credit notes, REVERSE the tax direction
    const taxLedgers: string[] = []
    if (isCreditNote) {
      // Credit Note: DEBIT tax (reversal of credit)
      if (t.cgst > 0) taxLedgers.push(`<LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.cgst.toFixed(2)}</AMOUNT>`)
      if (t.sgst > 0) taxLedgers.push(`<LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.sgst.toFixed(2)}</AMOUNT>`)
      if (t.igst > 0) taxLedgers.push(`<LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${t.igst.toFixed(2)}</AMOUNT>`)
    } else if (isDebitNote) {
      // Debit Note: CREDIT tax (reversal of debit)
      if (t.cgst > 0) taxLedgers.push(`<LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-t.cgst).toFixed(2)}</AMOUNT>`)
      if (t.sgst > 0) taxLedgers.push(`<LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-t.sgst).toFixed(2)}</AMOUNT>`)
      if (t.igst > 0) taxLedgers.push(`<LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-t.igst).toFixed(2)}</AMOUNT>`)
    } else {
      // Normal sale/purchase: CREDIT tax (for sales) or DEBIT tax (for purchases)
      if (t.cgst > 0) taxLedgers.push(`<LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>${isPurchase ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE><AMOUNT>${(isPurchase ? t.cgst : -t.cgst).toFixed(2)}</AMOUNT>`)
      if (t.sgst > 0) taxLedgers.push(`<LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>${isPurchase ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE><AMOUNT>${(isPurchase ? t.sgst : -t.sgst).toFixed(2)}</AMOUNT>`)
      if (t.igst > 0) taxLedgers.push(`<LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>${isPurchase ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE><AMOUNT>${(isPurchase ? t.igst : -t.igst).toFixed(2)}</AMOUNT>`)
    }

    // Round Off ledger — makes the voucher balance when totalAmount ≠ (taxable + tax)
    // roundOff = totalAmount - (taxableAmount + cgst + sgst + igst)
    // If roundOff > 0: Credit Round Off (customer pays more) → negative AMOUNT
    // If roundOff < 0: Debit Round Off (customer pays less) → positive AMOUNT
    const roundOffLedgers: string[] = []
    const roundOff = t.roundOff || 0
    if (Math.abs(roundOff) >= 0.005) {
      if (roundOff > 0) {
        // Credit Round Off
        roundOffLedgers.push(`<LEDGERNAME>Round Off</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${(-roundOff).toFixed(2)}</AMOUNT>`)
      } else {
        // Debit Round Off
        roundOffLedgers.push(`<LEDGERNAME>Round Off</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${Math.abs(roundOff).toFixed(2)}</AMOUNT>`)
      }
    }

    const allLedgerEntries = [partyLedger, salesLedger, ...taxLedgers, ...roundOffLedgers]

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

  // Save/share file — uses Capacitor Share on mobile, browser download on desktop
  const cleanFilename = `Tally_Export_${type}_${formatDate(new Date()).replace(/\//g, '-')}.xml`
  await shareOrDownload(xml, cleanFilename, 'application/xml')
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
  // 🔒 V17 Audit Phase 4: Use IST date, not local timezone (was: d.getDate()
  // which returns the LOCAL date — on Vercel/UTC, a sale at 2 AM IST on July 6
  // showed July 5 in the Tally export).
  const d = new Date(dateStr)
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000
  const istDate = new Date(istMs)
  const year = istDate.getUTCFullYear()
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(istDate.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}
