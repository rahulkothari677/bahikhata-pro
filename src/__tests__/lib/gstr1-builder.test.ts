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
import { stateNameToCode, deriveStateCode } from '@/lib/gst-states'
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
  test('nil-rated = items with gstRate=0, classified by supply type', () => {
    const saleWith0: Gstr1Transaction = {
      ...B2C_SALE,  // B2C_SALE is intra-state, unregistered (no GSTIN) → INTRAB2C
      items: [SALE_ITEM_0],
    }
    const result = buildNIL([saleWith0])
    // Should have 1 entry: INTRAB2C with nil_amt = 60 (2 × 30)
    expect(result.inv).toHaveLength(1)
    expect(result.inv[0].sply_ty).toBe('INTRAB2C')
    expect(result.inv[0].nil_amt).toBe(60)
    expect(result.inv[0].expt_amt).toBe(0)
    expect(result.inv[0].ngsup_amt).toBe(0)
  })

  test('B2B nil-rated sale → INTRAB2B supply type', () => {
    const b2bSaleWith0: Gstr1Transaction = {
      ...B2B_SALE,  // B2B_SALE is intra-state, registered (has GSTIN) → INTRAB2B
      items: [SALE_ITEM_0],
    }
    const result = buildNIL([b2bSaleWith0])
    expect(result.inv).toHaveLength(1)
    expect(result.inv[0].sply_ty).toBe('INTRAB2B')
    expect(result.inv[0].nil_amt).toBe(60)
  })

  test('inter-state nil-rated sale → INTRB2C or INTRB2B', () => {
    const interStateB2C: Gstr1Transaction = {
      ...B2C_SALE,
      isInterState: true,
      partyState: 'Gujarat',
      items: [SALE_ITEM_0],
    }
    const result = buildNIL([interStateB2C])
    expect(result.inv).toHaveLength(1)
    expect(result.inv[0].sply_ty).toBe('INTRB2C')
    expect(result.inv[0].nil_amt).toBe(60)
  })

  test('exempt and non-GST default to 0 (no gstTreatment tracking yet)', () => {
    const result = buildNIL([B2B_SALE])
    // B2B_SALE has gstRate=18, so nil_amt=0 → no entry emitted
    expect(result.inv).toHaveLength(0)
  })

  test('empty input → empty inv array (not 3 dummy entries)', () => {
    const result = buildNIL([])
    expect(result.inv).toHaveLength(0)
  })

  test('multiple supply types for same nil-rated amount → separate entries', () => {
    const intraB2C: Gstr1Transaction = {
      ...B2C_SALE,  // intra-state, unregistered → INTRAB2C
      items: [SALE_ITEM_0],
    }
    const interB2C: Gstr1Transaction = {
      ...B2C_SALE,
      isInterState: true, partyState: 'Gujarat',  // inter-state, unregistered → INTRB2C
      items: [SALE_ITEM_0],
    }
    const result = buildNIL([intraB2C, interB2C])
    expect(result.inv).toHaveLength(2)
    const supplyTypes = result.inv.map(e => e.sply_ty).sort()
    expect(supplyTypes).toEqual(['INTRAB2C', 'INTRB2C'])
    // Each has nil_amt = 60
    expect(result.inv[0].nil_amt).toBe(60)
    expect(result.inv[1].nil_amt).toBe(60)
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

  test('CDNUR: credit notes with unregistered party (no GSTIN) — inter-state B2CL only', () => {
    // 🔒 V26 N2: CDNUR is now restricted to inter-state B2CL originals (>₹1L).
    // An intra-state unregistered note goes to B2CS netting, not CDNUR.
    const unregisteredB2clCN: Gstr1Transaction = {
      ...CREDIT_NOTE,
      partyGstin: null,
      partyState: 'Gujarat',
      isInterState: true,
      totalAmount: 200000,  // > ₹1L threshold → qualifies for CDNUR
    }
    const result = buildCDNUR([unregisteredB2clCN], SHOP)
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
    // 🔒 V26 BUG-059: nil section now uses supply-type buckets, not 3 dummy entries.
    // B2B_SALE + B2C_SALE have gstRate=18/5, so no nil-rated items → 0 entries.
    expect(result.nil.inv).toHaveLength(0)
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
    expect(result.nil.inv).toHaveLength(0)  // V26 BUG-059: no nil-rated items → 0 entries (was always 3 dummy)
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
      s + e.inv.reduce((ss, i) => ss + i.itms.reduce((sss, item) => sss + item.itm_det.txval, 0), 0), 0)
    expect(b2bTotal).toBe(1000)

    // B2CS taxable (one entry: 200)
    const b2csTotal = result.b2cs.reduce((s, e) => s + e.txval, 0)
    expect(b2csTotal).toBe(200)

    // CDNR taxable (one note: 300)
    const cdnrTotal = result.cdnr.reduce((s, e) =>
      s + e.nt.reduce((ss, n) => ss + n.itms.reduce((sss, item) => sss + item.itm_det.txval, 0), 0), 0)
    expect(cdnrTotal).toBe(300)

    // HSN total = B2B + B2CS - CDNR (credit notes reduce)
    expect(hsnTotal).toBe(roundMoney(b2bTotal + b2csTotal - cdnrTotal))
  })
})

// ─── V26 N1: GSTR-1 itms must be { num, itm_det: {…} } per GSTN schema ──

describe('🔒 V26 N1 — GSTR-1 itms wrapped in { num, itm_det }', () => {
  test('B2B: each line is { num, itm_det: {rt, txval, iamt, camt, samt, csamt} }', () => {
    const result = buildB2B([B2B_SALE], SHOP)
    const itms = result[0].inv[0].itms
    expect(itms).toHaveLength(1)
    expect(itms[0]).toEqual({
      num: 1,
      itm_det: {
        rt: 18,
        txval: 1000,  // 20 × 50
        iamt: 0,
        camt: 90,
        samt: 90,
        csamt: 0,
      },
    })
  })

  test('B2B: multi-item invoice gets 1-based serial num', () => {
    const multiItemSale: Gstr1Transaction = {
      ...B2B_SALE,
      items: [SALE_ITEM_18, SALE_ITEM_5],
    }
    const result = buildB2B([multiItemSale], SHOP)
    const itms = result[0].inv[0].itms
    expect(itms).toHaveLength(2)
    expect(itms[0].num).toBe(1)
    expect(itms[1].num).toBe(2)
  })

  test('B2CL: itm_det carries only {rt, txval, iamt, csamt} (no camt/samt)', () => {
    const b2clSale: Gstr1Transaction = {
      id: 'b2cl1', type: 'sale', invoiceNo: 'INV-B2CL', date: new Date('2026-07-15'),
      totalAmount: 200000, subtotal: 169492, discountAmount: 0,
      cgst: 0, sgst: 0, igst: 30508, isInterState: true, isReverseCharge: false,
      partyId: null, partyName: 'Walk-in Customer', partyGstin: null, partyState: 'Gujarat',
      items: [{
        productId: 'p1', productName: 'Bulk Order', hsn: '1006',
        quantity: 100, unit: 'kg', unitPrice: 1694.92, gstRate: 18,
        discountAmount: 0, cgst: 0, sgst: 0, igst: 30508, csamt: 0,
      }],
    }
    const result = buildB2CL([b2clSale], SHOP)
    expect(result).toHaveLength(1)
    const itms = result[0].inv[0].itms
    expect(itms).toHaveLength(1)
    expect(itms[0].num).toBe(1)
    // camt and samt must NOT be present in B2CL itm_det (inter-state → IGST only)
    expect(itms[0].itm_det).not.toHaveProperty('camt')
    expect(itms[0].itm_det).not.toHaveProperty('samt')
    expect(itms[0].itm_det).toEqual({
      rt: 18,
      txval: expect.any(Number),
      iamt: expect.any(Number),
      csamt: 0,
    })
  })

  test('CDNR: each line is { num, itm_det: {…} } with full GST breakdown', () => {
    const result = buildCDNR([CREDIT_NOTE], SHOP)
    const itms = result[0].nt[0].itms
    expect(itms).toHaveLength(1)
    expect(itms[0].num).toBe(1)
    expect(itms[0].itm_det).toEqual({
      rt: 18,
      txval: 300,  // 6 × 50
      iamt: 0,
      camt: 27,
      samt: 27,
      csamt: 0,
    })
  })

  test('CDNUR: each line is { num, itm_det: {…} } (when present)', () => {
    // Inter-state B2CL credit note (qualifies for CDNUR after V26 N2)
    const b2clCreditNote: Gstr1Transaction = {
      ...CREDIT_NOTE,
      partyGstin: null,
      partyState: 'Gujarat',
      isInterState: true,
      totalAmount: 200000,
      items: [{
        productId: 'p1', productName: 'Bulk Return', hsn: '1006',
        quantity: 100, unit: 'kg', unitPrice: 1694.92, gstRate: 18,
        discountAmount: 0, cgst: 0, sgst: 0, igst: 30508, csamt: 0,
      }],
    }
    const result = buildCDNUR([b2clCreditNote], SHOP)
    expect(result).toHaveLength(1)
    const itms = result[0].itms
    expect(itms).toHaveLength(1)
    expect(itms[0].num).toBe(1)
    expect(itms[0].itm_det).toEqual({
      rt: 18,
      txval: expect.any(Number),
      iamt: 30508,
      camt: 0,
      samt: 0,
      csamt: 0,
    })
  })

  test('B2CS: shape unchanged (flat rate-aggregated array, no per-invoice itms)', () => {
    // B2CS is correctly flat — confirm we didn't accidentally wrap it.
    const result = buildB2CS([B2C_SALE], SHOP)
    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('itms')
    expect(result[0]).toHaveProperty('rt')
    expect(result[0]).toHaveProperty('txval')
  })
})

// ─── V26 N2: B2C credit notes net into B2CS; CDNUR restricted to B2CL ───

describe('🔒 V26 N2 — B2C credit notes: B2CS netting + CDNUR filter', () => {
  test('intra-state unregistered sale + credit note → B2CS is NETTED, CDNUR empty', () => {
    // Worked example from the audit: ₹10,000 sale @ 18% intra-state to walk-in
    // customer; later ₹2,000 credit note (return) to the same customer.
    const sale: Gstr1Transaction = {
      id: 's1', type: 'sale', invoiceNo: 'INV-WALK', date: new Date('2026-07-10'),
      totalAmount: 11800, subtotal: 10000, discountAmount: 0,
      cgst: 900, sgst: 900, igst: 0, isInterState: false, isReverseCharge: false,
      partyId: null, partyName: 'Walk-in', partyGstin: null, partyState: null,
      items: [{
        productId: 'p1', productName: 'Goods', hsn: '1006',
        quantity: 10, unit: 'kg', unitPrice: 1000, gstRate: 18,
        discountAmount: 0, cgst: 900, sgst: 900, igst: 0, csamt: 0,
      }],
    }
    const creditNote: Gstr1Transaction = {
      ...sale,
      id: 'cn1', type: 'credit-note', invoiceNo: 'CN-WALK',
      date: new Date('2026-07-15'),
      totalAmount: 2360, subtotal: 2000, discountAmount: 0,
      cgst: 180, sgst: 180, igst: 0,
      items: [{
        productId: 'p1', productName: 'Goods', hsn: '1006',
        quantity: 2, unit: 'kg', unitPrice: 1000, gstRate: 18,
        discountAmount: 0, cgst: 180, sgst: 180, igst: 0, csamt: 0,
      }],
    }
    const txns = [sale, creditNote]

    const b2cs = buildB2CS(txns, SHOP)
    expect(b2cs).toHaveLength(1)
    expect(b2cs[0].rt).toBe(18)
    expect(b2cs[0].pos).toBe('27')
    // Net taxable: 10000 - 2000 = 8000
    expect(b2cs[0].txval).toBe(8000)
    // Net CGST: 900 - 180 = 720
    expect(b2cs[0].camt).toBe(720)
    expect(b2cs[0].samt).toBe(720)

    // CDNUR must be empty — this note is intra-state (not B2CL)
    const cdnur = buildCDNUR(txns, SHOP)
    expect(cdnur).toHaveLength(0)
  })

  test('inter-state B2CL sale (>₹1L) + credit note → CDNUR has one entry, B2CS untouched', () => {
    // Inter-state sale > ₹1L qualifies as B2CL; a credit note against it goes to CDNUR.
    const b2clSale: Gstr1Transaction = {
      id: 's2', type: 'sale', invoiceNo: 'INV-B2CL', date: new Date('2026-07-10'),
      totalAmount: 236000, subtotal: 200000, discountAmount: 0,
      cgst: 0, sgst: 0, igst: 36000, isInterState: true, isReverseCharge: false,
      partyId: null, partyName: 'Bulk Buyer', partyGstin: null, partyState: 'Gujarat',
      items: [{
        productId: 'p1', productName: 'Bulk', hsn: '1006',
        quantity: 100, unit: 'kg', unitPrice: 2000, gstRate: 18,
        discountAmount: 0, cgst: 0, sgst: 0, igst: 36000, csamt: 0,
      }],
    }
    const b2clCreditNote: Gstr1Transaction = {
      ...b2clSale,
      id: 'cn2', type: 'credit-note', invoiceNo: 'CN-B2CL',
      date: new Date('2026-07-15'),
      totalAmount: 200000, subtotal: 169492, discountAmount: 0,
      cgst: 0, sgst: 0, igst: 30508,
      items: [{
        productId: 'p1', productName: 'Bulk', hsn: '1006',
        quantity: 100, unit: 'kg', unitPrice: 1694.92, gstRate: 18,
        discountAmount: 0, cgst: 0, sgst: 0, igst: 30508, csamt: 0,
      }],
    }
    const txns = [b2clSale, b2clCreditNote]

    // CDNUR must have exactly one entry with typ:'B2CL' and inter-state POS
    const cdnur = buildCDNUR(txns, SHOP)
    expect(cdnur).toHaveLength(1)
    expect(cdnur[0].typ).toBe('B2CL')
    expect(cdnur[0].ntty).toBe('C')
    expect(cdnur[0].pos).toBe('24')  // Gujarat (party state) — inter-state
    expect(cdnur[0].val).toBe(200000)

    // B2CS must be empty — the sale was B2CL (>₹1L inter-state), and the credit
    // note is also >₹1L inter-state so it goes to CDNUR (not B2CS netting).
    const b2cs = buildB2CS(txns, SHOP)
    expect(b2cs).toHaveLength(0)
  })

  test('B2CS row can go NEGATIVE when a credit note exceeds remaining sales', () => {
    // Edge case from the auditor: portal accepts negative B2CS adjustments.
    // A return with no matching sale in the period → negative row.
    const creditNoteOnly: Gstr1Transaction = {
      id: 'cn3', type: 'credit-note', invoiceNo: 'CN-NEG', date: new Date('2026-07-20'),
      totalAmount: 1180, subtotal: 1000, discountAmount: 0,
      cgst: 90, sgst: 90, igst: 0, isInterState: false, isReverseCharge: false,
      partyId: null, partyName: 'Walk-in', partyGstin: null, partyState: null,
      items: [{
        productId: 'p1', productName: 'Goods', hsn: '1006',
        quantity: 10, unit: 'kg', unitPrice: 100, gstRate: 18,
        discountAmount: 0, cgst: 90, sgst: 90, igst: 0, csamt: 0,
      }],
    }
    const b2cs = buildB2CS([creditNoteOnly], SHOP)
    expect(b2cs).toHaveLength(1)
    expect(b2cs[0].txval).toBe(-1000)  // negative — no sale to net against
    expect(b2cs[0].camt).toBe(-90)
    expect(b2cs[0].samt).toBe(-90)
  })

  test('debit note for unregistered B2CS party INCREASES the aggregate', () => {
    // A debit note (purchase return equivalent for B2C) adds back to taxable.
    const sale: Gstr1Transaction = {
      id: 's3', type: 'sale', invoiceNo: 'INV-DB', date: new Date('2026-07-10'),
      totalAmount: 1180, subtotal: 1000, discountAmount: 0,
      cgst: 90, sgst: 90, igst: 0, isInterState: false, isReverseCharge: false,
      partyId: null, partyName: 'Walk-in', partyGstin: null, partyState: null,
      items: [{
        productId: 'p1', productName: 'Goods', hsn: '1006',
        quantity: 10, unit: 'kg', unitPrice: 100, gstRate: 18,
        discountAmount: 0, cgst: 90, sgst: 90, igst: 0, csamt: 0,
      }],
    }
    const debitNote: Gstr1Transaction = {
      ...sale,
      id: 'dn1', type: 'debit-note', invoiceNo: 'DN-DB',
      date: new Date('2026-07-15'),
    }
    const b2cs = buildB2CS([sale, debitNote], SHOP)
    expect(b2cs).toHaveLength(1)
    // Sale 1000 + debit 1000 = 2000 (debit note INCREASES outward supply)
    expect(b2cs[0].txval).toBe(2000)
  })
})
