/**
 * Phase 8f — a discount given AFTER the sale, as a credit note.
 *
 * THE LAW (in force 1 Nov 2026). Finance Act 2026 s.153 substitutes CGST
 * s.15(3)(b): a discount after the supply reduces the value — and the GST —
 * when it is given by a credit note under s.34 and the recipient reverses the
 * input credit on it. s.154 adds that discount to s.34(1). Brought into force
 * by Notification 03/2026-Central Tax, 26 Oct 2026 (law report, "Update,
 * 31 October 2026", text read). The old condition — a discount agreed before
 * the sale and linked to the invoices — is gone.
 *
 * s.34(2) still limits WHEN: the note must be declared by 30 November after
 * the end of the financial year of the sale, or the annual return if filed
 * earlier. That date rule already lives in amendmentDeadline (one rule).
 *
 * WHAT THIS BUILDS. The note's lines: the discount spread over the sale's own
 * lines in proportion to their value, grouped by HSN + rate + unit, so the GST
 * comes off at each line's own rate and GSTR-1 Table 12 gets the right HSN.
 * Lines carry GST-inclusive prices, so the note's total is exactly the amount
 * the shopkeeper typed — the paise left by rounding go to the largest group.
 * No product is linked: a discount moves no stock.
 */
import { toPaise, fromPaise } from '@/lib/money'
import { amendmentDeadline, type AmendmentDeadline } from '@/lib/gstr1-amendments'

export const POST_SALE_DISCOUNT_REASON = 'post-sale-discount'

/** A line of the original sale, as the bill holds it (total includes GST). */
export interface SaleLine {
  gstRate: number
  total: number
  hsn?: string | null
  unit?: string | null
}

/** A credit-note line, in the shape POST /api/transactions takes. */
export interface DiscountLine {
  productName: string
  quantity: 1
  unitPrice: number
  gstRate: number
  priceIncludesGst: true
  hsn: string | null
  unit: string
}

/**
 * Spread `amount` (₹, GST included) over the sale's lines.
 * Returns [] for a zero or negative amount, or a sale with no value.
 */
export function discountLines(invoiceNo: string | null, items: SaleLine[], amount: number): DiscountLine[] {
  const amountPaise = toPaise(amount)
  if (amountPaise <= 0) return []

  const groups = new Map<string, { gstRate: number; hsn: string | null; unit: string; paise: number }>()
  for (const it of items) {
    const paise = toPaise(it.total)
    if (paise <= 0) continue
    const hsn = it.hsn && String(it.hsn).trim() ? String(it.hsn).trim() : null
    const unit = it.unit || 'pcs'
    const key = `${hsn ?? ''}|${Number(it.gstRate) || 0}|${unit}`
    const g = groups.get(key) || { gstRate: Number(it.gstRate) || 0, hsn, unit, paise: 0 }
    g.paise += paise
    groups.set(key, g)
  }
  const list = [...groups.values()]
  const billPaise = list.reduce((s, g) => s + g.paise, 0)
  if (billPaise <= 0) return []

  // Each group's share, floored to the paisa; the remainder goes to the largest group.
  const shares = list.map((g) => Math.floor((amountPaise * g.paise) / billPaise))
  const largest = list.reduce((best, g, i) => (g.paise > list[best].paise ? i : best), 0)
  shares[largest] += amountPaise - shares.reduce((s, x) => s + x, 0)

  const label = `Discount on ${invoiceNo || 'bill'}`
  return list
    .map((g, i) => ({
      productName: label,
      quantity: 1 as const,
      unitPrice: fromPaise(shares[i]),
      gstRate: g.gstRate,
      priceIncludesGst: true as const,
      hsn: g.hsn,
      unit: g.unit,
    }))
    .filter((l) => l.unitPrice > 0)
}

/** The sale's financial-year period as MMYYYY, in India time. */
export function salePeriod(saleDate: Date | string): string {
  const d = new Date(new Date(saleDate).getTime() + 5.5 * 60 * 60 * 1000)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}`
}

/**
 * s.34(2): the last day a GST credit note on this sale can be declared.
 * `open` is false once that day has passed (it counts as open all of it).
 */
export function discountDeadline(saleDate: Date | string, asOn: Date = new Date()): AmendmentDeadline & { open: boolean } {
  const d = amendmentDeadline(salePeriod(saleDate), asOn)
  const endOfDay = new Date(d.effectiveDeadline)
  endOfDay.setHours(23, 59, 59, 999)
  return { ...d, open: asOn.getTime() <= endOfDay.getTime() }
}
