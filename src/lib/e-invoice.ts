/**
 * 🔒 V17 Audit Phase 5 — e-Invoicing (IRN/QR) library.
 *
 * Generates the NIC portal-ready JSON for IRN (Invoice Reference Number)
 * generation. Also validates IRN format and decodes the signed QR code.
 *
 * IMPORTANT: This library does NOT call the NIC API directly. The actual API
 * call requires the app to be registered as a "suvidha provider" with NIC,
 * which is a separate regulatory process. Instead, this library:
 *
 *   1. Generates the IRN request JSON (the exact format NIC expects)
 *   2. The user can submit this JSON to the NIC portal manually or via a
 *      third-party API provider
 *   3. Once the IRN + signed QR are obtained, they can be stored on the
 *      Transaction and displayed in the UI
 *
 * The IRN request JSON follows the NIC e-Invoice schema (v1.03):
 *   https://einvoice.nic.in/api/specs/einv-standards.pdf
 *
 * TESTING: Pure functions — no DB, no network. Fully testable.
 */

import { roundMoney } from '@/lib/money'
import { deriveStateCode } from '@/lib/gst'

// ─── Types ────────────────────────────────────────────────────────────────

export interface EInvoiceItem {
  productName: string
  hsn: string | null
  quantity: number
  unit: string
  unitPrice: number
  gstRate: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  csamt: number
}

export interface EInvoiceTransaction {
  id: string
  type: string
  invoiceNo: string | null
  date: Date
  totalAmount: number
  subtotal: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  isInterState: boolean
  isReverseCharge: boolean
  partyName: string | null
  partyGstin: string | null
  partyState: string | null
  partyAddress: string | null
  partyPhone: string | null
  partyEmail: string | null
  items: EInvoiceItem[]
}

export interface EInvoiceShopInfo {
  gstin: string | null
  state: string | null
  stateCode: string | null
  shopName: string | null
  ownerName: string | null
  address: string | null
  phone: string | null
  email: string | null
}

export interface IRNRequest {
  Version: string
  TranType: string  // 'INV' for invoice, 'CRN' for credit note, 'DBN' for debit note
  DocType: string   // 'INV' or 'CRN' or 'DBN'
  DocDtls: {
    Typ: string     // 'INV' | 'CRN' | 'DBN'
    No: string      // invoice number
    Dt: string      // dd/mm/yyyy
  }
  SellerDtls: {
    Gstin: string
    LglNm: string
    Addr1: string
    Loc: string
    Pin: number
    Stcd: string
    Ph: string
    Em: string
  }
  BuyerDtls: {
    Gstin: string
    LglNm: string
    Addr1: string
    Loc: string
    Pin: number
    Stcd: string
    Ph: string
    Em: string
    Pos: string  // place of supply
  }
  ItemList: Array<{
    SlNo: string
    PrdDesc: string
    HsnCd: string
    Qty: number
    Unit: string
    UnitPrice: number
    TotAmt: number      // quantity × unitPrice
    Discount: number
    AssAmt: number      // taxable value (after discount)
    GstRt: number
    IgstAmt: number
    CgstAmt: number
    SgstAmt: number
    CesRt: number       // CESS rate
    CesAmt: number      // CESS amount
    TotItemVal: number  // total item value (AssAmt + all taxes)
  }>
  ValDtls: {
    AssVal: number      // total assessable value (after discount)
    CgstVal: number
    SgstVal: number
    IgstVal: number
    CesVal: number      // total CESS
    Discount: number    // total discount
    OthChrg: number     // other charges (round off, etc.)
    RndOffAmt: number   // round off
    TotInvVal: number   // total invoice value
    TotInvValFc: number // total invoice value in foreign currency (0 for domestic)
  }
  RefDtls: {
    PrecDocDtls: Array<{
      InvNo: string
      InvDt: string
    }>
  }
  EwbDtls: {
    Distance: number  // distance in km (0 if not applicable)
    TransMode: string // '1'=Road, '2'=Rail, '3'=Air, '4'=Ship
    VehNo: string     // vehicle number (if road transport)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Format date as dd/mm/yyyy (NIC format). Uses IST. */
function formatNicDate(date: Date): string {
  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000
  const istDate = new Date(istMs)
  const d = String(istDate.getUTCDate()).padStart(2, '0')
  const m = String(istParts(istDate).month + 1).padStart(2, '0')
  const y = istDate.getUTCFullYear()
  return `${d}/${m}/${y}`
}

function istParts(d: Date) {
  return { month: d.getUTCMonth(), year: d.getUTCFullYear() }
}

/** Map EkBook units to NIC UQC codes. */
function mapUnitToNicUqc(unit: string): string {
  const uqcMap: Record<string, string> = {
    'pcs': 'NOS',
    'kg': 'KGS',
    'gm': 'GMS',
    'ltr': 'LTR',
    'ml': 'MLT',
    'm': 'MTR',
    'box': 'BOX',
    'dozen': 'DOZ',
    'packet': 'PAC',
  }
  return uqcMap[unit?.toLowerCase()] || 'NOS'
}

/** Extract 4-digit pincode from address string (best effort). */
function extractPincode(address: string | null): number {
  if (!address) return 0
  const match = address.match(/\b(\d{6})\b/)
  return match ? parseInt(match[1]) : 0
}

/** Extract city/locality from address (best effort). */
function extractLocality(address: string | null): string {
  if (!address) return ''
  // Take the first line of the address (before comma or newline)
  return address.split(/[,\n]/)[0]?.trim() || ''
}

// ─── IRN Request Builder ──────────────────────────────────────────────────

/**
 * Build the NIC e-Invoice IRN request JSON from a transaction.
 * This is the exact format the NIC portal expects for IRN generation.
 *
 * The user can download this JSON and submit it to:
 *   1. The NIC e-Invoice portal (https://einvoice.nic.in) manually
 *   2. A third-party API provider (like Masters India, Cleartax, etc.)
 *   3. The app's own NIC integration (when registered as a suvidha provider)
 *
 * Only B2B invoices (party has GSTIN) are eligible for e-Invoicing.
 * B2C invoices do NOT require IRN.
 */
export function buildIrnRequest(
  txn: EInvoiceTransaction,
  shop: EInvoiceShopInfo,
  originalInvoiceNo?: string,
  originalInvoiceDate?: Date,
): IRNRequest | null {
  // e-Invoicing is only for B2B (party must have GSTIN)
  if (!txn.partyGstin || txn.partyGstin.length < 15) return null
  if (!shop.gstin || shop.gstin.length < 15) return null

  // Determine document type
  const tranType = txn.type === 'credit-note' ? 'CRN'
    : txn.type === 'debit-note' ? 'DBN'
    : 'INV'
  const docType = tranType

  // Build item list
  const itemList: IRNRequest['ItemList'] = txn.items.map((item, i) => {
    const grossAmt = roundMoney(item.quantity * item.unitPrice)
    const assAmt = roundMoney(grossAmt - (item.discountAmount || 0))
    const totItemVal = roundMoney(assAmt + item.cgst + item.sgst + item.igst + (item.csamt || 0))
    return {
      SlNo: String(i + 1),
      PrdDesc: item.productName,
      HsnCd: item.hsn || '9999',
      Qty: roundMoney(item.quantity),
      Unit: mapUnitToNicUqc(item.unit),
      UnitPrice: roundMoney(item.unitPrice),
      TotAmt: grossAmt,
      Discount: roundMoney(item.discountAmount || 0),
      AssAmt: assAmt,
      GstRt: item.gstRate,
      IgstAmt: roundMoney(item.igst),
      CgstAmt: roundMoney(item.cgst),
      SgstAmt: roundMoney(item.sgst),
      CesRt: 0,
      CesAmt: roundMoney(item.csamt || 0),
      TotItemVal: totItemVal,
    }
  })

  // Build value details
  const assVal = roundMoney(txn.subtotal - txn.discountAmount)
  const rndOffAmt = roundMoney(txn.totalAmount - (assVal + txn.cgst + txn.sgst + txn.igst))

  // Build seller and buyer details
  const shopStateCode = shop.stateCode || deriveStateCode(null, null, shop.gstin, shop.state) || '00'
  const buyerStateCode = deriveStateCode(txn.partyGstin, txn.partyState, shop.gstin, shop.state) || '00'
  const pos = txn.isInterState ? buyerStateCode : shopStateCode

  const request: IRNRequest = {
    Version: '1.03',
    TranType: tranType,
    DocType: docType,
    DocDtls: {
      Typ: docType,
      No: txn.invoiceNo || txn.id,
      Dt: formatNicDate(txn.date),
    },
    SellerDtls: {
      Gstin: shop.gstin,
      LglNm: shop.shopName || shop.ownerName || 'Unknown',
      Addr1: shop.address || '',
      Loc: extractLocality(shop.address),
      Pin: extractPincode(shop.address),
      Stcd: shopStateCode,
      Ph: shop.phone || '',
      Em: shop.email || '',
    },
    BuyerDtls: {
      Gstin: txn.partyGstin,
      LglNm: txn.partyName || 'Unknown',
      Addr1: txn.partyAddress || '',
      Loc: extractLocality(txn.partyAddress),
      Pin: extractPincode(txn.partyAddress),
      Stcd: buyerStateCode,
      Ph: txn.partyPhone || '',
      Em: txn.partyEmail || '',
      Pos: pos,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: assVal,
      CgstVal: roundMoney(txn.cgst),
      SgstVal: roundMoney(txn.sgst),
      IgstVal: roundMoney(txn.igst),
      CesVal: 0,
      Discount: roundMoney(txn.discountAmount),
      OthChrg: 0,
      RndOffAmt: rndOffAmt,
      TotInvVal: roundMoney(txn.totalAmount),
      TotInvValFc: 0,
    },
    RefDtls: {
      // For credit notes/debit notes, reference the original invoice
      PrecDocDtls: originalInvoiceNo ? [{
        InvNo: originalInvoiceNo,
        InvDt: originalInvoiceDate ? formatNicDate(originalInvoiceDate) : '',
      }] : [],
    },
    EwbDtls: {
      Distance: 0,
      TransMode: '1',  // default: road
      VehNo: '',
    },
  }

  return request
}

// ─── IRN Validation ───────────────────────────────────────────────────────

/**
 * Validate an IRN (Invoice Reference Number).
 * Format: 64-character alphanumeric string (hex-like).
 * The NIC generates this by hashing the invoice data with a secret key.
 */
export function isValidIrn(irn: string): boolean {
  if (!irn) return false
  // IRN is 64 chars, alphanumeric (a-z, A-Z, 0-9)
  return /^[a-zA-Z0-9]{64}$/.test(irn)
}

/**
 * Validate an e-Way Bill number.
 * Format: 12-digit numeric string.
 */
export function isValidEwayBillNo(ewbNo: string): boolean {
  if (!ewbNo) return false
  return /^\d{12}$/.test(ewbNo)
}

/**
 * Decode a signed QR code string from the NIC.
 * The signed QR is a base64-encoded JSON containing:
 *   - AckNo (acknowledgement number)
 *   - AckDt (acknowledgement date)
 *   - Irn (invoice reference number)
 *   - SinedQR (the signed QR string itself)
 *
 * Note: the QR is digitally signed by NIC — we can decode the payload but
 * can't verify the signature without NIC's public key. This is a decode-only
 * function for display purposes.
 */
export function decodeSignedQR(signedQR: string): {
  ackNo?: string
  ackDt?: string
  irn?: string
  raw?: string
} | null {
  if (!signedQR) return null
  try {
    // The signed QR from NIC is typically a JWT-like string or base64 JSON
    // Try base64 decode first
    const decoded = atob(signedQR)
    const parsed = JSON.parse(decoded)
    return {
      ackNo: parsed.AckNo || parsed.ackNo,
      ackDt: parsed.AckDt || parsed.ackDt,
      irn: parsed.Irn || parsed.irn,
      raw: signedQR,
    }
  } catch {
    // Not base64 JSON — might be a JWT or raw string
    // Try splitting by '.' (JWT format)
    const parts = signedQR.split('.')
    if (parts.length >= 2) {
      try {
        const payload = JSON.parse(atob(parts[1]))
        return {
          ackNo: payload.AckNo,
          ackDt: payload.AckDt,
          irn: payload.Irn,
          raw: signedQR,
        }
      } catch {
        return { raw: signedQR }
      }
    }
    return { raw: signedQR }
  }
}

/**
 * Check if a transaction is eligible for e-Invoicing.
 * Rules (as of 2026):
 *   - Only B2B invoices (party has GSTIN)
 *   - Only sales and credit notes (not purchases, not expenses)
 *   - Shop must have a GSTIN
 *   - Turnover threshold: currently ₹5 crore+ (but we let the user decide)
 */
export function isEInvoiceEligible(
  txn: EInvoiceTransaction,
  shop: EInvoiceShopInfo,
): { eligible: boolean; reason?: string } {
  if (!shop.gstin || shop.gstin.length < 15) {
    return { eligible: false, reason: 'Shop GSTIN is not set. Go to Settings to configure.' }
  }
  if (!txn.partyGstin || txn.partyGstin.length < 15) {
    return { eligible: false, reason: 'Customer does not have a GSTIN (B2C invoice). e-Invoicing is only for B2B.' }
  }
  if (txn.type !== 'sale' && txn.type !== 'credit-note' && txn.type !== 'debit-note') {
    return { eligible: false, reason: `e-Invoicing is not applicable for ${txn.type} transactions.` }
  }
  return { eligible: true }
}

/**
 * Check if a transaction is eligible for e-Way Bill.
 * Rules:
 *   - Invoice value > ₹50,000
 *   - Party has a GSTIN (or is unregistered but inter-state)
 *   - Goods are being transported (not a service)
 */
export function isEwayBillEligible(
  txn: EInvoiceTransaction,
  shop: EInvoiceShopInfo,
): { eligible: boolean; reason?: string } {
  if (txn.totalAmount < 50000) {
    return { eligible: false, reason: 'Invoice value is less than ₹50,000. e-Way Bill is not required.' }
  }
  if (!shop.gstin || shop.gstin.length < 15) {
    return { eligible: false, reason: 'Shop GSTIN is not set.' }
  }
  if (txn.type !== 'sale' && txn.type !== 'purchase') {
    return { eligible: false, reason: `e-Way Bill is not applicable for ${txn.type} transactions.` }
  }
  return { eligible: true }
}
