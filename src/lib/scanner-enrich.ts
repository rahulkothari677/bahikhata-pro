/**
 * 🔒 Phase 7 — Extracted pure functions from BillScanner.tsx for testing.
 *
 * enrichScannedItems was a closure inside the component with zero tests.
 * It directly computes the unit price, GST, and line totals that become
 * the stored invoice. A bug here means wrong invoice amounts.
 */

import { roundMoney } from '@/lib/money'
import { resolveEnteredQuantity } from '@/lib/units'

export interface RawScannedItem {
  name?: string
  productName?: string
  quantity?: number
  unit?: string
  unitPrice?: number
  gstRate?: number
  total?: number
  productId?: string
}

export interface EnrichedScannedItem extends RawScannedItem {
  productId: string | undefined
  quantity: number
  unit: string
  unitPrice: number
  gstRate: number
  total: number
}

/**
 * Normalizes AI-parsed bill items:
 * - Matches each to a catalog product by name (exact, then contains)
 * - Normalizes quantity into the product's unit (500 gm → 0.5 kg)
 * - Derives unit price from the printed line total when AI mis-read the
 *   per-unit rate (>20% mismatch)
 * - Fills gstRate/price from catalog when the bill omits them
 */
export function enrichScannedItems(
  rawItems: RawScannedItem[],
  catalogProducts: any[],
  billType: 'sale' | 'purchase',
): EnrichedScannedItem[] {
  return (rawItems || []).map((item: RawScannedItem) => {
    const nameLower = (item.name || item.productName || '').toLowerCase().trim()
    const matched = nameLower
      ? catalogProducts.find((p: any) => p.name?.toLowerCase() === nameLower) ||
        catalogProducts.find((p: any) =>
          p.name?.toLowerCase().includes(nameLower) || nameLower.includes(p.name?.toLowerCase()),
        )
      : null

    const resolved = resolveEnteredQuantity(
      Number(item.quantity) || 0,
      item.unit || matched?.unit || 'pcs',
      matched?.unit,
    )
    const qty = roundMoney(resolved.quantity)
    const gstRate = Number(item.gstRate) || matched?.gstRate || 0
    let unitPrice = Number(item.unitPrice) || 0
    const printedTotal = Number(item.total) || 0

    if (printedTotal > 0 && qty > 0) {
      const expected = qty * unitPrice * (1 + gstRate / 100)
      const mismatch = Math.abs(expected - printedTotal) > Math.max(1, printedTotal * 0.2)
      if (unitPrice <= 0 || mismatch) {
        // Trust the printed line total; derive the per-unit rate from it.
        unitPrice = roundMoney(printedTotal / (1 + gstRate / 100) / qty)
      }
    } else if (unitPrice <= 0 && matched) {
      unitPrice = billType === 'sale' ? (matched.salePrice || 0) : (matched.purchasePrice || 0)
    }

    return {
      ...item,
      productId: matched?.id || item.productId || undefined,
      quantity: qty,
      unit: resolved.unit,
      unitPrice,
      gstRate,
      total: roundMoney(qty * unitPrice * (1 + gstRate / 100)),
    }
  })
}
