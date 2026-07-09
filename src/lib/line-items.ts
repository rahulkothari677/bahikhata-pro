/**
 * 🔒 V12: Shared line-item computation for sale/purchase transactions.
 *
 * POST and PUT previously duplicated the per-item money math. Duplication is
 * exactly what caused earlier GST drift bugs, so this centralizes it: ONE
 * function computes taxable value, GST split, profit, and the stored line
 * fields — used by both create and edit.
 *
 * It folds in the V12 fixes:
 *   - UNIT NORMALIZATION: for product-linked lines, the entered quantity is
 *     converted into the product's unit (500 gm on a ₹20/kg product → 0.5 kg),
 *     so quantity × unitPrice and stock decrements are always consistent. This
 *     is the fix for the "500 gm × ₹20 = ₹10,000" bug and the stock-corruption
 *     bug in one place.
 *   - GST-INCLUSIVE (MRP): when a line's price includes GST, the taxable unit
 *     price is back-calculated (price × 100/(100+rate)) so the stored line and
 *     all reports stay GST-correct.
 *   - PROPORTIONAL DISCOUNT (V10 §2.1): the order-level discount is distributed
 *     across items by taxable share BEFORE GST.
 */

import { roundMoney, calculateGst, splitGst, distributeDiscountProportionally, toMoney } from './money'
import { normalizeUnitName, resolveEnteredQuantity, isSubUnit } from './units'

export interface RawLineItem {
  productId?: string | null
  productName: string
  quantity: number | string
  unitPrice: number | string
  gstRate?: number | string
  unit?: string
  priceIncludesGst?: boolean
}

export interface StoredLineItem {
  productId: string | null
  productName: string
  quantity: number       // normalized into the product's unit for linked lines
  unit: string           // the unit `quantity` is expressed in
  unitPrice: number      // TAXABLE (ex-GST) price per `unit`
  purchasePriceAtSale: number
  gstRate: number
  discountAmount: number
  cgst: number
  sgst: number
  igst: number
  total: number          // taxable + gst
}

export interface LineItemResult {
  txItems: StoredLineItem[]
  subtotal: number       // Σ pre-discount taxable value
  cgst: number
  sgst: number
  igst: number
  grossProfit: number
  totalBeforeRoundOff: number  // (subtotal - discount) + gst
}

/**
 * Compute all stored line items + header totals for a sale/purchase.
 * `orderDiscount` must already be validated (≤ subtotal) by the caller.
 */
export function computeLineItems(opts: {
  items: RawLineItem[]
  productMap: Map<string, any>
  isInterState: boolean
  orderDiscount: number
  type: string
}): LineItemResult {
  const { items, productMap, isInterState, orderDiscount, type } = opts

  // Step 1: normalize each line (unit + GST-inclusive → taxable unit price).
  const prepared = items.map((item) => {
    const product = item.productId ? productMap.get(item.productId) : null
    // 🔒 V12.3: Normalize via resolveEnteredQuantity for EVERY line, not just
    // product-linked ones. Linked → product's unit. UNLINKED sub-unit (gm/ml/cm)
    // → the family's base unit (500 gm → 0.5 kg), because an Indian price like
    // "₹20" on a gm/ml line almost always means per kg/ltr. Previously an
    // unlinked scanned/typed "500 gm × ₹20" line skipped normalization and
    // stored ₹10,000 — the scanner flow hit this every time (no product match).
    const rawUnit = normalizeUnitName(item.unit || product?.unit || 'pcs')
    const norm = resolveEnteredQuantity(toMoney(item.quantity), rawUnit, product?.unit)
    const quantity = norm.quantity
    const unit = norm.unit
    const gstRate = toMoney(item.gstRate) || 0
    const enteredPrice = toMoney(item.unitPrice)
    // GST-inclusive: back-calculate the taxable (ex-GST) unit price so the
    // stored line and all reports are GST-correct. Falls back to product flag.
    const includesGst = item.priceIncludesGst ?? product?.priceIncludesGst ?? false
    const unitPrice = includesGst && gstRate > 0
      ? roundMoney((enteredPrice * 100) / (100 + gstRate))
      : enteredPrice
    return { item, product, quantity, unit, gstRate, unitPrice }
  })

  // Step 2: pre-discount taxable value per line = quantity × taxable unit price.
  const grossAmounts = prepared.map((p) => roundMoney(p.quantity * p.unitPrice))
  const perItemDiscounts = distributeDiscountProportionally(grossAmounts, toMoney(orderDiscount))

  let subtotal = 0
  let cgst = 0, sgst = 0, igst = 0
  let grossProfit = 0

  const txItems: StoredLineItem[] = prepared.map((p, idx) => {
    const grossAmount = grossAmounts[idx]
    const itemDiscount = roundMoney(perItemDiscounts[idx])
    const taxableAmount = roundMoney(grossAmount - itemDiscount)  // post-discount
    const itemGst = calculateGst(taxableAmount, p.gstRate)         // GST on post-discount
    const itemTotal = roundMoney(taxableAmount + itemGst)
    subtotal = roundMoney(subtotal + grossAmount)

    let itemCgst = 0, itemSgst = 0, itemIgst = 0
    if (isInterState) {
      itemIgst = itemGst
      igst = roundMoney(igst + itemGst)
    } else {
      const { cgst: c, sgst: s } = splitGst(itemGst)
      itemCgst = c
      itemSgst = s
      cgst = roundMoney(cgst + c)
      sgst = roundMoney(sgst + s)
    }

    // Profit on the post-discount realized price (V10 §2.4). quantity is now in
    // the product's unit, so purchasePrice (per product unit) lines up exactly.
    let purchasePriceAtSale = 0
    if (type === 'sale' && p.product) {
      purchasePriceAtSale = p.product.purchasePrice
      const realizedUnitPrice = p.quantity > 0 ? roundMoney(taxableAmount / p.quantity) : 0
      grossProfit = roundMoney(grossProfit + (realizedUnitPrice - p.product.purchasePrice) * p.quantity)
    }

    return {
      productId: p.item.productId || null,
      productName: p.item.productName,
      quantity: p.quantity,
      unit: p.unit,
      unitPrice: p.unitPrice,
      purchasePriceAtSale,
      gstRate: p.gstRate,
      discountAmount: itemDiscount,
      cgst: itemCgst,
      sgst: itemSgst,
      igst: itemIgst,
      total: itemTotal,
    }
  })

  // 🔒 V17-Ext Reconciliation FIX: Header CGST/SGST/IGST must EXACTLY equal
  // the sum of the per-item values. Was: accumulated during the loop with
  // roundMoney at each step (cgst = roundMoney(cgst + c)). That can drift from
  // Postgres SUM(item.cgst) due to float accumulation differences.
  //
  // Now: after all items are computed, derive the header from the stored item
  // values. This makes the header a DERIVED value — by construction,
  // SUM(headers) = SUM(items), so the reconciliation check always passes.
  cgst = roundMoney(txItems.reduce((sum, item) => sum + item.cgst, 0))
  sgst = roundMoney(txItems.reduce((sum, item) => sum + item.sgst, 0))
  igst = roundMoney(txItems.reduce((sum, item) => sum + item.igst, 0))

  const totalBeforeRoundOff = roundMoney((subtotal - toMoney(orderDiscount)) + cgst + sgst + igst)

  return { txItems, subtotal, cgst, sgst, igst, grossProfit, totalBeforeRoundOff }
}

export interface PriceWarning {
  productId: string | null
  productName: string
  message: string
}

/**
 * 🔒 V12 anomaly guardrail — defense-in-depth against unit/price mistakes like
 * the "₹20/kg entered as ₹20/gm → ₹10,000 tomato". Non-blocking: the sale still
 * saves, but the UI shows a warning the shopkeeper can act on.
 */
export function buildPriceWarnings(
  items: RawLineItem[],
  productMap: Map<string, any>,
): PriceWarning[] {
  const warnings: PriceWarning[] = []
  for (const item of items) {
    const price = toMoney(item.unitPrice)
    const product = item.productId ? productMap.get(item.productId) : null
    const unit = normalizeUnitName(item.unit || product?.unit || 'pcs')

    if (product && product.salePrice > 0 && price > 0) {
      // Compare the entered price to the catalog price (per product unit).
      const ratio = price / product.salePrice
      if (ratio > 5 || ratio < 0.2) {
        warnings.push({
          productId: product.id,
          productName: product.name,
          message: `Entered price ₹${price} is very different from the saved price ₹${product.salePrice}/${product.unit}. Please double-check.`,
        })
      }
    } else if (!product && isSubUnit(unit) && price > 100) {
      // Unlinked sub-unit line priced implausibly high (e.g. ₹20 "per gm").
      warnings.push({
        productId: null,
        productName: item.productName,
        message: `₹${price} per ${unit} looks high. If you meant ₹${price} per kg/ltr, change the unit or the price.`,
      })
    }
  }
  return warnings
}
