/**
 * 🔒 V17 Audit Phase 3 — GSTR-1 builder tests.
 *
 * Pure-function tests for the GSTR-1 builder. No DB, no mocking.
 * Tests use REAL sign conventions (credit notes have positive totalAmount,
 * negative grossProfit — matching actual DB storage).
 *
 * Coverage:
 * - Each of the 8 sections (B2B, B2CL, B2CS, CDNR, CDNUR, HSN, NIL, DOC)
 * - Sign conventions (credit notes reduce HSN totals)
 * - State-code derivation (GSTIN prefix, state name fallback)
 * - Edge cases (empty data, null HSN, unregistered parties)
 * - Cross-path consistency (B2B + B2CL + B2CS + CDNR taxable == HSN taxable)
 */

import {
  buildB2B,
  buildB2CL,
  buildB2CS,
  buildCDNR,
  buildCDNUR,
  buildHSN,
  buildNIL,
  buildDOC,
  buildGstr1,
  type Gstr1Transaction,
  type Gstr1Item,
  type ShopInfo,
} from '@/lib/gstr1-builder'
import { stateNameToCode, deriveStateCode } from '@/lib/gst'
import { roundMoney } from '@/lib/money'

// ─── Test fixtures ────────────────────────────────────────────────────────

const SHOP: ShopInfo = {
  gstin: '27ABCDE1234F1Z5',
  state: 'Maharashtra',
  stateCode: '27',
}

const SALE_ITEM_18: Gstr1Item = {
  productId: 'p1', productName: 'Rice 1kg', hsn: '1006',
  quantity: 20, unit: 'kg', unitPrice: 50, gstRate: 18,
  discountAmount: 0, cgst: 90, sgst: 90, igst: 0, csamt: 0,
}

const SALE_ITEM_5: Gstr1Item = {
  productId: 'p2', productName: 'Sugar 1kg', hsn: '1701',
  quantity: 5, unit: 'kg', unitPrice: 40, gstRate: 5,
  discountAmount: 0, cgst: 10, sgst: 10, igst: 0, csamt: 0,
}

const SALE_ITEM_0: Gstr1Item = {
  productId: 'p3', productName: 'Unbranded Rice', hsn: '1006',
  quantity: 2, unit: 'kg', unitPrice: 30, gstRate: 0,
  discountAmount: 0, cgst: 0, sgst: 0, igst: 0, csamt: 0,
}

const B2B_SALE: Gstr1Transaction = {
  id: 't1', type: 'sale', invoiceNo: 'INV-001', date: new Date('2026-07-15'),
  totalAmount: 1180, subtotal: 1000, discountAmount: 0,
  cgst: 90, sgst: 90, igst: 0, isInterState: false, isReverseCharge: false,
  partyId: 'party1', partyName: 'Rahul Traders', partyGstin: '27AAAPL1234C1Z5', partyState: 'Maharashtra',
  items: [SALE_ITEM_18],
}

const B2C_SALE: Gstr1Transaction = {
  id: 't2', type: 'sale', invoiceNo: 'INV-002', date: new Date('2026-07-16'),
  totalAmount: 210, subtotal: 200, discountAmount: 0,
  cgst: 5, sgst: 5, igst: 0, isInterState: false, isReverseCharge: false,
  partyId: null, partyName: null, partyGstin: null, partyState: null,
  items: [SALE_ITEM_5],
}

const CREDIT_NOTE: Gstr1Transaction = {
  id: 't3', type: 'credit-note', invoiceNo: 'CN-001', date: new Date('2026-07-17'),
  totalAmount: 354, subtotal: 300, discountAmount: 0,
  cgst: 27, sgst: 27, igst: 0, isInterState: false, isReverseCharge: false,
  partyId: 'party1', partyName: 'Rahul Traders', partyGstin: '27AAAPL1234C1Z5', partyState: 'Maharashtra',
  items: [{ ...SALE_ITEM_18, quantity: 6, cgst: 27, sgst: 27 }],
}

// ─── State code helpers ───────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — State code derivation', () => {
  test('stateNameToCode: Maharashtra → 27', () => {
    expect(stateNameToCode('Maharashtra')).toBe('27')
  })

  test('stateNameToCode: case-insensitive', () => {
    expect(stateNameToCode('GUJARAT')).toBe('24')
    expect(stateNameToCode('delhi')).toBe('07')
  })

  test('stateNameToCode: null/undefined → null', () => {
    expect(stateNameToCode(null)).toBeNull()
    expect(stateNameToCode(undefined)).toBeNull()
    expect(stateNameToCode('')).toBeNull()
  })

  test('stateNameToCode: unknown state → null', () => {
    expect(stateNameToCode('Unknown State')).toBeNull()
  })

  test('deriveStateCode: party GSTIN prefix takes priority', () => {
    expect(deriveStateCode('27AAAPL1234C1Z5', 'Delhi', '24ABCDE', 'Gujarat')).toBe('27')
  })

  test('deriveStateCode: falls back to party state name', () => {
    expect(deriveStateCode(null, 'Karnataka', '27ABCDE', 'Maharashtra')).toBe('29')
  })

  test('deriveStateCode: falls back to shop GSTIN for walk-in', () => {
    expect(deriveStateCode(null, null, '27ABCDE', 'Maharashtra')).toBe('27')
  })

  test('deriveStateCode: falls back to shop state name', () => {
    expect(deriveStateCode(null, null, null, 'Tamil Nadu')).toBe('33')
  })

  test('deriveStateCode: returns null when nothing derivable', () => {
    expect(deriveStateCode(null, null, null, null)).toBeNull()
  })

  test('deriveStateCode: handles short/invalid GSTINs', () => {
    expect(deriveStateCode('A', null, null, 'Delhi')).toBe('07')  // invalid GSTIN → state name
    expect(deriveStateCode('AB', null, null, 'Delhi')).toBe('07') // non-numeric prefix → state name
  })
})

// ─── B2B ──────────────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — B2B section', () => {
  test('groups by counter-party GSTIN', () => {
    const result = buildB2B([B2B_SALE], SHOP)
    expect(result).toHaveLength(1)
    expect(result[0].ctin).toBe('27AAAPL1234C1Z5')
    expect(result[0].inv).toHaveLength(1)
  })

  test('excludes sales without party GSTIN (walk-in)', () => {
    const result = buildB2B([B2C_SALE], SHOP)
    expect(result).toHaveLength(0)
  })

  test('excludes credit notes (those go to CDNR)', () => {
    const result = buildB2B([CREDIT_NOTE], SHOP)
    expect(result).toHaveLength(0)
  })

  test('invoice fields: inum, idt, val, pos, rchrg', () => {
    const result = buildB2B([B2B_SALE], SHOP)
    const inv = result[0].inv[0]
    expect(inv.inum).toBe('INV-001')
    expect(inv.val).toBe(1180)
    expect(inv.pos).toBe('27')
    expect(inv.rchrg).toBe('N')
    expect(inv.inv_typ).toBe('R')
  })

  test('date format: dd-mm-yyyy', () => {
    const result = buildB2B([B2B_SALE], SHOP)
    expect(result[0].inv[0].idt).toBe('15-07-2026')
  })

  test('empty input → empty array', () => {
    expect(buildB2B([], SHOP)).toHaveLength(0)
  })
})

// ─── B2CS ─────────────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — B2CS section', () => {
  test('aggregates by rate + POS', () => {
    const result = buildB2CS([B2C_SALE], SHOP)
    expect(result).toHaveLength(1)
    expect(result[0].rt).toBe(5)
    expect(result[0].pos).toBe('27')
  })

  test('excludes B2B sales (party has GSTIN)', () => {
    const result = buildB2CS([B2B_SALE], SHOP)
    expect(result).toHaveLength(0)
  })

  test('multiple items at same rate aggregate into one entry', () => {
    const multiItemSale: Gstr1Transaction = {
      ...B2C_SALE,
      items: [SALE_ITEM_5, { ...SALE_ITEM_5, quantity: 10 }],
    }
    const result = buildB2CS([multiItemSale], SHOP)
    expect(result).toHaveLength(1)
    // 5×40 + 10×40 = 600 taxable
    expect(result[0].txval).toBe(600)
  })

  test('empty input → empty array', () => {
    expect(buildB2CS([], SHOP)).toHaveLength(0)
  })
})

// ─── HSN ──────────────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — HSN section', () => {
  test('aggregates by HSN + rate', () => {
    const result = buildHSN([B2B_SALE, B2C_SALE])
    // B2B has HSN 1006 @ 18%, B2C has HSN 1701 @ 5%
    expect(result.data).toHaveLength(2)
  })

  test('credit notes REDUCE HSN totals (sign convention)', () => {
    const result = buildHSN([B2B_SALE, CREDIT_NOTE])
    // Both have HSN 1006 @ 18%. Sale = 20kg, CN = 6kg. Net = 14kg.
    const hsn1006 = result.data.find(d => d.hsn_sc === '1006')
    expect(hsn1006).toBeDefined()
    expect(hsn1006!.qty).toBe(14)  // 20 - 6
    expect(hsn1006!.txval).toBe(700)  // 1000 - 300
  })

  test('null HSN → defaults to "9999"', () => {
    const noHsnSale: Gstr1Transaction = {
      ...B2C_SALE,
      items: [{ ...SALE_ITEM_5, hsn: null }],
    }
    const result = buildHSN([noHsnSale])
    expect(result.data[0].hsn_sc).toBe('9999')
  })

  test('unit mapping: kg → KGS, pcs → PCS', () => {
    const result = buildHSN([B2B_SALE])
    expect(result.data[0].uqc).toBe('KGS')
  })

  test('empty input → empty array', () => {
    expect(buildHSN([]).data).toHaveLength(0)
  })
})

// ─── NIL ──────────────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — NIL section', () => {
  test('nil-rated = items with gstRate=0', () => {
    const saleWith0: Gstr1Transaction = {
      ...B2C_SALE,
      items: [SALE_ITEM_0],
    }
    const result = buildNIL([saleWith0])
    const nilEntry = result.inv.find(e => e.sply_ty === 'NIL')
    expect(nilEntry).toBeDefined()
    expect(nilEntry!.txval).toBe(60)  // 2 × 30
  })

  test('exempt and non-GST default to 0 (no gstTreatment UI yet for items)', () => {
    const result = buildNIL([B2B_SALE])
    const exemptEntry = result.inv.find(e => e.sply_ty === 'EXPT')
    const nonGstEntry = result.inv.find(e => e.sply_ty === 'NGST')
    expect(exemptEntry!.txval).toBe(0)
    expect(nonGstEntry!.txval).toBe(0)
  })

  test('always returns 3 entries (NIL, EXPT, NGST)', () => {
    const result = buildNIL([])
    expect(result.inv).toHaveLength(3)
  })
})

// ─── DOC ──────────────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — DOC section', () => {
  test('counts sales invoices', () => {
    const result = buildDOC([B2B_SALE, B2C_SALE])
    const invoiceDoc = result.doc_det.find(d => d.doc_num === 1)
    expect(invoiceDoc).toBeDefined()
    expect(invoiceDoc!.docs[0].totnum).toBe(2)
    expect(invoiceDoc!.docs[0].net_issue).toBe(2)
  })

  test('counts credit notes separately', () => {
    const result = buildDOC([B2B_SALE, CREDIT_NOTE])
    const cnDoc = result.doc_det.find(d => d.doc_num === 2)
    expect(cnDoc).toBeDefined()
    expect(cnDoc!.docs[0].totnum).toBe(1)
  })

  test('no sales → no doc_det', () => {
    expect(buildDOC([]).doc_det).toHaveLength(0)
  })
})

// ─── CDNR + CDNUR ─────────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — CDNR + CDNUR', () => {
  test('CDNR: credit notes with registered party (has GSTIN)', () => {
    const result = buildCDNR([CREDIT_NOTE], SHOP)
    expect(result).toHaveLength(1)
    expect(result[0].ctin).toBe('27AAAPL1234C1Z5')
    expect(result[0].nt[0].ntty).toBe('C')  // Credit note
  })

  test('CDNUR: credit notes with unregistered party (no GSTIN)', () => {
    const unregisteredCN: Gstr1Transaction = {
      ...CREDIT_NOTE,
      partyGstin: null,
    }
    const result = buildCDNUR([unregisteredCN], SHOP)
    expect(result).toHaveLength(1)
    expect(result[0].ntty).toBe('C')
  })

  test('empty input → empty arrays', () => {
    expect(buildCDNR([], SHOP)).toHaveLength(0)
    expect(buildCDNUR([], SHOP)).toHaveLength(0)
  })
})

// ─── Full buildGstr1 ──────────────────────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — Full GSTR-1 build', () => {
  test('assembles all 8 sections', () => {
    const result = buildGstr1([B2B_SALE, B2C_SALE, CREDIT_NOTE], SHOP, '072026')
    expect(result.gstin).toBe('27ABCDE1234F1Z5')
    expect(result.fp).toBe('072026')
    expect(result.b2b).toHaveLength(1)
    expect(result.b2cs).toHaveLength(1)
    expect(result.cdnr).toHaveLength(1)
    expect(result.hsn.data.length).toBeGreaterThan(0)
    expect(result.nil.inv).toHaveLength(3)
    expect(result.doc_issue.doc_det.length).toBeGreaterThan(0)
  })

  test('empty transactions → all sections empty but structure intact', () => {
    const result = buildGstr1([], SHOP, '072026')
    expect(result.b2b).toHaveLength(0)
    expect(result.b2cl).toHaveLength(0)
    expect(result.b2cs).toHaveLength(0)
    expect(result.cdnr).toHaveLength(0)
    expect(result.cdnur).toHaveLength(0)
    expect(result.hsn.data).toHaveLength(0)
    expect(result.nil.inv).toHaveLength(3)  // always 3 (NIL, EXPT, NGST)
    expect(result.doc_issue.doc_det).toHaveLength(0)
  })
})

// ─── Cross-path consistency (tie-out) ─────────────────────────────────────

describe('🔒 V17 Audit Phase 3 — Cross-path consistency', () => {
  test('B2B + B2CS + CDNR taxable values are consistent with HSN', () => {
    const txns = [B2B_SALE, B2C_SALE, CREDIT_NOTE]
    const result = buildGstr1(txns, SHOP, '072026')

    // HSN total taxable = sale taxable - credit note taxable
    // B2B: 1000 (Rice @ 18%), B2C: 200 (Sugar @ 5%), CN: -300 (Rice @ 18% return)
    // HSN 1006 @ 18%: 1000 - 300 = 700
    // HSN 1701 @ 5%: 200
    // Total HSN = 900

    const hsnTotal = result.hsn.data.reduce((s, e) => s + e.txval, 0)
    expect(hsnTotal).toBe(900)  // 700 + 200

    // B2B taxable (one invoice: 1000)
    const b2bTotal = result.b2b.reduce((s, e) =>
      s + e.inv.reduce((ss, i) => ss + i.itms.reduce((sss, item) => sss + item.txval, 0), 0), 0)
    expect(b2bTotal).toBe(1000)

    // B2CS taxable (one entry: 200)
    const b2csTotal = result.b2cs.reduce((s, e) => s + e.txval, 0)
    expect(b2csTotal).toBe(200)

    // CDNR taxable (one note: 300)
    const cdnrTotal = result.cdnr.reduce((s, e) =>
      s + e.nt.reduce((ss, n) => ss + n.itms.reduce((sss, item) => sss + item.txval, 0), 0), 0)
    expect(cdnrTotal).toBe(300)

    // HSN total = B2B + B2CS - CDNR (credit notes reduce)
    expect(hsnTotal).toBe(roundMoney(b2bTotal + b2csTotal - cdnrTotal))
  })
})
