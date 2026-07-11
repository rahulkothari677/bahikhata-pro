/**
 * 🔒 V17 Audit Phase 7 — Consolidated Reports library.
 *
 * Aggregates financial data across ALL shops for an owner. Currently, all
 * queries filter by userId only (not shopId), so the data is already
 * "all shops" by default. This library provides the structure for
 * per-shop breakdowns + a consolidated total.
 *
 * Three report types:
 *   1. P&L: revenue, profit, expenses per shop + consolidated total
 *   2. GST: output tax, input tax per shop + consolidated total
 *   3. Stock: stock value per shop + consolidated total
 *
 * Pure functions — no DB import. The API route fetches the data and passes
 * it here for aggregation.
 */

import { roundMoney } from '@/lib/money'

// ─── Types ────────────────────────────────────────────────────────────────

export interface ShopAggregates {
  shopId: string
  shopName: string
  // P&L
  revenue: number
  profit: number
  expenses: number
  income: number
  netProfit: number
  // GST
  outputTax: number
  inputTax: number
  netGST: number
  // Stock
  stockValue: number
  productCount: number
  // Counts
  saleCount: number
  purchaseCount: number
}

export interface ConsolidatedReport {
  shops: ShopAggregates[]
  total: ShopAggregates
  period: { from: Date; to: Date }
}

// ─── Builder ──────────────────────────────────────────────────────────────

/**
 * Build a consolidated report from per-shop raw data.
 *
 * @param shops - array of shop metadata (id, name)
 * @param transactions - all transactions for the user in the date range
 *   (must include shopId, type, subtotal, discountAmount, grossProfit,
 *   totalAmount, cgst, sgst, igst, paymentMode)
 * @param products - all products for the user
 *   (must include shopId, currentStock, purchasePrice)
 * @param from - period start
 * @param to - period end
 * @returns consolidated report with per-shop breakdown + total
 */
export function buildConsolidatedReport(
  shops: Array<{ id: string; name: string }>,
  transactions: Array<{
    shopId: string | null
    type: string
    subtotal: number
    discountAmount: number
    grossProfit: number
    totalAmount: number
    cgst: number
    sgst: number
    igst: number
    paymentMode: string
    deletedAt: Date | null
  }>,
  products: Array<{
    shopId: string | null
    currentStock: number
    purchasePrice: number
  }>,
  from: Date,
  to: Date,
): ConsolidatedReport {
  // Build per-shop aggregates
  const shopAggregates: ShopAggregates[] = shops.map(shop => {
    const shopTxns = transactions.filter(t =>
      (t.shopId === shop.id || t.shopId === null) && t.deletedAt === null
    )
    const shopProducts = products.filter(p =>
      p.shopId === shop.id || p.shopId === null
    )

    return computeShopAggregates(shop.id, shop.name, shopTxns, shopProducts)
  })

  // Compute consolidated total
  const total = shopAggregates.reduce(
    (acc, shop) => ({
      shopId: 'consolidated',
      shopName: 'All Shops',
      revenue: roundMoney(acc.revenue + shop.revenue),
      profit: roundMoney(acc.profit + shop.profit),
      expenses: roundMoney(acc.expenses + shop.expenses),
      income: roundMoney(acc.income + shop.income),
      netProfit: roundMoney(acc.netProfit + shop.netProfit),
      outputTax: roundMoney(acc.outputTax + shop.outputTax),
      inputTax: roundMoney(acc.inputTax + shop.inputTax),
      netGST: roundMoney(acc.netGST + shop.netGST),
      stockValue: roundMoney(acc.stockValue + shop.stockValue),
      productCount: acc.productCount + shop.productCount,
      saleCount: acc.saleCount + shop.saleCount,
      purchaseCount: acc.purchaseCount + shop.purchaseCount,
    }),
    {
      shopId: 'consolidated',
      shopName: 'All Shops',
      revenue: 0, profit: 0, expenses: 0, income: 0, netProfit: 0,
      outputTax: 0, inputTax: 0, netGST: 0,
      stockValue: 0, productCount: 0,
      saleCount: 0, purchaseCount: 0,
    } as ShopAggregates,
  )

  return {
    shops: shopAggregates,
    total,
    period: { from, to },
  }
}

/**
 * Compute aggregates for a single shop from its transactions + products.
 *
 * SIGN CONVENTIONS (matching the rest of the app):
 *   - Sale grossProfit: POSITIVE
 *   - Credit-note grossProfit: NEGATIVE (reversal)
 *   - Sale/purchase totalAmount/subtotal/cgst/sgst/igst: POSITIVE (absolute)
 *   - Credit-note totalAmount: POSITIVE (absolute, but reduces revenue)
 *   - Debit-note totalAmount: POSITIVE (absolute, but reduces purchases)
 *
 * Revenue (net of returns) = Σ(sale taxable) - Σ(credit-note taxable)
 * Profit (net of returns) = Σ(sale grossProfit) + Σ(credit-note grossProfit)
 *   (credit-note grossProfit is NEGATIVE, so adding = subtracting)
 * Output tax (net) = Σ(sale GST) - Σ(credit-note GST)
 * Input tax (net) = Σ(purchase GST) - Σ(debit-note GST)
 */
function computeShopAggregates(
  shopId: string,
  shopName: string,
  txns: Array<{
    type: string
    subtotal: number
    discountAmount: number
    grossProfit: number
    totalAmount: number
    cgst: number
    sgst: number
    igst: number
  }>,
  products: Array<{
    currentStock: number
    purchasePrice: number
  }>,
): ShopAggregates {
  let revenue = 0
  let profit = 0
  let expenses = 0
  let income = 0
  let outputTax = 0
  let inputTax = 0
  let saleCount = 0
  let purchaseCount = 0

  for (const t of txns) {
    const taxable = roundMoney(t.subtotal - (t.discountAmount || 0))
    const tax = roundMoney(t.cgst + t.sgst + t.igst)

    if (t.type === 'sale') {
      revenue = roundMoney(revenue + taxable)
      profit = roundMoney(profit + (t.grossProfit || 0))
      outputTax = roundMoney(outputTax + tax)
      saleCount++
    } else if (t.type === 'credit-note') {
      // Credit notes REDUCE revenue (sales return)
      revenue = roundMoney(revenue - taxable)
      // Credit-note grossProfit is NEGATIVE, so adding = subtracting the reversal
      profit = roundMoney(profit + (t.grossProfit || 0))
      outputTax = roundMoney(outputTax - tax)
    } else if (t.type === 'purchase') {
      inputTax = roundMoney(inputTax + tax)
      purchaseCount++
    } else if (t.type === 'debit-note') {
      // Debit notes REDUCE input tax (purchase return)
      inputTax = roundMoney(inputTax - tax)
    } else if (t.type === 'expense') {
      expenses = roundMoney(expenses + t.totalAmount)
    } else if (t.type === 'income') {
      income = roundMoney(income + t.totalAmount)
    }
  }

  const netProfit = roundMoney(profit + income - expenses)
  const netGST = roundMoney(outputTax - inputTax)

  const stockValue = roundMoney(
    products.reduce((s, p) => s + (p.currentStock || 0) * (p.purchasePrice || 0), 0)
  )

  return {
    shopId,
    shopName,
    revenue,
    profit,
    expenses,
    income,
    netProfit,
    outputTax,
    inputTax,
    netGST,
    stockValue,
    productCount: products.length,
    saleCount,
    purchaseCount,
  }
}
