/**
 * What one unit earns: the selling price BEFORE GST, minus the cost.
 *
 * WHY (#134, 2 Oct 2026). The bill screen worked profit from the taxable
 * value (line-items.ts), but the product form, the inventory card, the
 * inventory table, the inventory total and the stock report all did
 * `salePrice − purchasePrice`. For an MRP product the sale price INCLUDES GST
 * while the cost does not, so the GST was counted as profit: atta sold at ₹255
 * incl. 5% (₹242.86 before GST) with a ₹230 cost showed "+₹25 (10%)" — the
 * real figure is ₹12.86 (5.3%). Two rules for one fact; this is the one rule.
 *
 * The GST in an MRP price is the government's, not the shop's: same
 * back-calculation as line-items.ts (price × 100 / (100 + rate)).
 *
 * A shop that does not charge GST (composition today; not-registered shops
 * from Phase 1c) keeps the whole price — line-items.ts charges it 0%, so this
 * does too (`chargesGst: false`).
 *
 * Margin is on the before-GST price, the same basis as the bill screen.
 */
import { roundMoney } from './money'

export interface PricedProduct {
  salePrice?: number | null
  purchasePrice?: number | null
  gstRate?: number | null
  priceIncludesGst?: boolean | null
}

export interface ProfitOptions {
  /** False for a shop that charges no GST (composition; not registered). */
  chargesGst?: boolean
}

/** The selling price before GST, unrounded — what the shop keeps from one unit. */
export function saleValueBeforeGst(p: PricedProduct, opts: ProfitOptions = {}): number {
  const price = Number(p.salePrice) || 0
  const rate = opts.chargesGst === false ? 0 : (Number(p.gstRate) || 0)
  if (!p.priceIncludesGst || rate <= 0) return price
  return (price * 100) / (100 + rate)
}

/** Profit and margin on one unit. Profit is rounded to the paisa; margin is a %. */
export function unitProfit(p: PricedProduct, opts: ProfitOptions = {}): { profit: number; margin: number } {
  const sale = saleValueBeforeGst(p, opts)
  const raw = sale - (Number(p.purchasePrice) || 0)
  return {
    profit: roundMoney(raw),
    margin: sale > 0 ? (raw / sale) * 100 : 0,
  }
}

/**
 * Today's margin % for the dashboard: profit over today's sales BEFORE GST
 * (`todayNetSales`, net of returns). Falls back to the GST-inclusive revenue
 * only for an older cached response that has no `todayNetSales`.
 */
export function todayMarginPct(kpis: { todayProfit?: number | null; todayNetSales?: number | null; todayRevenue?: number | null }): number {
  const base = typeof kpis.todayNetSales === 'number' ? kpis.todayNetSales : (Number(kpis.todayRevenue) || 0)
  return base > 0 ? ((Number(kpis.todayProfit) || 0) / base) * 100 : 0
}

/**
 * Profit if the stock on hand sold at today's price. Oversold stock counts as
 * zero (R15-4). Worked on the unrounded per-unit price, so 10 packs at
 * ₹242.857 is ₹2,428.57 − ₹2,300 = ₹128.57, not 10 × ₹12.86 = ₹128.60.
 *
 * Rounded exactly as the stock report's SQL rounds it (sale value and cost
 * value each to the paisa, then subtracted), so the inventory screen and the
 * report can never show two numbers for one amount.
 */
export function stockPotentialProfit(p: PricedProduct & { currentStock?: number | null }, opts: ProfitOptions = {}): number {
  const qty = Math.max(0, Number(p.currentStock) || 0)
  return roundMoney(roundMoney(qty * saleValueBeforeGst(p, opts)) - roundMoney(qty * (Number(p.purchasePrice) || 0)))
}
