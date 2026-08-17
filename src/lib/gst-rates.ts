/**
 * The GST rate slabs a shopkeeper can choose from — ONE list, for the whole app.
 *
 * WHY THIS FILE EXISTS (audit 2026-08-17).
 *
 * The list `[0, 5, 12, 18, 28]` was written out in SEVEN separate places: the
 * product form, the invoice line editor, the bill detail screen, two charts in
 * Reports, the AI scan review, and the CSV export. There was no shared
 * constant.
 *
 * So when the statute moved, seven places each needed editing and none were.
 * The result was a live under-charge, not a cosmetic gap:
 *
 *   • Aerated and sweetened beverages (HSN 2202) went to 40% on 22 Sep 2025.
 *   • Pan masala, gutkha, chewing tobacco, cigarettes and nicotine inhalation
 *     products went to 40% on 1 Feb 2026.
 *   • Bidi went DOWN to 18% on 1 Feb 2026.
 *   • Compensation cess was set to Nil against those entries — it is gone.
 *
 * Source: Notification 09/2025-Central Tax (Rate) dated 17 Sep 2025 as amended
 * (the 09/2025–16/2025 series), following the 56th GST Council meeting. The
 * tobacco date was deferred because compensation-cess loan obligations had to
 * be discharged first; beverages moved immediately.
 *
 * A kirana selling cold drinks therefore had no way to pick the correct rate
 * for roughly ELEVEN months. The nearest option was 28%, which under-charges by
 * 12 points and under-reports the same on GSTR-1 and GSTR-3B — and the shortfall
 * is the shop's own liability, not the customer's.
 *
 * The tax engine was never wrong. `POST /api/products` accepted `gstRate: 40`
 * and a ₹100 sale produced CGST ₹20 + SGST ₹20 = ₹140, verified live before this
 * change. Only the pickers could not offer it.
 *
 * ── THE RULE THIS FILE ENCODES ──────────────────────────────────────────────
 * Statutory rates are REFERENCE DATA THAT CHANGES. They belong in one place, so
 * the next Council meeting is one edit rather than seven. A guard test
 * (gst-rates-single-source.test.ts) fails the build if a component starts
 * hard-coding its own array again.
 */

/**
 * The slabs offered in every rate picker.
 *
 * 3% is included because gold, silver and jewellery sit there, and a jeweller
 * could not previously select it either — the same defect as 40%, found while
 * sweeping the class. It has been 3% since 2017 and is not part of the 2025-26
 * restructure.
 *
 * Deliberately NOT listed: 0.25% (rough diamonds) and 1.5% (diamond job work).
 * They are real slabs but belong to a trade this app does not serve, and every
 * extra row is one more wrong tap available during a rush. The API accepts any
 * rate from 0 to 100, so a shop that genuinely needs one is not blocked — see
 * `gstRate` in validation.ts.
 */
export const GST_RATE_SLABS = [0, 3, 5, 12, 18, 28, 40] as const

/** Mutable copy for callers that map over it (charts, exports, pickers). */
export const GST_RATES: number[] = [...GST_RATE_SLABS]

/**
 * Is this a slab a picker should offer?
 *
 * Not a validation rule — the API deliberately accepts 0–100, because a rate
 * this list has not caught up with must never block a shopkeeper from billing
 * correctly. That is the failure mode this whole file exists to prevent.
 */
export function isStandardGstRate(rate: number): boolean {
  return GST_RATE_SLABS.includes(rate as (typeof GST_RATE_SLABS)[number])
}
