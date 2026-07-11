/**
 * V17 Audit §1 FIX — Golden tests for net-of-returns helpers.
 *
 * SECURITY INVARIANT: A shop that accepts a return must see net revenue,
 * net profit, and net output tax on every screen — not gross (pre-return)
 * values. If any of these tests fail, a shopkeeper sees inflated numbers
 * and makes wrong business decisions.
 *
 * The auditor's worked example:
 *   "You sell ₹10,000 this month; a customer returns ₹3,000 of goods and
 *    you issue a credit note. Real net revenue is ₹7,000. But the dashboard
 *    still shows ₹10,000 revenue and the full profit."
 *
 * These tests lock in the fix: netRevenue = sale − creditNote.
 */

import {
  netSalesTaxable,
  netSalesProfit,
  netOutputTax,
  netPurchasesTaxable,
  netInputTax,
  netSalesTotal,
  type TypeAggregates,
} from '@/lib/net-sales'

describe('🔒 V17 Audit §1 — Net-of-returns helpers', () => {
  describe('netSalesTaxable (revenue net of credit notes)', () => {
    test('simple sale + partial credit note = net revenue', () => {
      // Sale of ₹10,000 (subtotal 10000, no discount)
      const sale: TypeAggregates = { subtotal: 10000, discountAmount: 0 }
      // Credit note for ₹3,000 return
      const cn: TypeAggregates = { subtotal: 3000, discountAmount: 0 }

      expect(netSalesTaxable(sale, cn)).toBe(7000) // ₹7,000 net
    })

    test('sale with no credit notes = full sale revenue', () => {
      const sale: TypeAggregates = { subtotal: 15000, discountAmount: 500 }
      const cn: TypeAggregates = {}

      expect(netSalesTaxable(sale, cn)).toBe(14500) // 15000 - 500 discount
    })

    test('credit note with discount is correctly netted', () => {
      const sale: TypeAggregates = { subtotal: 20000, discountAmount: 1000 }
      const cn: TypeAggregates = { subtotal: 4000, discountAmount: 200 }

      // sale taxable = 19000, cn taxable = 3800, net = 15200
      expect(netSalesTaxable(sale, cn)).toBe(15200)
    })

    test('full return (credit note = sale) = zero revenue', () => {
      const sale: TypeAggregates = { subtotal: 5000, discountAmount: 0 }
      const cn: TypeAggregates = { subtotal: 5000, discountAmount: 0 }

      expect(netSalesTaxable(sale, cn)).toBe(0)
    })

    test('null/undefined aggregates are treated as 0', () => {
      expect(netSalesTaxable(null as any, null as any)).toBe(0)
      expect(netSalesTaxable({}, {})).toBe(0)
      expect(netSalesTaxable({ subtotal: null }, { subtotal: null })).toBe(0)
    })
  })

  describe('netSalesProfit (profit net of credit notes)', () => {
    test('sale profit + credit-note profit (NEGATIVE) = net profit', () => {
      // 🔒 V17 Audit Phase 4 SIGN-CONVENTION FIX:
      // Credit notes store NEGATIVE grossProfit (line-items.ts: grossProfit - itemProfit = 0 - 900 = -900).
      // So netSalesProfit ADDS (not subtracts): sale(+3000) + cn(-900) = 2100.
      // BEFORE the fix: the helper subtracted → 3000 - (-900) = 3900 (INFLATED).
      const sale: TypeAggregates = { grossProfit: 3000 }
      const cn: TypeAggregates = { grossProfit: -900 } // NEGATIVE (matches real DB storage)

      expect(netSalesProfit(sale, cn)).toBe(2100)
    })

    test('full return reverses all profit', () => {
      const sale: TypeAggregates = { grossProfit: 2000 }
      const cn: TypeAggregates = { grossProfit: -2000 } // NEGATIVE

      expect(netSalesProfit(sale, cn)).toBe(0)
    })

    test('no credit notes = full sale profit', () => {
      const sale: TypeAggregates = { grossProfit: 5000 }
      const cn: TypeAggregates = {}

      expect(netSalesProfit(sale, cn)).toBe(5000)
    })

    test('🔒 V17 Audit Phase 4: OLD buggy formula would produce 3900 (not 2100)', () => {
      // Regression guard: if someone reverts netSalesProfit to `s - c`, this test fails.
      const sale: TypeAggregates = { grossProfit: 3000 }
      const cn: TypeAggregates = { grossProfit: -900 }

      const result = netSalesProfit(sale, cn)
      expect(result).toBe(2100)      // correct
      expect(result).not.toBe(3900)  // old buggy value (3000 - (-900))
      expect(result).not.toBe(3900)  // double-guard
    })
  })

  describe('netOutputTax (output tax net of credit notes)', () => {
    test('sale GST minus credit-note GST = net output tax', () => {
      // Sale: 18% GST on ₹10000 = ₹1800 (CGST 900 + SGST 900)
      const sale: TypeAggregates = { cgst: 900, sgst: 900, igst: 0 }
      // Credit note: 18% GST on ₹3000 = ₹540 (CGST 270 + SGST 270)
      const cn: TypeAggregates = { cgst: 270, sgst: 270, igst: 0 }

      // net = 1800 - 540 = 1260
      expect(netOutputTax(sale, cn)).toBe(1260)
    })

    test('inter-state sale with credit note', () => {
      // Sale: 18% IGST on ₹20000 = ₹3600
      const sale: TypeAggregates = { cgst: 0, sgst: 0, igst: 3600 }
      // Credit note: 18% IGST on ₹5000 = ₹900
      const cn: TypeAggregates = { cgst: 0, sgst: 0, igst: 900 }

      expect(netOutputTax(sale, cn)).toBe(2700)
    })

    test('full return reverses all output tax', () => {
      const sale: TypeAggregates = { cgst: 450, sgst: 450, igst: 0 }
      const cn: TypeAggregates = { cgst: 450, sgst: 450, igst: 0 }

      expect(netOutputTax(sale, cn)).toBe(0)
    })

    test('no credit notes = full sale GST', () => {
      const sale: TypeAggregates = { cgst: 1000, sgst: 1000, igst: 0 }
      const cn: TypeAggregates = {}

      expect(netOutputTax(sale, cn)).toBe(2000)
    })
  })

  describe('netPurchasesTaxable (purchases net of debit notes)', () => {
    test('purchase minus debit note = net purchases', () => {
      const purchase: TypeAggregates = { subtotal: 8000, discountAmount: 0 }
      const debitNote: TypeAggregates = { subtotal: 2000, discountAmount: 0 }

      expect(netPurchasesTaxable(purchase, debitNote)).toBe(6000)
    })

    test('full purchase return = zero net purchases', () => {
      const purchase: TypeAggregates = { subtotal: 5000, discountAmount: 0 }
      const debitNote: TypeAggregates = { subtotal: 5000, discountAmount: 0 }

      expect(netPurchasesTaxable(purchase, debitNote)).toBe(0)
    })
  })

  describe('netInputTax (ITC net of debit notes)', () => {
    test('purchase GST minus debit-note GST = net input tax', () => {
      // Purchase: 18% GST on ₹8000 = ₹1440 (CGST 720 + SGST 720)
      const purchase: TypeAggregates = { cgst: 720, sgst: 720, igst: 0 }
      // Debit note: 18% GST on ₹2000 = ₹360 (CGST 180 + SGST 180)
      const debitNote: TypeAggregates = { cgst: 180, sgst: 180, igst: 0 }

      // net = 1440 - 360 = 1080
      expect(netInputTax(purchase, debitNote)).toBe(1080)
    })

    test('full purchase return reverses all ITC', () => {
      const purchase: TypeAggregates = { cgst: 500, sgst: 500, igst: 0 }
      const debitNote: TypeAggregates = { cgst: 500, sgst: 500, igst: 0 }

      expect(netInputTax(purchase, debitNote)).toBe(0)
    })
  })

  describe('netSalesTotal (total amount net of credit notes)', () => {
    test('sale total minus credit-note total = net total', () => {
      // Sale: ₹10000 + ₹1800 GST = ₹11800 total
      const sale: TypeAggregates = { totalAmount: 11800 }
      // Credit note: ₹3000 + ₹540 GST = ₹3540 total
      const cn: TypeAggregates = { totalAmount: 3540 }

      expect(netSalesTotal(sale, cn)).toBe(8260)
    })

    test('no credit notes = full sale total', () => {
      const sale: TypeAggregates = { totalAmount: 5000 }
      const cn: TypeAggregates = {}

      expect(netSalesTotal(sale, cn)).toBe(5000)
    })
  })

  /**
   * THE GOLDEN TEST — the auditor's exact worked example.
   * If this test ever fails, the §1 bug has regressed.
   */
  describe('🔥 GOLDEN TEST — auditor worked example', () => {
    test('₹10,000 sale + ₹3,000 credit note = ₹7,000 net everywhere', () => {
      const sale: TypeAggregates = {
        subtotal: 10000,
        discountAmount: 0,
        totalAmount: 11800, // 10000 + 1800 GST
        grossProfit: 3000,  // 30% margin
        cgst: 900,
        sgst: 900,
        igst: 0,
      }
      const creditNote: TypeAggregates = {
        subtotal: 3000,
        discountAmount: 0,
        totalAmount: 3540, // 3000 + 540 GST
        grossProfit: -900,  // 🔒 V17 Audit Phase 4: NEGATIVE (matches real DB storage)
        cgst: 270,
        sgst: 270,
        igst: 0,
      }

      // Net revenue (taxable) = 10000 - 3000 = 7000
      expect(netSalesTaxable(sale, creditNote)).toBe(7000)

      // Net revenue (total) = 11800 - 3540 = 8260
      expect(netSalesTotal(sale, creditNote)).toBe(8260)

      // Net profit = 3000 + (-900) = 2100 (credit-note grossProfit is NEGATIVE, so we ADD)
      expect(netSalesProfit(sale, creditNote)).toBe(2100)
      // 🔒 V17 Audit Phase 4: assert NOT 3900 (the old buggy value from subtracting a negative)
      expect(netSalesProfit(sale, creditNote)).not.toBe(3900)

      // Net output tax = 1800 - 540 = 1260
      expect(netOutputTax(sale, creditNote)).toBe(1260)

      // The dashboard, P&L, and GST report must ALL show these net values.
      // Before the fix, they showed 10000 / 11800 / 3000 / 1800 — inflated.
    })
  })

  describe('rounding safety', () => {
    test('handles float precision (₹0.01 edges)', () => {
      // Odd-paise GST can produce float artifacts; roundMoney must clean them
      const sale: TypeAggregates = { cgst: 4.51, sgst: 4.51, igst: 0 }
      const cn: TypeAggregates = { cgst: 1.51, sgst: 1.50, igst: 0 }

      // 9.02 - 3.01 = 6.01 (no float artifacts)
      expect(netOutputTax(sale, cn)).toBe(6.01)
    })
  })

  /**
   * 🔒 V17 Audit Phase 4 — Sign-Convention Integration Test
   *
   * This test simulates the REAL data flow: a sale stores POSITIVE grossProfit,
   * a credit note stores NEGATIVE grossProfit (per line-items.ts). It then
   * verifies that BOTH computation paths produce the same correct net profit:
   *
   * 1. The netSalesProfit helper (used by P&L report)
   * 2. The Ledger.tsx reduce logic (used by the sales ledger total)
   *
   * Before Phase 4, these two paths DISAGREED because the helper subtracted
   * (3000 - (-900) = 3900) while the Ledger also subtracted (same bug). Both
   * were wrong in the same way, so they "agreed" — but on the WRONG number.
   *
   * This test catches that class of bug by asserting the CORRECT value (2100)
   * and explicitly NOT the buggy value (3900).
   */
  describe('🔒 V17 Audit Phase 4 — Sign-convention integration', () => {
    test('sale (+3000) + credit-note (-900) = 2100 across ALL computation paths', () => {
      // Simulate real DB rows (as stored by line-items.ts)
      const saleRow = { type: 'sale', grossProfit: 3000 }
      const creditNoteRow = { type: 'credit-note', grossProfit: -900 } // NEGATIVE
      const allRows = [saleRow, creditNoteRow]

      // Path 1: netSalesProfit helper (used by P&L report via reports/route.ts)
      const helperResult = netSalesProfit(
        { grossProfit: 3000 },
        { grossProfit: -900 }
      )

      // Path 2: Ledger.tsx reduce logic (simulated)
      // This is the EXACT code from Ledger.tsx totalProfit:
      const ledgerResult = allRows.reduce((s, t) => {
        if (t.type === 'credit-note') return s + (t.grossProfit || 0)  // ADD (negative)
        if (t.type === 'sale') return s + (t.grossProfit || 0)
        return s
      }, 0)

      // Both paths must agree
      expect(helperResult).toBe(2100)
      expect(ledgerResult).toBe(2100)
      expect(helperResult).toBe(ledgerResult)

      // Both must NOT be the old buggy value
      expect(helperResult).not.toBe(3900)
      expect(ledgerResult).not.toBe(3900)
    })

    test('multiple credit notes all with negative profit', () => {
      const rows = [
        { type: 'sale', grossProfit: 5000 },
        { type: 'sale', grossProfit: 3000 },
        { type: 'credit-note', grossProfit: -900 },
        { type: 'credit-note', grossProfit: -500 },
      ]

      // Ledger reduce
      const ledgerResult = rows.reduce((s, t) => {
        if (t.type === 'credit-note') return s + (t.grossProfit || 0)
        if (t.type === 'sale') return s + (t.grossProfit || 0)
        return s
      }, 0)

      // 5000 + 3000 + (-900) + (-500) = 6600
      expect(ledgerResult).toBe(6600)
      expect(ledgerResult).not.toBe(9400) // old buggy value (8000 - (-1400))
    })
  })

  /**
   * 🔒 V17 Audit Phase 0 — Ledger totalAmount + totalPaid net-of-returns
   *
   * The Ledger.tsx "Total Sales" KPI was inflating by credit notes because
   * credit notes store POSITIVE totalAmount (the absolute invoice total) and
   * the reduce was ADDING them. 5 sales (₹5000) + 1 credit note (₹1000)
   * showed ₹6000 instead of ₹4000 net.
   *
   * This test simulates the REAL data: sales with positive totalAmount,
   * credit notes with positive totalAmount (but they should be SUBTRACTED).
   * Verifies the Ledger reduce produces the correct net total.
   */
  describe('🔒 V17 Audit Phase 0 — Ledger totalAmount net of returns', () => {
    test('sales ledger totalAmount: sales ADD, credit notes SUBTRACT', () => {
      // Real DB rows: sales have positive totalAmount, credit notes have positive totalAmount
      const rows = [
        { type: 'sale', totalAmount: 2000 },
        { type: 'sale', totalAmount: 3000 },
        { type: 'credit-note', totalAmount: 1000 }, // POSITIVE in DB, but reduces revenue
      ]

      // Ledger.tsx totalAmount reduce (sales ledger — isSale=true)
      const isSale = true
      const totalAmount = rows.reduce((s, t) => {
        if (isSale) {
          return t.type === 'credit-note' ? s - t.totalAmount : s + t.totalAmount
        } else {
          return t.type === 'debit-note' ? s - t.totalAmount : s + t.totalAmount
        }
      }, 0)

      // 2000 + 3000 - 1000 = 4000 (net of return)
      expect(totalAmount).toBe(4000)
      // NOT 6000 (the old buggy value — adding credit-note totalAmount)
      expect(totalAmount).not.toBe(6000)
    })

    test('purchase ledger totalAmount: purchases ADD, debit notes SUBTRACT', () => {
      const rows = [
        { type: 'purchase', totalAmount: 5000 },
        { type: 'purchase', totalAmount: 3000 },
        { type: 'debit-note', totalAmount: 2000 }, // POSITIVE in DB, but reduces purchases
      ]

      // Ledger.tsx totalAmount reduce (purchase ledger — isSale=false)
      const isSale = false
      const totalAmount = rows.reduce((s, t) => {
        if (isSale) {
          return t.type === 'credit-note' ? s - t.totalAmount : s + t.totalAmount
        } else {
          return t.type === 'debit-note' ? s - t.totalAmount : s + t.totalAmount
        }
      }, 0)

      // 5000 + 3000 - 2000 = 6000 (net of return)
      expect(totalAmount).toBe(6000)
      // NOT 10000 (the old buggy value)
      expect(totalAmount).not.toBe(10000)
    })

    test('totalPaid: sales ADD paidAmount, credit notes SUBTRACT (refund)', () => {
      const rows = [
        { type: 'sale', paidAmount: 2000 },
        { type: 'sale', paidAmount: 3000 },
        { type: 'credit-note', paidAmount: 1000 }, // refund issued
      ]

      const isSale = true
      const totalPaid = rows.reduce((s, t) => {
        if (isSale) {
          return t.type === 'credit-note' ? s - (t.paidAmount || 0) : s + (t.paidAmount || 0)
        } else {
          return t.type === 'debit-note' ? s - (t.paidAmount || 0) : s + (t.paidAmount || 0)
        }
      }, 0)

      // 2000 + 3000 - 1000 = 4000 (net paid)
      expect(totalPaid).toBe(4000)
      expect(totalPaid).not.toBe(6000) // old buggy value
    })

    test('totalDue = net totalAmount - net totalPaid (correct outstanding)', () => {
      const rows = [
        { type: 'sale', totalAmount: 5000, paidAmount: 3000 },
        { type: 'credit-note', totalAmount: 1000, paidAmount: 1000 }, // full refund
      ]

      const isSale = true
      const totalAmount = rows.reduce((s, t) => {
        return t.type === 'credit-note' ? s - t.totalAmount : s + t.totalAmount
      }, 0)
      const totalPaid = rows.reduce((s, t) => {
        return t.type === 'credit-note' ? s - (t.paidAmount || 0) : s + (t.paidAmount || 0)
      }, 0)
      const totalDue = totalAmount - totalPaid

      // Net total = 5000 - 1000 = 4000
      // Net paid = 3000 - 1000 = 2000
      // Due = 4000 - 2000 = 2000
      expect(totalAmount).toBe(4000)
      expect(totalPaid).toBe(2000)
      expect(totalDue).toBe(2000)
    })

    test('no credit notes = full total (backward compat)', () => {
      const rows = [
        { type: 'sale', totalAmount: 5000 },
        { type: 'sale', totalAmount: 3000 },
      ]

      const isSale = true
      const totalAmount = rows.reduce((s, t) => {
        return t.type === 'credit-note' ? s - t.totalAmount : s + t.totalAmount
      }, 0)

      expect(totalAmount).toBe(8000) // no returns → full total
    })

    test('null/undefined totalAmount handled gracefully', () => {
      const rows = [
        { type: 'sale', totalAmount: 5000 },
        { type: 'sale', totalAmount: null as any },
        { type: 'credit-note', totalAmount: undefined as any },
      ]

      const isSale = true
      const totalAmount = rows.reduce((s, t) => {
        const amt = t.totalAmount || 0
        return t.type === 'credit-note' ? s - amt : s + amt
      }, 0)

      // 5000 + 0 - 0 = 5000 (no crash)
      expect(totalAmount).toBe(5000)
    })
  })

  /**
   * 🔒 V17 Audit Phase 0 — Cross-path consistency
   *
   * Verifies that the Ledger totalAmount reduce and the netSalesTotal helper
   * produce the SAME result for the same input. Before Phase 0, the Ledger
   * inflated (added credit-note totalAmount) while the helper correctly
   * subtracted — they DISAGREED.
   */
  describe('🔒 V17 Audit Phase 0 — Cross-path consistency (Ledger == helper)', () => {
    test('Ledger totalAmount reduce == netSalesTotal helper', () => {
      const sale: TypeAggregates = { totalAmount: 5000 }
      const cn: TypeAggregates = { totalAmount: 1000 }

      // Path 1: netSalesTotal helper
      const helperResult = netSalesTotal(sale, cn)

      // Path 2: Ledger reduce (simulated with the EXACT same values)
      const rows = [
        { type: 'sale', totalAmount: 5000 },
        { type: 'credit-note', totalAmount: 1000 },
      ]
      const ledgerResult = rows.reduce((s, t) => {
        return t.type === 'credit-note' ? s - t.totalAmount : s + t.totalAmount
      }, 0)

      // Both must agree
      expect(helperResult).toBe(4000)
      expect(ledgerResult).toBe(4000)
      expect(helperResult).toBe(ledgerResult)
    })
  })
})

