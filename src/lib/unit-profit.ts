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

/**
 * What one unit of a PURCHASE line cost the shop — the figure written back as
 * the product's cost. (#175, Phase 1c, 2 Oct 2026)
 *
 * A shop that claims input credit gets the GST back, so its cost is the price
 * before GST (`unitPrice`). A shop that cannot — not registered, composition
 * (Section 10(4)), or a purchase whose credit is blocked (Section 17(5)) —
 * paid that GST for good, so it is part of the cost: ₹230 + 5% is a ₹241.50
 * cost, not ₹230. Otherwise stock value and every later profit leave out
 * money the shop actually spent.
 *
 * Per the product's unit, before any bill discount — the same basis the
 * before-GST cost has always used.
 */
export function purchaseCostPerUnit(
  line: { unitPrice: number; gstRate?: number | null },
  opts: { claimsItc: boolean },
): number {
  const price = Number(line.unitPrice) || 0
  if (opts.claimsItc) return roundMoney(price)
  return roundMoney((price * (100 + (Number(line.gstRate) || 0))) / 100)
}

/**
 * The supplier's before-GST rate implied by the product's saved cost — the
 * inverse of purchaseCostPerUnit(), for pre-filling a purchase line.
 *
 * For a shop that cannot claim the GST back, the saved cost INCLUDES the GST
 * (#175). Pre-filling that as the supplier's rate and adding GST again made
 * each purchase raise the cost by another 5%: ₹241.50 → ₹253.58 → … (found
 * first-hand, 2 Oct 2026). So the GST comes back out: ₹241.50 @5% → ₹230.
 */
export function purchaseRateFromCost(
  product: { purchasePrice?: number | null; gstRate?: number | null },
  opts: { claimsItc: boolean },
): number {
  const cost = Number(product.purchasePrice) || 0
  if (opts.claimsItc) return cost
  return roundMoney((cost * 100) / (100 + (Number(product.gstRate) || 0)))
}
