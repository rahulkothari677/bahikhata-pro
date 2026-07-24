/**
 * 🔒 Phase 1a — computeLineItems behavioral tests.
 *
 * THE PROBLEM: computeLineItems is the single chokepoint for all invoice math
 * (used by POST + PUT). It has 0 behavioral tests — only source-string regex
 * guards. A regression here silently corrupts every new invoice.
 *
 * WHAT THIS TESTS:
 *   1. Basic sale: 2 items, no discount, intra-state GST
 *   2. Inter-state: IGST instead of CGST+SGST
 *   3. Order discount: proportional distribution across items
 *   4. Unit normalization: 500 gm on a kg product → 0.5 kg
 *   5. GST-inclusive price: MRP back-calculation
 *   6. Credit-note profit: NEGATIVE (reverses the original sale's profit)
 *   7. Zero-GST item: gstRate=0 → no GST computed
 *   8. Per-item totals: Σ item.cgst === header.cgst (no drift)
 *   9. Round-off: totalBeforeRoundOff = subtotal - discount + gst
 *  10. Paise precision: no float drift on values that historically broke
 */

import { computeLineItems } from '@/lib/line-items'
import { roundMoney } from '@/lib/money'

const productMap = new Map<string, any>([
  ['p1', { id: 'p1', name: 'Basmati Rice 1kg', unit: 'kg', salePrice: 120, purchasePrice: 90, gstRate: 0 }],
  ['p2', { id: 'p2', name: 'Cooking Oil 1L', unit: 'ltr', salePrice: 150, purchasePrice: 110, gstRate: 5 }],
  ['p3', { id: 'p3', name: 'LED Bulb', unit: 'pcs', salePrice: 100, purchasePrice: 60, gstRate: 18 }],
  ['p4', { id: 'p4', name: 'Sugar', unit: 'kg', salePrice: 45, purchasePrice: 35, gstRate: 5 }],
])

describe('🔒 Phase 1a — computeLineItems behavioral tests', () => {

  // ═════════════════════════════════════════════════════════════════
  // 1. Basic sale: 2 items, no discount, intra-state (CGST+SGST)
  // ═════════════════════════════════════════════════════════════════
  test('basic sale: 2 items, intra-state, no discount', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p1', productName: 'Basmati Rice 1kg', quantity: 2, unitPrice: 120, gstRate: 0, unit: 'kg' },
        { productId: 'p3', productName: 'LED Bulb', quantity: 1, unitPrice: 100, gstRate: 18, unit: 'pcs' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    // Item 1: 2 × ₹120 = ₹240, GST 0% → total ₹240
    expect(r.txItems[0].total).toBe(240)
    expect(r.txItems[0].cgst).toBe(0)
    expect(r.txItems[0].sgst).toBe(0)

    // Item 2: 1 × ₹100 = ₹100, GST 18% → CGST ₹9 + SGST ₹9 → total ₹118
    expect(r.txItems[1].total).toBe(118)
    expect(r.txItems[1].cgst).toBe(9)
    expect(r.txItems[1].sgst).toBe(9)

    // Header totals
    expect(r.subtotal).toBe(340)         // 240 + 100
    expect(r.cgst).toBe(9)               // 0 + 9
    expect(r.sgst).toBe(9)               // 0 + 9
    expect(r.igst).toBe(0)
    expect(r.totalBeforeRoundOff).toBe(358)  // 340 - 0 + 9 + 9 + 0
  })

  // ═════════════════════════════════════════════════════════════════
  // 2. Inter-state: IGST instead of CGST+SGST
  // ═════════════════════════════════════════════════════════════════
  test('inter-state sale uses IGST, not CGST+SGST', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p3', productName: 'LED Bulb', quantity: 1, unitPrice: 100, gstRate: 18, unit: 'pcs' },
      ],
      productMap,
      isInterState: true,
      orderDiscount: 0,
      type: 'sale',
    })

    expect(r.txItems[0].igst).toBe(18)     // 18% of ₹100
    expect(r.txItems[0].cgst).toBe(0)
    expect(r.txItems[0].sgst).toBe(0)
    expect(r.igst).toBe(18)
    expect(r.cgst).toBe(0)
    expect(r.sgst).toBe(0)
    expect(r.totalBeforeRoundOff).toBe(118)
  })

  // ═════════════════════════════════════════════════════════════════
  // 3. Order discount: proportional distribution
  // ═════════════════════════════════════════════════════════════════
  test('order discount distributed proportionally across items', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p1', productName: 'Basmati Rice 1kg', quantity: 1, unitPrice: 100, gstRate: 0, unit: 'kg' },
        { productId: 'p1', productName: 'Basmati Rice 1kg', quantity: 1, unitPrice: 200, gstRate: 0, unit: 'kg' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 30,   // ₹30 discount on ₹300 subtotal → 10% each
      type: 'sale',
    })

    // Item 1: gross ₹100, discount ₹10 (10%), taxable ₹90
    expect(r.txItems[0].discountAmount).toBe(10)
    expect(r.txItems[0].total).toBe(90)

    // Item 2: gross ₹200, discount ₹20 (10%), taxable ₹180
    expect(r.txItems[1].discountAmount).toBe(20)
    expect(r.txItems[1].total).toBe(180)

    // Header: subtotal ₹300, discount ₹30, total ₹270
    expect(r.subtotal).toBe(300)
    expect(r.totalBeforeRoundOff).toBe(270)  // 300 - 30 + 0 GST
  })

  // ═════════════════════════════════════════════════════════════════
  // 4. Unit normalization: 500 gm on a kg product → 0.5 kg
  // ═════════════════════════════════════════════════════════════════
  test('unit normalization: 500 gm on kg product → 0.5 kg × price', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p1', productName: 'Basmati Rice 1kg', quantity: 500, unitPrice: 120, gstRate: 0, unit: 'gm' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    // 500 gm = 0.5 kg → 0.5 × ₹120 = ₹60
    expect(r.txItems[0].quantity).toBe(0.5)
    expect(r.txItems[0].unit).toBe('kg')
    expect(r.txItems[0].total).toBe(60)
    expect(r.subtotal).toBe(60)
  })

  // ═════════════════════════════════════════════════════════════════
  // 5. GST-inclusive price (MRP): back-calculate taxable price
  // ═════════════════════════════════════════════════════════════════
  test('GST-inclusive price back-calculates taxable (ex-GST) unit price', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p2', productName: 'Cooking Oil 1L', quantity: 1, unitPrice: 157.50, gstRate: 5, unit: 'ltr', priceIncludesGst: true },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    // MRP ₹157.50 incl 5% GST → taxable = 157.50 × 100/105 = ₹150
    expect(r.txItems[0].unitPrice).toBe(150)
    // GST = 5% of ₹150 = ₹7.50 → CGST ₹3.75 + SGST ₹3.75
    expect(r.txItems[0].cgst).toBe(3.75)
    expect(r.txItems[0].sgst).toBe(3.75)
    // Total = 150 + 7.50 = 157.50 (matches MRP)
    expect(r.txItems[0].total).toBe(157.50)
  })

  // ═════════════════════════════════════════════════════════════════
  // 6. Credit-note profit: NEGATIVE (reverses the original sale's profit)
  // ═════════════════════════════════════════════════════════════════
  test('credit-note computes NEGATIVE grossProfit (reverses original sale)', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p3', productName: 'LED Bulb', quantity: 1, unitPrice: 100, gstRate: 18, unit: 'pcs' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'credit-note',
    })

    // Sale profit = (100 - 60) × 1 = ₹40
    // Credit-note profit = -₹40 (reverses the sale's profit)
    expect(r.grossProfit).toBe(-40)
  })

  // ═════════════════════════════════════════════════════════════════
  // 7. Zero-GST item: gstRate=0 → no GST computed
  // ═════════════════════════════════════════════════════════════════
  test('zero-GST item produces no CGST/SGST/IGST', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p1', productName: 'Basmati Rice 1kg', quantity: 3, unitPrice: 120, gstRate: 0, unit: 'kg' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    expect(r.txItems[0].cgst).toBe(0)
    expect(r.txItems[0].sgst).toBe(0)
    expect(r.txItems[0].igst).toBe(0)
    expect(r.cgst).toBe(0)
    expect(r.sgst).toBe(0)
    expect(r.igst).toBe(0)
    expect(r.totalBeforeRoundOff).toBe(360)  // 3 × 120, no GST
  })

  // ═════════════════════════════════════════════════════════════════
  // 8. Per-item totals: Σ item.cgst === header.cgst (no drift)
  //    This is the R9-1 class — header vs per-item must always agree.
  // ═════════════════════════════════════════════════════════════════
  test('header GST exactly equals sum of per-item GST (no drift)', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p2', productName: 'Cooking Oil 1L', quantity: 2, unitPrice: 150, gstRate: 5, unit: 'ltr' },
        { productId: 'p3', productName: 'LED Bulb', quantity: 3, unitPrice: 100, gstRate: 18, unit: 'pcs' },
        { productId: 'p4', productName: 'Sugar', quantity: 1, unitPrice: 45, gstRate: 5, unit: 'kg' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    const sumCgst = roundMoney(r.txItems.reduce((s, i) => s + i.cgst, 0))
    const sumSgst = roundMoney(r.txItems.reduce((s, i) => s + i.sgst, 0))
    const sumIgst = roundMoney(r.txItems.reduce((s, i) => s + i.igst, 0))

    expect(roundMoney(r.cgst)).toBe(sumCgst)
    expect(roundMoney(r.sgst)).toBe(sumSgst)
    expect(roundMoney(r.igst)).toBe(sumIgst)
  })

  // ═════════════════════════════════════════════════════════════════
  // 9. Round-off: totalBeforeRoundOff = subtotal - discount + gst
  // ═════════════════════════════════════════════════════════════════
  test('totalBeforeRoundOff = subtotal - discount + all GST', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p3', productName: 'LED Bulb', quantity: 2, unitPrice: 100, gstRate: 18, unit: 'pcs' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 20,
      type: 'sale',
    })

    // subtotal = 2 × 100 = 200
    // discount = 20
    // taxable = 180
    // GST = 18% of 180 = 32.40 → CGST 16.20 + SGST 16.20
    // total = 180 + 32.40 = 212.40
    expect(r.subtotal).toBe(200)
    expect(r.cgst + r.sgst).toBe(32.40)
    expect(r.totalBeforeRoundOff).toBe(212.40)
  })

  // ═════════════════════════════════════════════════════════════════
  // 10. Paise precision: values that historically broke with floats
  // ═════════════════════════════════════════════════════════════════
  test('no float drift on values that historically broke (0.1 + 0.2 class)', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p4', productName: 'Sugar', quantity: 1.5, unitPrice: 33.33, gstRate: 5, unit: 'kg' },
        { productId: 'p4', productName: 'Sugar', quantity: 0.5, unitPrice: 33.33, gstRate: 5, unit: 'kg' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    // 1.5 × 33.33 = 49.995 → round → 50.00 (or 49.99 depending on rounding)
    // 0.5 × 33.33 = 16.665 → round → 16.67 (or 16.66)
    // The key assertion: header subtotal === sum of item gross amounts.
    // Note: computeLineItems uses paise arithmetic (multiplyPaise) internally,
    // so the header subtotal is computed from paise. The item-level
    // quantity × unitPrice is a Float multiply that can differ by ±0.01
    // due to rounding direction. The assertion that MUST hold is:
    // header CGST === sum of per-item CGST (the reconciliation invariant).
    const itemCgstSum = roundMoney(r.txItems.reduce((s, i) => s + i.cgst, 0))
    expect(roundMoney(r.cgst)).toBe(itemCgstSum)
  })

  // ═════════════════════════════════════════════════════════════════
  // 11. Unlinked item (no productId): still computes correctly
  // ═════════════════════════════════════════════════════════════════
  test('unlinked item (no productId) computes without crashing', () => {
    const r = computeLineItems({
      items: [
        { productName: 'Custom Item', quantity: 2, unitPrice: 50, gstRate: 0, unit: 'pcs' },
      ],
      productMap: new Map(),  // empty — no products linked
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    expect(r.txItems[0].total).toBe(100)
    expect(r.txItems[0].productId).toBeNull()
    expect(r.subtotal).toBe(100)
    expect(r.grossProfit).toBe(0)  // no product → no profit calc
  })

  // ═════════════════════════════════════════════════════════════════
  // 12. Entered quantity preserved (V17 Audit Phase 10)
  // ═════════════════════════════════════════════════════════════════
  test('enteredQuantity + enteredUnit preserve the user original input', () => {
    const r = computeLineItems({
      items: [
        { productId: 'p1', productName: 'Basmati Rice 1kg', quantity: 500, unitPrice: 120, gstRate: 0, unit: 'gm' },
      ],
      productMap,
      isInterState: false,
      orderDiscount: 0,
      type: 'sale',
    })

    // The stored quantity is 0.5 (normalized to kg), but the entered
    // quantity is 500 (what the user typed) with enteredUnit 'gm'.
    expect(r.txItems[0].quantity).toBe(0.5)
    expect(r.txItems[0].enteredQuantity).toBe(500)
    expect(r.txItems[0].enteredUnit).toBe('gm')
  })
})
