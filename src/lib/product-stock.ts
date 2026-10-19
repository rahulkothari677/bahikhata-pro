/**
 * The stock fields every product list shows — ONE derivation, shared by
 * /api/products (pickers, exports) and /api/products/list (the Items screen,
 * Phase 5e-2). It was written inline in /api/products; a second list writing
 * its own would drift.
 *
 * A service has no stock, so every stock-derived flag is off and its value 0
 * (a salon's "Haircut" must never read low stock forever). For staff who may
 * not see profit, the cost price and the stock value at cost are removed:
 * with the sale price they need for billing, cost would reveal the margin.
 */
import { tracksStock, type StockTrackable } from './inventory-tracking'
import { roundMoney } from './money'

export interface StockSource extends StockTrackable {
  currentStock: number
  purchasePrice: number
  lowStockThreshold: number
}

export function withStockView<P extends StockSource>(p: P, hideProfit: boolean) {
  const counts = tracksStock(p)
  const view: Omit<P, 'purchasePrice'> & { purchasePrice?: number; stockValue?: number; isLowStock: boolean; isOversold: boolean } = {
    ...p,
    stockValue: counts ? roundMoney(Math.max(0, p.currentStock) * p.purchasePrice) : 0,
    isLowStock: counts && p.currentStock <= p.lowStockThreshold,
    isOversold: counts && p.currentStock < 0,
  }
  if (hideProfit) {
    view.purchasePrice = undefined
    view.stockValue = undefined
  }
  return view
}
