/**
 * Phase 7f — one way to turn a bill being entered (on screen, or held) into
 * the bill engine's input and its total.
 *
 * WHY (#187, 2 Oct 2026). The drafts list worked a draft's total as Σ quantity
 * × price, so a ₹230 + 5% GST purchase was listed as ₹230, and an MRP line or
 * a bill discount was never counted. The screen used the bill engine
 * (line-items.ts). Two rules for one figure; now the screen's preview and every
 * held bill's total come from here, so a held bill lists exactly what the
 * screen showed when it was held.
 */
import { computeLineItems, type RawLineItem } from './line-items'
import { resolveLineIncludesGst } from './refill-line'

export interface EntryLine {
  productId?: string | null
  productName: string
  quantity: number | string
  unitPrice: number | string
  gstRate?: number | string
  unit?: string
  priceIncludesGst?: boolean
}

/** A bill's lines as the engine reads them — the line's own "includes GST" first (#130, #135). */
export function entryLineInputs(
  items: EntryLine[],
  productMap: Map<string, any>,
  opts: { isPurchaseSide: boolean; purchaseRatesIncludeGst: boolean },
): Array<RawLineItem & { productId: string | null; quantity: number; unitPrice: number; gstRate: number; unit: string; priceIncludesGst: boolean }> {
  return items.map((item) => {
    const p = item.productId ? productMap.get(item.productId) : null
    return {
      productId: item.productId || null,
      productName: item.productName,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      gstRate: Number(item.gstRate) || 0,
      unit: item.unit || p?.unit || 'pcs',
      priceIncludesGst: resolveLineIncludesGst({
        lineFlag: item.priceIncludesGst,
        isPurchaseSide: opts.isPurchaseSide,
        purchaseRatesIncludeGst: opts.purchaseRatesIncludeGst,
        productFlag: p?.priceIncludesGst,
      }),
    }
  })
}

/** The shop's round-off, the same as the server applies it (FIX C5). */
export function billTotalAfterRoundOff(totalBeforeRoundOff: number, roundOffEnabled: boolean): number {
  return roundOffEnabled ? Math.round(totalBeforeRoundOff) : totalBeforeRoundOff
}

export const isPurchaseSideType = (t: string) => t === 'purchase' || t === 'debit-note'

/** What a held bill stands at: its total and each line's total, by the engine. */
export function heldBillFigures(
  data: { items?: EntryLine[]; isInterState?: boolean; discountAmount?: string | number; actualType?: string; purchaseRatesIncludeGst?: boolean } | null | undefined,
  ctx: { formType: string; productMap: Map<string, any>; chargesGst: boolean; roundOffEnabled: boolean },
): { total: number; lineTotals: number[] } {
  const items = data?.items || []
  if (items.length === 0) return { total: 0, lineTotals: [] }
  const type = data?.actualType || ctx.formType
  const r = computeLineItems({
    items: entryLineInputs(items, ctx.productMap, { isPurchaseSide: isPurchaseSideType(type), purchaseRatesIncludeGst: !!data?.purchaseRatesIncludeGst }),
    productMap: ctx.productMap,
    isInterState: !!data?.isInterState,
    orderDiscount: Number(data?.discountAmount) || 0,
    type,
    chargesGst: ctx.chargesGst,
  })
  return { total: billTotalAfterRoundOff(r.totalBeforeRoundOff, ctx.roundOffEnabled), lineTotals: r.txItems.map((l) => l.total) }
}

/**
 * A held bill's name on a chip: the customer (looked up when shown, so a
 * renamed customer reads right), else its first item (+ how many more).
 */
export function heldBillName(data: { items?: Array<{ productName?: string }> } | null | undefined, partyName?: string | null): string {
  const party = String(partyName || '').trim()
  if (party) return party
  const items = data?.items || []
  if (items.length === 0) return 'Empty bill'
  const first = String(items[0]?.productName || 'Item').trim()
  return items.length > 1 ? `${first} +${items.length - 1}` : first
}

/** When it was held: the time today ("10:42 am"), else the day ("21 Oct"). India time. */
export function heldBillWhen(savedAt: number, now: number = Date.now()): string {
  const day = (t: number) => new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
  if (day(savedAt) === day(now)) {
    return new Date(savedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
  }
  return new Date(savedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })
}
