/**
 * A return picks from the bill it reverses (#190, Phase 7g-4, 25 Oct 2026).
 *
 * A credit note against INV-0038 used to open on the whole shop's item picker,
 * with "Load all items from original sale" as a button under it. Most returns are
 * partial (one or two items of a bill), so the note still starts empty — but the
 * ORIGINAL bill's lines come first, each with − / + up to what was sold, and
 * "Return all" is one tap.
 *
 * Every returned line is rebuilt from the saved line through refillPrice (the
 * price as typed and whether it included GST — #130), so a full return reverses
 * exactly what was billed. The amount cap is the server's (lib/note-validation.ts,
 * rule 4); the per-line limit here only stops a slip of the thumb.
 */
import { refillPrice } from './refill-line'

export interface OriginalLine {
  key: string
  productId: string
  productName: string
  /** What was sold, as it was typed (500 ml, not 0.5 l). */
  quantity: number
  unit: string
  unitPrice: number
  priceIncludesGst: boolean
  gstRate: number
}

/** A bill line, as the bill screen holds it (only the fields this reads or writes). */
export interface ReturnRow {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  gstRate: number
  unit: string
  priceIncludesGst?: boolean
  discountAmount?: number
}

export function originalLinesOf(originalItems: any[]): OriginalLine[] {
  return originalItems.map((item: any) => ({
    key: `${item.productId || 'name:' + (item.productName || '')}|${item.enteredUnit ?? item.unit ?? 'pcs'}`,
    productId: item.productId || '',
    productName: item.productName || '',
    quantity: Number(item.enteredQuantity ?? item.quantity ?? 0) || 0,
    unit: item.enteredUnit ?? item.unit ?? 'pcs',
    ...refillPrice(item),
    gstRate: Number(item.gstRate) || 0,
  }))
}

const sameLine = (row: ReturnRow, line: OriginalLine) =>
  (line.productId ? row.productId === line.productId : !row.productId && row.productName === line.productName) &&
  (row.unit || 'pcs') === line.unit

/** How much of this original line the return holds now. */
export function returnedQty(rows: ReturnRow[], line: OriginalLine): number {
  return rows.find((r) => sameLine(r, line))?.quantity ?? 0
}

/** The step for − / +: one at a time; a loose line (0.5 kg) comes back whole or not at all. */
export function returnStep(line: OriginalLine): number {
  return Number.isInteger(line.quantity) ? 1 : line.quantity
}

/** The return with this line set to `qty` (0 … what was sold); 0 takes the line off. */
export function setReturnedQty<T extends ReturnRow>(rows: T[], line: OriginalLine, qty: number): T[] {
  const q = Math.max(0, Math.min(line.quantity, Math.round(qty * 1000) / 1000))
  const at = rows.findIndex((r) => sameLine(r, line))
  if (q === 0) return at === -1 ? rows : rows.filter((_, i) => i !== at)
  if (at !== -1) return rows.map((r, i) => (i === at ? { ...r, quantity: q } : r))
  const row: ReturnRow = {
    productId: line.productId,
    productName: line.productName,
    quantity: q,
    unitPrice: line.unitPrice,
    priceIncludesGst: line.priceIncludesGst,
    gstRate: line.gstRate,
    unit: line.unit,
    discountAmount: 0,
  }
  return [...rows, row as T]
}

/** Every line of the original bill, in full (a full return). Lines not on the bill stay. */
export function returnAll<T extends ReturnRow>(rows: T[], lines: OriginalLine[]): T[] {
  return lines.reduce((acc, line) => setReturnedQty(acc, line, line.quantity), rows)
}
