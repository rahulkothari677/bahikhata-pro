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

/**
 * What the CUSTOMER pays for one unit: the price with GST on top for a GST shop
 * pricing before GST; the price itself for an MRP (GST-inclusive) price or a
 * shop that charges no GST. Rounded to the paisa.
 */
export function customerPaysPerUnit(p: PricedProduct, opts: ProfitOptions = {}): number {
  const price = Number(p.salePrice) || 0
  const rate = opts.chargesGst === false ? 0 : (Number(p.gstRate) || 0)
  return roundMoney(p.priceIncludesGst || rate <= 0 ? price : price * (100 + rate) / 100)
}

/**
 * Phase 5e-5 (#264): is the customer's price above the printed MRP? Legal
 * Metrology (Packaged Commodities) Rules 2011, rule 18(2): no sale of a packed
 * commodity above its retail sale price (MRP). The bill engine keeps an MRP
 * line exactly at MRP (line-items.ts, #98); this tells the product form when
 * the price itself would break it. No MRP → nothing to break.
 */
export function aboveMrp(p: PricedProduct & { mrp?: number | null }, opts: ProfitOptions = {}): boolean {
  const mrp = Number(p.mrp) || 0
  return mrp > 0 && Math.round(customerPaysPerUnit(p, opts) * 100) > Math.round(mrp * 100)
}

/**
 * #254 (Phase 6a, Rahul's decision 21 Oct): does this item have a cost price?
 * Small shops often save an item without one. With cost ₹0 every sale booked
 * its whole value as profit (Home's profit could read as the whole sales),
 * while a typed-in line booked ₹0 and the profit sheet said "profit not
 * counted". Now cost ₹0 means "no cost price" everywhere: the bill books no
 * profit on the line, screens say "No cost price", and potential profit leaves
 * the item out. The SQL twin is NO_COST_LINE (lib/insights-queries.ts).
 */
export function hasCostPrice(p: { purchasePrice?: number | null }): boolean {
  return (Number(p.purchasePrice) || 0) > 0
}

/**
 * A saved bill line whose profit is not counted: typed in (no item) or its
 * item had no cost price when sold. The JS twin of NO_COST_LINE, line for line.
 */
export function isNoCostLine(line: { productId?: string | null; purchasePriceAtSale?: number | null }): boolean {
  return !line.productId || !hasCostPrice({ purchasePrice: line.purchasePriceAtSale })
}

/**
 * #254: margin % over the sales that HAVE a cost price — profit ÷ (sales −
 * sales with no cost price), to 1 decimal. Their profit is not counted, so
 * leaving their sales under the line would shrink every margin. null when
 * everything sold had no cost price (nothing to measure: shown "No cost
 * price"); 0 when nothing was sold. Signed inputs: a return is negative.
 */
export function marginOnCosted(profit: number, sales: number, noCostSales: number): number | null {
  const costed = roundMoney(sales - noCostSales)
  if (costed !== 0) return Math.round((profit / costed) * 1000) / 10
  return roundMoney(noCostSales) !== 0 ? null : 0
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
  // #254: with no cost price there is no profit to promise — never the whole sale value.
  if (!hasCostPrice(p)) return 0
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

/**
 * What one unit earns at today's sale price on a purchase at `line`'s rate —
 * Insights → Profit's "cost went up" (Phase 5c-4). The sale price before GST
 * minus the cost as the shop really paid it, both by the rules above.
 *
 * It was `salePrice − unitPrice` in the engine (19 Oct, found on the live
 * check): the #134 example exactly — atta at ₹255 incl. 5% on a ₹230 cost
 * read "you earn ₹25", the real figure is ₹12.86.
 */
export function earnPerUnit(
  product: PricedProduct,
  line: { unitPrice: number; gstRate?: number | null },
  opts: { chargesGst: boolean; claimsItc: boolean },
): number {
  return roundMoney(saleValueBeforeGst(product, { chargesGst: opts.chargesGst }) - purchaseCostPerUnit(line, { claimsItc: opts.claimsItc }))
}
