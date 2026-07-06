/**
 * 🔒 V10 §2.1+§2.2 GOLDEN TEST: GST on discounted sales.
 *
 * The auditor's most critical V10 finding: "EkBook computes GST on the PRE-
 * discount amount. Every discounted sale overcharges GST and produces an
 * invoice where tax ≠ taxable × rate. A CA or the GST portal will reject
 * these."
 *
 * This test asserts the GST-correctness invariant for the
 * `distributeDiscountProportionally` + `calculateGst` + `splitGst` pipeline
 * that the server (transactions/route.ts POST/PUT) and client
 * (TransactionEntry.tsx) now both use:
 *
 *   For every rate slab on a discounted invoice:
 *     tax == taxable × rate
 *
 * And for the invoice as a whole:
 *   cgst + sgst + igst == Σ(taxable_slab × rate)
 *   total            == Σ(taxable) + Σ(tax)
 *
 * If this test ever fails, GSTR-1 is non-filable for the failing case.
 */

import {
  roundMoney,
  calculateGst,
  splitGst,
  distributeDiscountProportionally,
  toMoney,
} from '@/lib/money'

describe('🔒 V10 §2.1 — GST on discounted sales (golden test)', () => {
  // Helper: replicate the server's per-item GST computation for a multi-item
  // discounted sale, returning the per-item + aggregate values.
  function computeInvoiceSale(
    items: Array<{ qty: number; unitPrice: number; gstRate: number }>,
    orderDiscount: number,
    isInterState: boolean,
  ) {
    const grossAmounts = items.map(i =>
      roundMoney(toMoney(i.qty) * toMoney(i.unitPrice)),
    )
    const perItemDiscounts = distributeDiscountProportionally(grossAmounts, orderDiscount)

    let cgst = 0, sgst = 0, igst = 0
    let taxableTotal = 0
    const perItem = items.map((item, idx) => {
      const gross = grossAmounts[idx]
      const itemDiscount = roundMoney(perItemDiscounts[idx])
      const taxable = roundMoney(gross - itemDiscount)
      const itemGst = calculateGst(taxable, item.gstRate)
      taxableTotal = roundMoney(taxableTotal + taxable)
      let itemCgst = 0, itemSgst = 0, itemIgst = 0
      if (isInterState) {
        itemIgst = itemGst
        igst = roundMoney(igst + itemGst)
      } else {
        const split = splitGst(itemGst)
        itemCgst = split.cgst
        itemSgst = split.sgst
        cgst = roundMoney(cgst + split.cgst)
        sgst = roundMoney(sgst + split.sgst)
      }
      return { ...item, gross, itemDiscount, taxable, itemGst, itemCgst, itemSgst, itemIgst }
    })

    const totalGst = roundMoney(cgst + sgst + igst)
    const totalAmount = roundMoney(taxableTotal + totalGst)
    return { perItem, cgst, sgst, igst, totalGst, taxableTotal, totalAmount }
  }

  // Helper: aggregate GST by rate slab (matches reports/gstr-export SQL logic)
  function aggregateBySlab(perItem: ReturnType<typeof computeInvoiceSale>['perItem']) {
    const slab = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()
    for (const it of perItem) {
      const existing = slab.get(it.gstRate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
      existing.taxable = roundMoney(existing.taxable + it.taxable)
      existing.cgst = roundMoney(existing.cgst + it.itemCgst)
      existing.sgst = roundMoney(existing.sgst + it.itemSgst)
      existing.igst = roundMoney(existing.igst + it.itemIgst)
      slab.set(it.gstRate, existing)
    }
    return slab
  }

  describe('the auditor\'s exact worked example: ₹1,000 sale, ₹100 discount, 18% GST', () => {
    test('intra-state (CGST+SGST) — GST is on ₹900, not ₹1,000', () => {
      const result = computeInvoiceSale(
        [{ qty: 1, unitPrice: 1000, gstRate: 18 }],
        100,
        false, // intra-state
      )
      // Auditor's expected values:
      //   taxable = ₹900
      //   GST     = ₹162 (18% of ₹900)  ← NOT ₹180
      //   total   = ₹1,062              ← NOT ₹1,080
      expect(result.taxableTotal).toBe(900)
      expect(result.totalGst).toBe(162)
      expect(result.cgst + result.sgst).toBe(162)
      expect(result.totalAmount).toBe(1062)
    })

    test('inter-state (IGST) — same GST on ₹900', () => {
      const result = computeInvoiceSale(
        [{ qty: 1, unitPrice: 1000, gstRate: 18 }],
        100,
        true, // inter-state
      )
      expect(result.taxableTotal).toBe(900)
      expect(result.igst).toBe(162)
      expect(result.totalGst).toBe(162)
      expect(result.totalAmount).toBe(1062)
    })
  })

  describe('the GST-correctness invariant: tax == taxable × rate (per slab)', () => {
    // The invariant the GST portal validates: for each rate slab on the
    // invoice, the tax amount must equal taxable × rate (within rounding).
    // A CA glances at the slab breakdown and computes tax = taxable × rate
    // mentally; if the stored tax ≠ that, the invoice is suspect.
    test('single-rate ₹1000 + ₹100 discount + 18% — slab tax matches taxable × rate', () => {
      const result = computeInvoiceSale(
        [{ qty: 1, unitPrice: 1000, gstRate: 18 }],
        100,
        false,
      )
      const slab = aggregateBySlab(result.perItem).get(18)!
      const expectedTax = roundMoney(slab.taxable * 18 / 100)
      expect(roundMoney(slab.cgst + slab.sgst + slab.igst)).toBe(expectedTax)
    })

    test('multi-rate ₹500@5% + ₹500@18% + ₹100 discount — both slabs match', () => {
      const result = computeInvoiceSale(
        [
          { qty: 1, unitPrice: 500, gstRate: 5 },
          { qty: 1, unitPrice: 500, gstRate: 18 },
        ],
        100,
        false,
      )
      // Proportional discount: ₹50 each → taxable 5% slab = ₹450, 18% slab = ₹450
      const slab5 = aggregateBySlab(result.perItem).get(5)!
      const slab18 = aggregateBySlab(result.perItem).get(18)!
      expect(slab5.taxable).toBe(450)
      expect(slab18.taxable).toBe(450)
      // 5% slab: tax = 22.50
      expect(roundMoney(slab5.cgst + slab5.sgst + slab5.igst)).toBe(22.50)
      expect(roundMoney(slab5.taxable * 5 / 100)).toBe(22.50)
      // 18% slab: tax = 81.00
      expect(roundMoney(slab18.cgst + slab18.sgst + slab18.igst)).toBe(81.00)
      expect(roundMoney(slab18.taxable * 18 / 100)).toBe(81.00)
      // Total = taxable + tax = 900 + 103.50 = 1003.50
      expect(result.taxableTotal).toBe(900)
      expect(result.totalGst).toBe(103.50)
      expect(result.totalAmount).toBe(1003.50)
    })

    test('three-rate invoice with uneven quantities + discount — invariant holds', () => {
      const result = computeInvoiceSale(
        [
          { qty: 3, unitPrice: 100, gstRate: 5 },   // gross 300
          { qty: 2, unitPrice: 250, gstRate: 12 },  // gross 500
          { qty: 1, unitPrice: 700, gstRate: 28 },  // gross 700
        ],
        150, // 10% discount on ₹1500
        false,
      )
      // Each slab's tax must equal taxable × rate
      for (const [rate, slab] of aggregateBySlab(result.perItem)) {
        const expectedTax = roundMoney(slab.taxable * rate / 100)
        const actualTax = roundMoney(slab.cgst + slab.sgst + slab.igst)
        expect(actualTax).toBe(expectedTax)
      }
      // The discount is fully distributed (sum of per-item discounts == 150)
      const sumDiscounts = result.perItem.reduce((s, it) => s + it.itemDiscount, 0)
      expect(roundMoney(sumDiscounts)).toBe(150)
      // Total = taxable + tax
      expect(result.totalAmount).toBe(roundMoney(result.taxableTotal + result.totalGst))
    })
  })

  describe('discount distribution edge cases', () => {
    test('zero discount — every per-item discount is 0, behavior unchanged', () => {
      const result = computeInvoiceSale(
        [{ qty: 1, unitPrice: 1000, gstRate: 18 }],
        0,
        false,
      )
      expect(result.perItem[0].itemDiscount).toBe(0)
      expect(result.taxableTotal).toBe(1000)
      expect(result.totalGst).toBe(180)
    })

    test('discount > subtotal is clamped (no negative taxable)', () => {
      const result = computeInvoiceSale(
        [{ qty: 1, unitPrice: 1000, gstRate: 18 }],
        1500, // > subtotal
        false,
      )
      // The distribution helper clamps each item's discount to [0, gross]
      // so taxable never goes negative. GST should be 0 (taxable = 0).
      expect(result.perItem[0].taxable).toBeGreaterThanOrEqual(0)
      expect(result.perItem[0].itemGst).toBeGreaterThanOrEqual(0)
    })

    test('discount on a multi-rate invoice distributes proportionally to gross', () => {
      // ₹200@5% (gross 200) + ₹800@18% (gross 800) + ₹100 discount
      // Proportional: 20/100 to 5% item, 80/100 to 18% item
      const result = computeInvoiceSale(
        [
          { qty: 1, unitPrice: 200, gstRate: 5 },
          { qty: 1, unitPrice: 800, gstRate: 18 },
        ],
        100,
        false,
      )
      expect(result.perItem[0].itemDiscount).toBe(20) // 200/1000 * 100
      expect(result.perItem[1].itemDiscount).toBe(80) // 800/1000 * 100
      expect(result.perItem[0].taxable).toBe(180)
      expect(result.perItem[1].taxable).toBe(720)
    })

    test('rounding residual is absorbed so Σ(discounts) == orderDiscount exactly', () => {
      // Three items at ₹33.33 each (₹99.99 total) + ₹10 discount.
      // Proportional shares: 3.333... each → rounds to 3.33 each → sum 9.99.
      // The residual (₹0.01) must be absorbed into the last item so the
      // sum exactly equals ₹10. Otherwise the stored total drifts.
      const result = computeInvoiceSale(
        [
          { qty: 1, unitPrice: 33.33, gstRate: 0 },
          { qty: 1, unitPrice: 33.33, gstRate: 0 },
          { qty: 1, unitPrice: 33.33, gstRate: 0 },
        ],
        10,
        false,
      )
      const sumDiscounts = roundMoney(result.perItem.reduce((s, it) => s + it.itemDiscount, 0))
      expect(sumDiscounts).toBe(10)
    })
  })

  describe('§2.2 single source of truth: stored per-item values reconcile to header', () => {
    test('Σ(per-item CGST) == header CGST, same for SGST/IGST', () => {
      const result = computeInvoiceSale(
        [
          { qty: 2, unitPrice: 250, gstRate: 5 },
          { qty: 1, unitPrice: 500, gstRate: 18 },
          { qty: 3, unitPrice: 100, gstRate: 12 },
        ],
        75,
        false,
      )
      const sumCgst = roundMoney(result.perItem.reduce((s, it) => s + it.itemCgst, 0))
      const sumSgst = roundMoney(result.perItem.reduce((s, it) => s + it.itemSgst, 0))
      const sumIgst = roundMoney(result.perItem.reduce((s, it) => s + it.itemIgst, 0))
      expect(sumCgst).toBe(result.cgst)
      expect(sumSgst).toBe(result.sgst)
      expect(sumIgst).toBe(result.igst)
    })

    test('inter-state: all GST in IGST, CGST/SGST zero', () => {
      const result = computeInvoiceSale(
        [
          { qty: 1, unitPrice: 500, gstRate: 18 },
          { qty: 1, unitPrice: 500, gstRate: 5 },
        ],
        100,
        true, // inter-state
      )
      expect(result.cgst).toBe(0)
      expect(result.sgst).toBe(0)
      expect(result.igst).toBeGreaterThan(0)
      expect(result.perItem.every(it => it.itemCgst === 0 && it.itemSgst === 0)).toBe(true)
    })
  })
})
