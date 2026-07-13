/**
 * V17 Audit §1 FIX — Net-of-returns helpers.
 *
 * THE PROBLEM (auditor finding §1):
 *   "Revenue" was spelled `type='sale'` in ~15 places across the dashboard,
 *   P&L report, and GST report. Credit notes (type='credit-note') — which
 *   represent sales returns — were a separate type and were never subtracted
 *   from revenue, profit, or output tax. So a shop that accepted a ₹3,000
 *   return on ₹10,000 of sales still saw ₹10,000 revenue everywhere except
 *   the formal GSTR-1/3B (which was correct).
 *
 * THE FIX:
 *   These pure functions compute NET values: sale − credit-note (for outward)
 *   and purchase − debit-note (for inward). They take pre-fetched aggregate
 *   objects (from Prisma groupBy or raw SQL) and return rounded net values.
 *
 *   Every screen that shows "revenue", "profit", or "output tax" must call
 *   these helpers instead of reading `type='sale'` directly. This gives one
 *   definition of revenue, tested once, used everywhere — the same discipline
 *   that fixed the party-balance saga.
 *
 * PURE FUNCTION DESIGN:
 *   These functions take primitive numbers (not DB objects) so they're fully
 *   testable without mocking Prisma. The caller is responsible for fetching
 *   the aggregate sums (subtotal, discountAmount, cgst, sgst, igst,
 *   grossProfit) for both 'sale' and 'credit-note' types, then passing them
 *   here. This keeps the DB query strategy (single consolidated raw SQL vs
 *   parallel groupBy) in the route file where it belongs.
 */

import { roundMoney } from '@/lib/money'

/**
 * Input shape: the aggregate sums for a single transaction type.
 * All fields are numbers (already converted from Prisma Decimal/string).
 * Missing/undefined fields are treated as 0.
 */
export interface TypeAggregates {
  subtotal?: number | null
  discountAmount?: number | null
  totalAmount?: number | null
  grossProfit?: number | null
  cgst?: number | null
  sgst?: number | null
  igst?: number | null
}

/**
 * Net sales taxable value = sale taxable − credit-note taxable.
 *
 * "Taxable value" = subtotal − discountAmount (the GST base, not the
 * invoice total). A credit note reduces this because it reverses a sale.
 *
 * Used by: P&L totalRevenue, dashboard range_revenue (via SQL).
 * Null-safe: null/undefined aggregates are treated as 0 (no data for that type).
 */
export function netSalesTaxable(sale: TypeAggregates | null | undefined, creditNote: TypeAggregates | null | undefined): number {
  const s = sale || {}
  const c = creditNote || {}
  const saleTaxable = (s.subtotal || 0) - (s.discountAmount || 0)
  const cnTaxable = (c.subtotal || 0) - (c.discountAmount || 0)
  return roundMoney(saleTaxable - cnTaxable)
}

/**
 * Net sales profit = sale grossProfit + credit-note grossProfit.
 *
 * 🔒 V17 Audit Phase 4 SIGN-CONVENTION FIX:
 * Credit notes store NEGATIVE grossProfit (a return reverses profit, so
 * line-items.ts stores -itemProfit). Therefore we ADD the credit-note
 * grossProfit (adding a negative = subtracting the reversal).
 *
 * sale.grossProfit = +3000, creditNote.grossProfit = -900
 * net = 3000 + (-900) = 2100 ✅
 *
 * BEFORE this fix: the helper used `s.grossProfit - c.grossProfit` which
 * produced `3000 - (-900) = 3900` — profit was INFLATED by the return amount.
 * This was a regression of the original §1 bug in the opposite direction.
 *
 * Used by: P&L grossProfit, dashboard range_profit (via SQL).
 * Null-safe: null/undefined aggregates are treated as 0.
 */
export function netSalesProfit(sale: TypeAggregates | null | undefined, creditNote: TypeAggregates | null | undefined): number {
  const s = sale || {}
  const c = creditNote || {}
  return roundMoney((s.grossProfit || 0) + (c.grossProfit || 0))
}

/**
 * Net output tax = sale GST − credit-note GST.
 *
 * Output tax (CGST+SGST+IGST) is reduced by credit notes because a return
 * reverses the tax charged on the original sale. This keeps the management
 * GST view consistent with GSTR-1/3B (which already net credit notes).
 *
 * Used by: GST report outputTax, dashboard GST summary.
 * Null-safe: null/undefined aggregates are treated as 0.
 */
export function netOutputTax(sale: TypeAggregates | null | undefined, creditNote: TypeAggregates | null | undefined): number {
  const s = sale || {}
  const c = creditNote || {}
  const saleTax = (s.cgst || 0) + (s.sgst || 0) + (s.igst || 0)
  const cnTax = (c.cgst || 0) + (c.sgst || 0) + (c.igst || 0)
  return roundMoney(saleTax - cnTax)
}

/**
 * Net purchases taxable = purchase taxable − debit-note taxable.
 *
 * A debit note (purchase return) reverses a purchase. Net purchases gives
 * the true inward supply value.
 *
 * Used by: P&L purchaseTotal (future), dashboard range_purchases.
 * Null-safe: null/undefined aggregates are treated as 0.
 */
export function netPurchasesTaxable(purchase: TypeAggregates | null | undefined, debitNote: TypeAggregates | null | undefined): number {
  const p = purchase || {}
  const d = debitNote || {}
  const purchTaxable = (p.subtotal || 0) - (p.discountAmount || 0)
  const dnTaxable = (d.subtotal || 0) - (d.discountAmount || 0)
  return roundMoney(purchTaxable - dnTaxable)
}

/**
 * Net input tax = purchase GST − debit-note GST.
 *
 * Input tax (ITC) is reduced by debit notes because a purchase return
 * reverses the ITC claimed on the original purchase. This keeps the
 * management GST view consistent with GSTR-2B/3B.
 *
 * Used by: GST report inputTax, dashboard rangeInputTax.
 * Null-safe: null/undefined aggregates are treated as 0.
 */
export function netInputTax(purchase: TypeAggregates | null | undefined, debitNote: TypeAggregates | null | undefined): number {
  const p = purchase || {}
  const d = debitNote || {}
  const purchTax = (p.cgst || 0) + (p.sgst || 0) + (p.igst || 0)
  const dnTax = (d.cgst || 0) + (d.sgst || 0) + (d.igst || 0)
  return roundMoney(purchTax - dnTax)
}

/**
 * Net sales total amount = sale totalAmount − credit-note totalAmount.
 *
 * "Total amount" = invoice total (including GST). Used by dashboard
 * today_revenue / range_revenue which display the total (not taxable).
 * A credit note's totalAmount is positive, so we subtract it.
 *
 * Note: for revenue display, "total amount" is used (what the customer
 * was charged). For P&L, "taxable value" is used (the GST base). Both
 * must be net of returns.
 * Null-safe: null/undefined aggregates are treated as 0.
 */
export function netSalesTotal(sale: TypeAggregates | null | undefined, creditNote: TypeAggregates | null | undefined): number {
  const s = sale || {}
  const c = creditNote || {}
  return roundMoney((s.totalAmount || 0) - (c.totalAmount || 0))
}
