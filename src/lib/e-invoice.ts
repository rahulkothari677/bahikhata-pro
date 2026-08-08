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
 * The IRN request JSON follows the NIC e-Invoice schema (v1.1):
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
  /*
   * TranDtls — MANDATORY, and it was missing entirely.
   *
   * Verified against the NIC schema (v1.1) and against this app's own live
   * output on 2026-08-08: the generated payload carried `TranType` and
   * `DocType` at the top level instead, and neither is a NIC field. The portal
   * requires TranDtls, so every IRN request this app has ever produced would
   * have been rejected on upload — the invoice type was being stated in a
   * shape the portal does not read.
   */
  TranDtls: {
    TaxSch: 'GST'
    /** B2B | SEZWP | SEZWOP | EXPWP | EXPWOP | DEXP */
    SupTyp: string
    /** 'Y' when the tax is payable by the recipient under reverse charge. */
    RegRev: 'Y' | 'N'
    /** 'Y' only for the rare intra-state supply that carries IGST. */
    IgstOnIntra: 'Y' | 'N'
  }
  DocDtls: {
    Typ: string     // 'INV' | 'CRN' | 'DBN'
    No: string      // invoice number
    Dt: string      // dd/mm/yyyy
  }
  SellerDtls: {
    Gstin: string
    LglNm: string
    /** Trade name. Present in the NIC schema; was omitted. */
    TrdNm: string
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
    /** Trade name. Present in the NIC schema; was omitted. */
    TrdNm: string
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
    /**
     * Is this a service? Mandatory per the NIC schema and previously absent.
     * Derived from the code on the line: SAC codes begin with 99 (Chapter 99 is
     * services), goods occupy chapters 01-98. See the builder for why this is
     * derived rather than hardcoded.
     */
    IsServc: 'Y' | 'N'
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

  /*
   * HSN is MANDATORY in the NIC e-invoice schema, so refuse to build a request
   * without it rather than substitute a placeholder.
   *
   * WAS: `item.hsn || '9999'` inside the item mapping. 9999 is a SERVICES code
   * (SAC 9999xx); goods submitted under it are misdeclared. The portal
   * validates HSN against its master, so the realistic outcome was a rejected
   * submission with an opaque government error — while the shopkeeper stood at
   * the counter with a customer's goods and no idea that a missing product code
   * was the cause.
   *
   * Naming the products is the whole value of failing here: "Tata Tea Gold
   * needs an HSN code" is something a shopkeeper can act on in thirty seconds.
   */
  const missingHsn = txn.items.filter((i) => !i.hsn || !String(i.hsn).trim())
  if (missingHsn.length > 0) {
    const names = [...new Set(missingHsn.map((i) => i.productName))].join(', ')
    throw new Error(
      `Cannot generate an e-invoice: HSN code is required for every item, and these have none — ${names}. ` +
      'Add the HSN code on each product, then try again.',
    )
  }

  // Build item list
  const itemList: IRNRequest['ItemList'] = txn.items.map((item, i) => {
    const grossAmt = roundMoney(item.quantity * item.unitPrice)
    const assAmt = roundMoney(grossAmt - (item.discountAmount || 0))
    const totItemVal = roundMoney(assAmt + item.cgst + item.sgst + item.igst + (item.csamt || 0))
    return {
      SlNo: String(i + 1),
      PrdDesc: item.productName,
      /*
       * Service or goods, derived from the code the shopkeeper already entered.
       *
       * CORRECTED 2026-08-08. I first hardcoded 'N', reasoning that the app had
       * no service catalogue. It does: the product field is labelled "HSN/SAC
       * Code" and the summary reports "HSN/SAC-wise", so a salon, repair shop
       * or consultant has always been able to use this app — and every
       * e-invoice they raised would have declared their service as goods.
       *
       * The rule needs no new field and no question. Every SAC code begins with
       * 99 (services sit in Chapter 99 of the GST tariff); goods occupy
       * chapters 01 to 98. So the code already on the line answers it.
       *
       * This is what "a ledger for every kind of shop" costs if you assume the
       * shop is a kirana: the assumption is invisible in the code and shows up
       * on someone's tax document.
       */
      IsServc: String(item.hsn).trim().startsWith('99') ? 'Y' : 'N',
      HsnCd: String(item.hsn).trim(),  // guaranteed present by the check above
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
      // 🔒 AUDIT G6: CesRt is 0 because this app has no cess RATE field —
      // TransactionItem stores `csamt` (the amount) but nothing to divide it by.
      //
      // NIC validates CesAmt against CesRt × AssAmt, so a non-zero CesAmt with
      // CesRt 0 is a guaranteed rejection with an opaque error. That is NOT
      // reachable today: nothing in the app writes a non-zero csamt (there is
      // no cess input anywhere in the UI), so both fields are always 0 and the
      // payload is valid.
      //
      // IF CESS IS EVER ADDED: a `cessRate` column must land on TransactionItem
      // at the same time and be sent here. Shipping the amount without the rate
      // would break IRN generation for every invoice carrying cess. Flagged
      // rather than silently left, because "csamt exists so cess must work" is
      // an easy and expensive assumption to make later.
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
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      /*
       * SupTyp is B2B for everything this app can produce.
       *
       * The other values — SEZWP, SEZWOP, EXPWP, EXPWOP, DEXP — describe SEZ
       * supplies, exports and deemed exports. None is representable here: the
       * app has no export flag, no shipping-bill fields and no SEZ marker, and
       * e-invoicing is already restricted to parties with a GSTIN above. Stating
       * B2B is therefore accurate for every invoice that reaches this line, not
       * a default standing in for something unknown. If exports are added, this
       * must become a real decision and the export block (ExpDtls) with it.
       */
      SupTyp: 'B2B',
      /*
       * The reverse-charge flag finally has somewhere to go.
       *
       * Transaction.isReverseCharge was made settable earlier in this work after
       * turning out to be readable by GSTR-3B and writable by nothing. It was
       * still absent from the IRN payload, so an invoice the shop had correctly
       * marked as reverse-charge would have been signed as an ordinary one —
       * the government's copy contradicting the return.
       */
      RegRev: txn.isReverseCharge ? 'Y' : 'N',
      /*
       * IgstOnIntra is 'Y' only for the rare intra-state supply that carries
       * IGST. computeLineItems charges CGST+SGST for every intra-state sale, so
       * that case cannot arise here — and claiming 'Y' would contradict the tax
       * amounts in the same payload.
       */
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: docType,
      No: txn.invoiceNo || txn.id,
      Dt: formatNicDate(txn.date),
    },
    SellerDtls: {
      Gstin: shop.gstin,
      LglNm: shop.shopName || shop.ownerName || 'Unknown',
      // Trade name. A kirana trades under its shop name, so the two coincide —
      // stated explicitly because the field is in the schema and was absent.
      TrdNm: shop.shopName || shop.ownerName || 'Unknown',
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
      // The app records one name per party, so legal and trade name coincide.
      TrdNm: txn.partyName || 'Unknown',
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
      // 🔒 AUDIT G5: this MUST be 0 — the discount is already inside AssVal.
      //
      // WAS: `roundMoney(txn.discountAmount)`, which double-counted it.
      //
      // In this app the order-level discount is DISTRIBUTED across line items
      // (see distributeDiscountProportionally), so each item already carries
      // its share in `Discount` and has it removed from `AssAmt`. AssVal is the
      // sum of those AssAmt values, i.e. ALREADY net of the discount.
      //
      // NIC validates the invoice total as
      //     TotInvVal = AssVal + taxes + OthChrg − Discount + RndOffAmt
      // so repeating the discount here subtracts it a second time:
      //     NIC expects : subtotal − 2×discount + taxes + roundOff
      //     we send     : subtotal −   discount + taxes + roundOff   (TotInvVal)
      // The two disagree by exactly the discount, and the portal rejects the
      // payload with a total-mismatch error. Every B2B invoice carrying ANY
      // discount would have failed IRN generation — a hard block on invoicing
      // that B2B customer, not a silent wrong number.
      //
      // ValDtls.Discount is for an invoice-level discount applied ON TOP of
      // item-level ones. This app has no such concept: the single discount the
      // UI collects is always pushed down to the items. So 0 is not a
      // simplification, it is the correct value.
      //
      // Verified by the identity: TotInvVal − (AssVal + taxes) === RndOffAmt,
      // which holds only when Discount is 0. Pinned in
      // audit-g5-einvoice-valdtls.test.ts.
      Discount: 0,
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
