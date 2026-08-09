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
  /**
   * HSN as it was when the line was saved — a snapshot, not a live join.
   * GSTR-1 Table 12, the HSN summary and the e-invoice IRN all read this.
   * Null is legal: HSN is optional for small B2C supplies under Notification
   * 78/2020, so the gap is reported at filing time rather than blocking a sale.
   */
  hsn: string | null
  /** taxable | nil | exempt | nonGst, as it was when the line was saved. */
  gstTreatment: string | null
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

  /*
   * CGST/SGST are split ONCE across the invoice, allocated line by line.
   *
   * WHY (2026-08-07, money sweep). splitGstPaise gives the odd paisa to CGST —
   * a deliberate, documented rule, and correct when applied once. It was being
   * applied to EVERY line, so each line with an odd-paise tax handed CGST
   * another paisa. Three lines of ₹10.10 at 5% (invoice INV-0060, verified on
   * the live invoice screen) printed CGST ₹0.78 against SGST ₹0.75 — three
   * paise apart, on a GST invoice where the two are by definition equal halves.
   * A 40-line grocery bill could be 40 paise apart, on every sale.
   *
   * The rupees are trivial; being visibly wrong on a tax document is not.
   *
   * The allocation below keeps a running total of intra-state GST and gives
   * each line the difference between the ideal CGST for the running total and
   * what has already been allocated. Two properties matter:
   *
   *   - The line values still SUM to the invoice values, which the header
   *     derivation below depends on, and which the HSN summary reads.
   *   - No line can go negative. The naive fix — dump the whole correction on
   *     the last line — breaks exactly that: forty lines of one paise tax each
   *     would need a 20 paise correction taken out of a line holding one, and
   *     the last line's SGST would go through zero into negative territory.
   */
  let runningIntraGstPaise = 0
  let allocatedCgstPaise = 0

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
      // Split the RUNNING TOTAL, then give this line only the increment. The
      // odd-paisa-to-CGST rule therefore applies once per invoice, not once
      // per line — see the note above the declarations.
      runningIntraGstPaise = addPaise(runningIntraGstPaise, itemGstPaise)
      const idealCgstSoFar = splitGstPaise(runningIntraGstPaise).cgst
      itemCgstPaise = idealCgstSoFar - allocatedCgstPaise
      itemSgstPaise = itemGstPaise - itemCgstPaise  // line total tax unchanged
      allocatedCgstPaise = idealCgstSoFar
      cgstPaise = addPaise(cgstPaise, itemCgstPaise)
      sgstPaise = addPaise(sgstPaise, itemSgstPaise)
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
      /*
       * HSN snapshotted at sale time, like purchasePriceAtSale above.
       *
       * WHY (2026-08-07, money sweep). The column existed, GSTR-1 Table 12 read
       * it, the HSN summary read it and the e-invoice IRN builder read it — and
       * nothing had ever written it. The only code that put an HSN on a sale
       * line was restoring from a backup. So every invoice the app had ever
       * produced carried a blank HSN, Table 12 came back with zero rows against
       * ₹9,938.90 of reported sales, and that return cannot be filed: an empty
       * HSN table beside a non-zero turnover is precisely the contradiction the
       * department picks up. E-invoicing would have rejected it too — HSN is a
       * required field in the NIC schema.
       *
       * A SNAPSHOT, not a join to the product, and that distinction is the
       * whole point. Edit a product's HSN next year and last year's filed
       * GSTR-1 must not silently change underneath you; a filed return is a
       * historical fact. Same reasoning as purchasePriceAtSale, which exists so
       * that changing a cost price today cannot rewrite last year's profit.
       *
       * Null stays null. Under Notification 78/2020 HSN is mandatory on B2B
       * invoices — four digits below ₹5 crore turnover, six above — but optional
       * for small B2C supplies, so refusing to save a counter sale without one
       * would be stricter than the law and would stop a shopkeeper mid-sale.
       * The gap is surfaced at filing time instead, which is when a CA needs it.
       */
      /*
       * The product's code wins; a line WITHOUT a product falls back to the one
       * supplied on the line itself.
       *
       * `p.product?.hsn || null` alone discarded any HSN sent on a free-text
       * line, because those have no product to read from. Two consequences, and
       * the second is the one that bites: such a line can never reach GSTR-1
       * Table 12, and — since a missing code is read as "goods" — every service
       * billed as free text over ₹50,000 raised a false e-way bill warning.
       * That lands on exactly the service shops this app just added advances
       * for.
       *
       * Still a snapshot either way: whatever is resolved here is frozen on the
       * line, so editing a product's HSN next year cannot rewrite a filed
       * return.
       */
      hsn: p.product?.hsn || (p.item as { hsn?: string | null })?.hsn || null,
      /*
       * GST treatment snapshotted for the same reason as hsn above: Table 8
       * reports nil-rated, exempt and non-GST in separate boxes, and buildNIL
       * could only ever see the rate. Reclassifying a product next year must
       * not rewrite a return already filed under the old treatment.
       */
      gstTreatment: p.product?.gstTreatment || null,
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
