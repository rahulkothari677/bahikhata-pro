/**
 * The taxable value of a stored bill line — ONE definition for every report.
 *
 * WHY THIS FILE EXISTS (#98, 1 Oct 2026). Some twenty report queries worked out
 * a line's taxable value as `quantity × unitPrice − discountAmount`. That was
 * true only while every line was computed that way. For a GST-inclusive (MRP)
 * line the stored `unitPrice` is rounded to the paisa, so `quantity ×
 * unitPrice` drifts by up to half a paisa per unit — 20 packs could be 10 paise
 * off — and the drift would land in GSTR-1, GSTR-3B, P&L and the dashboard.
 *
 * Every line already stores its exact `total` and its taxes, and
 * `total = taxable + cgst + sgst + igst + csamt` is how lib/line-items.ts
 * writes it. So the taxable value is read back as `total − taxes`: exact for
 * every line ever written by computeLineItems, inclusive or not.
 *
 * SQL: use LINE_TAXABLE_SQL / LINE_GROSS_SQL from lib/line-taxable-sql.ts
 * (server only). JS: use lineTaxable() below (safe in the browser).
 * A guard test fails if `quantity × unitPrice` appears in a report again.
 */
import { roundMoney } from '@/lib/money'

/** Post-discount taxable value for a line already read into JS, in rupees. */
export function lineTaxable(line: {
  total: number
  cgst?: number | null
  sgst?: number | null
  igst?: number | null
  csamt?: number | null
}): number {
  return roundMoney(line.total - (line.cgst || 0) - (line.sgst || 0) - (line.igst || 0) - (line.csamt || 0))
}
