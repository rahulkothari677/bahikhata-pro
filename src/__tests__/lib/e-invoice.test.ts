/**
 * 🔒 V17 Audit Phase 5 — e-Invoicing tests.
 *
 * Tests the IRN request builder, IRN validation, QR decoding, and eligibility checks.
 * Pure-function tests — no DB, no network.
 */

import {
  buildIrnRequest,
  isValidIrn,
  isValidEwayBillNo,
  decodeSignedQR,
  isEInvoiceEligible,
  isEwayBillEligible,
  type EInvoiceTransaction,
  type EInvoiceShopInfo,
} from '@/lib/e-invoice'
import { roundMoney } from '@/lib/money'

// ─── Fixtures ─────────────────────────────────────────────────────────────

const SHOP: EInvoiceShopInfo = {
  gstin: '27ABCDE1234F1Z5',
  state: 'Maharashtra',
  stateCode: '27',
  shopName: 'My Shop',
  ownerName: 'Rahul',
  address: '123 Main St, Mumbai, 400001',
  phone: '9876543210',
  email: 'shop@test.com',
}

const B2B_SALE: EInvoiceTransaction = {
  id: 't1', type: 'sale', invoiceNo: 'INV-001', date: new Date('2026-07-15'),
  totalAmount: 1180, subtotal: 1000, discountAmount: 0,
  cgst: 90, sgst: 90, igst: 0, isInterState: false, isReverseCharge: false,
  partyName: 'Rahul Traders', partyGstin: '27AAAPL1234C1Z5', partyState: 'Maharashtra',
  partyAddress: '456 Business Rd, Pune, 411001', partyPhone: '9123456789', partyEmail: 'rahul@test.com',
  items: [{
    productName: 'Rice 1kg', hsn: '1006', quantity: 20, unit: 'kg', unitPrice: 50,
    gstRate: 18, discountAmount: 0, cgst: 90, sgst: 90, igst: 0, csamt: 0,
  }],
}

const B2C_SALE: EInvoiceTransaction = {
  ...B2B_SALE,
  partyGstin: null,  // walk-in customer — no GSTIN
}

// ─── IRN Validation ───────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 5 — IRN validation', () => {
  test('valid 64-char alphanumeric IRN', () => {
    const irn = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2'
    expect(isValidIrn(irn)).toBe(true)
  })

  test('rejects short IRN (63 chars)', () => {
    expect(isValidIrn('A1B2C3D4E5F6'.repeat(5) + 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3')).toBe(false)
  })

  test('rejects IRN with special characters', () => {
    expect(isValidIrn('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6!@#$')).toBe(false)
  })

  test('rejects empty/null/undefined', () => {
    expect(isValidIrn('')).toBe(false)
    expect(isValidIrn(null as any)).toBe(false)
    expect(isValidIrn(undefined as any)).toBe(false)
  })
})

// ─── e-Way Bill Validation ────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 5 — e-Way Bill validation', () => {
  test('valid 12-digit number', () => {
    expect(isValidEwayBillNo('123456789012')).toBe(true)
  })

  test('rejects short number', () => {
    expect(isValidEwayBillNo('12345678901')).toBe(false)
  })

  test('rejects non-numeric', () => {
    expect(isValidEwayBillNo('12345678901A')).toBe(false)
  })

  test('rejects empty', () => {
    expect(isValidEwayBillNo('')).toBe(false)
  })
})

// ─── Eligibility ──────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 5 — e-Invoice eligibility', () => {
  test('B2B sale with GSTIN → eligible', () => {
    const result = isEInvoiceEligible(B2B_SALE, SHOP)
    expect(result.eligible).toBe(true)
  })

  test('B2C sale (no party GSTIN) → not eligible', () => {
    const result = isEInvoiceEligible(B2C_SALE, SHOP)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('GSTIN')
  })

  test('no shop GSTIN → not eligible', () => {
    const result = isEInvoiceEligible(B2B_SALE, { ...SHOP, gstin: null })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('Shop GSTIN')
  })

  test('purchase transaction → not eligible', () => {
    const result = isEInvoiceEligible({ ...B2B_SALE, type: 'purchase' }, SHOP)
    expect(result.eligible).toBe(false)
  })

  test('expense → not eligible', () => {
    const result = isEInvoiceEligible({ ...B2B_SALE, type: 'expense' }, SHOP)
    expect(result.eligible).toBe(false)
  })

  test('credit note with GSTIN → eligible', () => {
    const result = isEInvoiceEligible({ ...B2B_SALE, type: 'credit-note' }, SHOP)
    expect(result.eligible).toBe(true)
  })
})

describe('🔒 V17 Audit Phase 5 — e-Way Bill eligibility', () => {
  test('sale > ₹50,000 → eligible', () => {
    const result = isEwayBillEligible({ ...B2B_SALE, totalAmount: 60000 }, SHOP)
    expect(result.eligible).toBe(true)
  })

  test('sale < ₹50,000 → not eligible', () => {
    const result = isEwayBillEligible(B2B_SALE, SHOP)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('50,000')
  })

  test('credit note → not eligible', () => {
    const result = isEwayBillEligible({ ...B2B_SALE, totalAmount: 60000, type: 'credit-note' }, SHOP)
    expect(result.eligible).toBe(false)
  })
})

// ─── IRN Request Builder ──────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 5 — IRN request builder', () => {
  test('builds valid IRN request for B2B sale', () => {
    const request = buildIrnRequest(B2B_SALE, SHOP)
    expect(request).not.toBeNull()
    expect(request!.Version).toBe('1.03')
    expect(request!.TranType).toBe('INV')
    expect(request!.DocDtls.No).toBe('INV-001')
    expect(request!.SellerDtls.Gstin).toBe('27ABCDE1234F1Z5')
    expect(request!.BuyerDtls.Gstin).toBe('27AAAPL1234C1Z5')
  })

  test('returns null for B2C sale (no party GSTIN)', () => {
    const request = buildIrnRequest(B2C_SALE, SHOP)
    expect(request).toBeNull()
  })

  test('returns null for missing shop GSTIN', () => {
    const request = buildIrnRequest(B2B_SALE, { ...SHOP, gstin: null })
    expect(request).toBeNull()
  })

  test('credit note → TranType = CRN', () => {
    const request = buildIrnRequest({ ...B2B_SALE, type: 'credit-note' }, SHOP)
    expect(request!.TranType).toBe('CRN')
    expect(request!.DocType).toBe('CRN')
  })

  test('item list: HSN, quantity, unit price, GST', () => {
    const request = buildIrnRequest(B2B_SALE, SHOP)
    expect(request!.ItemList).toHaveLength(1)
    const item = request!.ItemList[0]
    expect(item.HsnCd).toBe('1006')
    expect(item.Qty).toBe(20)
    expect(item.UnitPrice).toBe(50)
    expect(item.GstRt).toBe(18)
    expect(item.AssAmt).toBe(1000)  // 20 × 50 - 0
    expect(item.CgstAmt).toBe(90)
    expect(item.SgstAmt).toBe(90)
  })

  test('value details: assessable, CGST, SGST, total', () => {
    const request = buildIrnRequest(B2B_SALE, SHOP)
    expect(request!.ValDtls.AssVal).toBe(1000)
    expect(request!.ValDtls.CgstVal).toBe(90)
    expect(request!.ValDtls.SgstVal).toBe(90)
    expect(request!.ValDtls.IgstVal).toBe(0)
    expect(request!.ValDtls.TotInvVal).toBe(1180)
  })

  test('POS (place of supply): intra-state → shop state code', () => {
    const request = buildIrnRequest(B2B_SALE, SHOP)
    expect(request!.BuyerDtls.Pos).toBe('27')  // Maharashtra
  })

  test('date format: dd/mm/yyyy', () => {
    const request = buildIrnRequest(B2B_SALE, SHOP)
    expect(request!.DocDtls.Dt).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  test('unit mapping: kg → KGS', () => {
    const request = buildIrnRequest(B2B_SALE, SHOP)
    expect(request!.ItemList[0].Unit).toBe('KGS')
  })

  test('null HSN → defaults to 9999', () => {
    const txnNoHsn = { ...B2B_SALE, items: [{ ...B2B_SALE.items[0], hsn: null }] }
    const request = buildIrnRequest(txnNoHsn, SHOP)
    expect(request!.ItemList[0].HsnCd).toBe('9999')
  })

  test('pincode extraction from address', () => {
    const request = buildIrnRequest(B2B_SALE, SHOP)
    expect(request!.SellerDtls.Pin).toBe(400001)
    expect(request!.BuyerDtls.Pin).toBe(411001)
  })
})

// ─── QR Decoding ──────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 5 — Signed QR decoding', () => {
  test('decodes base64 JSON QR', () => {
    const payload = { AckNo: '12345', AckDt: '2026-07-15 15:30', Irn: 'ABC123' }
    const encoded = btoa(JSON.stringify(payload))
    const result = decodeSignedQR(encoded)
    expect(result).not.toBeNull()
    expect(result!.ackNo).toBe('12345')
    expect(result!.irn).toBe('ABC123')
  })

  test('returns raw string for unparseable QR', () => {
    const result = decodeSignedQR('not-a-valid-qr')
    expect(result).not.toBeNull()
    expect(result!.raw).toBe('not-a-valid-qr')
  })

  test('returns null for empty/null', () => {
    expect(decodeSignedQR('')).toBeNull()
    expect(decodeSignedQR(null as any)).toBeNull()
  })
})
