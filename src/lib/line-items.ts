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
 *
 * 🔒 V17 PAISE MIGRATION Phase 3: All internal math is now done in PAISE
 * (integer arithmetic) to eliminate float drift. See computeLineItems docblock.
 */

import { roundMoney, calculateGst, splitGst, distributeDiscountProportionally, toMoney, toPaise, fromPaise, multiplyPaise, calculateGstPaise, splitGstPaise, addPaise } from './money'
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
  // 🔒 V17 Audit Phase 10: Original entered values (before normalization)
  enteredQuantity: number  // what the user typed (e.g., 500 for 500ml)
  enteredUnit: string      // the unit the user selected (e.g., 'ml')
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
 *
 * 🔒 V17 PAISE MIGRATION Phase 3: All internal math is now done in PAISE
 * (integer arithmetic) to eliminate float drift. Inputs are converted to
 * paise at the top, all calculations use integer arithmetic (multiplyPaise,
 * calculateGstPaise, splitGstPaise, addPaise), and results are converted
 * back to rupees (via fromPaise) at the return boundary.
 *
 * This is a PURE REFACTOR — the output is byte-identical to the previous
 * rupee-based implementation. The paise helpers apply the same 1e-9 nudge
 * as roundMoney, so the rounding behavior is preserved exactly.
 *
 * When Phase 4 migrates the DB columns from Float (rupees) to Int (paise),
 * the final fromPaise() conversions at the return boundary can be removed —
 * the paise values will be written directly to the Int columns.
 */
export function computeLineItems(opts: {
  items: RawLineItem[]
  productMap: Map<string, any>
  isInterState: boolean
  orderDiscount: number
  type: string
}): LineItemResult {
  const { items, productMap, isInterState, orderDiscount, type } = opts

  // 🔒 V17 Phase 3: Convert order discount to paise once (integer for all math)
  const orderDiscountPaise = toPaise(toMoney(orderDiscount))

  // Step 1: normalize each line (unit + GST-inclusive -> taxable unit price).
  // 🔒 V17 Phase 3: unitPrice is converted to paise immediately. All downstream
  // math (grossAmount, discount, GST, profit) uses paise arithmetic.
  const prepared = items.map((item) => {
    const product = item.productId ? productMap.get(item.productId) : null
    // 🔒 V12.3: Normalize via resolveEnteredQuantity for EVERY line, not just
    // product-linked ones. Linked -> product's unit. UNLINKED sub-unit (gm/ml/cm)
    // -> the family's base unit (500 gm -> 0.5 kg), because an Indian price like
    // "₹20" on a gm/ml line almost always means per kg/ltr. Previously an
    // unlinked scanned/typed "500 gm × ₹20" line skipped normalization and
    // stored ₹10,000 — the scanner flow hit this every time (no product match).
    const rawUnit = normalizeUnitName(item.unit || product?.unit || 'pcs')
    const rawQuantity = toMoney(item.quantity)  // 🔒 preserve original before normalization
    const norm = resolveEnteredQuantity(rawQuantity, rawUnit, product?.unit)
    const quantity = norm.quantity
    const unit = norm.unit
    const gstRate = toMoney(item.gstRate) || 0
    const enteredPriceRupees = toMoney(item.unitPrice)
    // GST-inclusive: back-calculate the taxable (ex-GST) unit price so the
    // stored line and all reports stay GST-correct. Falls back to product flag.
    // 🔒 V17 Phase 3: back-calc in RUPEES (matches old behavior), then convert to paise.
    // The back-calc formula (price * 100 / (100 + rate)) needs rupee-level precision
    // to match the old roundMoney behavior. Converting to paise after roundMoney
    // preserves the exact same unitPrice value.
    const includesGst = item.priceIncludesGst ?? product?.priceIncludesGst ?? false
    const unitPriceRupees = includesGst && gstRate > 0
      ? roundMoney((enteredPriceRupees * 100) / (100 + gstRate))
      : enteredPriceRupees
    const unitPricePaise = toPaise(unitPriceRupees)
    return { item, product, quantity, unit, gstRate, unitPriceRupees, unitPricePaise, rawQuantity, rawUnit }
  })

  // Step 2: pre-discount taxable value per line = quantity × taxable unit price (in paise).
  // 🔒 V17 Phase 3: multiplyPaise does Math.round(qty * pricePaise) — integer result, no drift.
  const grossAmountsPaise = prepared.map((p) => multiplyPaise(p.quantity, p.unitPricePaise))
  // 🔒 V17 Phase 3: distributeDiscountProportionally works in rupees (roundMoney-based).
  // Convert gross amounts to rupees for the distribution, then convert the per-item
  // discounts back to paise. This preserves the exact same proportional distribution
  // as the old code (the function uses roundMoney internally).
  const grossAmountsRupees = grossAmountsPaise.map(gp => fromPaise(gp))
  const perItemDiscountsRupees = distributeDiscountProportionally(grossAmountsRupees, toMoney(orderDiscount))
  const perItemDiscountsPaise = perItemDiscountsRupees.map(d => toPaise(d))

  let subtotalPaise = 0
  let cgstPaise = 0, sgstPaise = 0, igstPaise = 0
  let grossProfitPaise = 0

  const txItems: StoredLineItem[] = prepared.map((p, idx) => {
    const grossAmountPaise = grossAmountsPaise[idx]
    const itemDiscountPaise = perItemDiscountsPaise[idx]
    const taxableAmountPaise = grossAmountPaise - itemDiscountPaise  // integer subtraction, exact
    const itemGstPaise = calculateGstPaise(taxableAmountPaise, p.gstRate)  // integer GST
    const itemTotalPaise = taxableAmountPaise + itemGstPaise  // integer addition, exact
    subtotalPaise = addPaise(subtotalPaise, grossAmountPaise)

    let itemCgstPaise = 0, itemSgstPaise = 0, itemIgstPaise = 0
    if (isInterState) {
      itemIgstPaise = itemGstPaise
      igstPaise = addPaise(igstPaise, itemGstPaise)
    } else {
      const { cgst, sgst } = splitGstPaise(itemGstPaise)  // integer split, exact
      itemCgstPaise = cgst
      itemSgstPaise = sgst
      cgstPaise = addPaise(cgstPaise, cgst)
      sgstPaise = addPaise(sgstPaise, sgst)
    }

    // Profit on the post-discount realized price (V10 §2.4).
    // 🔒 V17 Audit §1 FIX: Credit notes (type='credit-note') must compute a
    // NEGATIVE grossProfit — they reverse the profit booked on the original sale.
    //
    // 🔒 V17 Phase 3: profit calc in paise. realizedUnitPrice = taxableAmountPaise / quantity
    // (a Float division, then round to nearest paisa). profit = (realized - purchasePrice) * qty.
    // To match old behavior exactly, we compute in rupees (the old code used roundMoney on
    // Float values). Converting to paise for the final accumulation.
    let purchasePriceAtSale = 0
    let itemProfitPaise = 0
    if ((type === 'sale' || type === 'credit-note') && p.product) {
      purchasePriceAtSale = p.product.purchasePrice
      const taxableAmountRupees = fromPaise(taxableAmountPaise)
      const realizedUnitPriceRupees = p.quantity > 0 ? roundMoney(taxableAmountRupees / p.quantity) : 0
      const itemProfitRupees = roundMoney((realizedUnitPriceRupees - p.product.purchasePrice) * p.quantity)
      itemProfitPaise = toPaise(itemProfitRupees)
      // Credit notes NEGATE the profit (they reverse the original sale's profit).
      // Sales ADD the profit. This way, sale + credit-note = net profit.
      grossProfitPaise = type === 'credit-note'
        ? addPaise(grossProfitPaise, -itemProfitPaise)  // subtract (reverse)
        : addPaise(grossProfitPaise, itemProfitPaise)   // add (normal sale)
    }

    // 🔒 V17 Phase 3: Convert paise values back to rupees for the StoredLineItem.
    // The StoredLineItem interface uses rupee Floats (matching the DB column type).
    // When Phase 4 migrates columns to Int, these fromPaise() calls can be removed.
    return {
      productId: p.item.productId || null,
      productName: p.item.productName,
      quantity: p.quantity,
      unit: p.unit,
      unitPrice: p.unitPriceRupees,
      purchasePriceAtSale,
      gstRate: p.gstRate,
      discountAmount: fromPaise(itemDiscountPaise),
      cgst: fromPaise(itemCgstPaise),
      sgst: fromPaise(itemSgstPaise),
      igst: fromPaise(itemIgstPaise),
      total: fromPaise(itemTotalPaise),
      // 🔒 V17 Audit Phase 10: preserve the user's original input
      enteredQuantity: p.rawQuantity,
      enteredUnit: p.rawUnit,
    }
  })

  // 🔒 V17-Ext Reconciliation FIX: Header CGST/SGST/IGST must EXACTLY equal
  // the sum of the per-item values. Derive from stored items (integer sum in paise).
  // 🔒 V17 Phase 3: addPaise with spread does integer sum — no float drift.
  cgstPaise = addPaise(...txItems.map(item => toPaise(item.cgst)))
  sgstPaise = addPaise(...txItems.map(item => toPaise(item.sgst)))
  igstPaise = addPaise(...txItems.map(item => toPaise(item.igst)))

  // 🔒 V17 Phase 3: totalBeforeRoundOff in paise (integer arithmetic), then convert to rupees.
  const totalBeforeRoundOffPaise = subtotalPaise - orderDiscountPaise + cgstPaise + sgstPaise + igstPaise

  // 🔒 V17 Phase 3: Convert all paise values back to rupees for the return.
  // roundMoney is applied to the rupee values to handle any float drift from the
  // fromPaise division (though paise values are exact integers, /100 can produce
  // float artifacts like 0.30000000000000004).
  return {
    txItems,
    subtotal: roundMoney(fromPaise(subtotalPaise)),
    cgst: roundMoney(fromPaise(cgstPaise)),
    sgst: roundMoney(fromPaise(sgstPaise)),
    igst: roundMoney(fromPaise(igstPaise)),
    grossProfit: roundMoney(fromPaise(grossProfitPaise)),
    totalBeforeRoundOff: roundMoney(fromPaise(totalBeforeRoundOffPaise)),
  }
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
