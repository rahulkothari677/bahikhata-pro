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

/* ══════════════════════════════════════════════════════════════════════════
 * CURRENT vs HISTORICAL — one list was doing two jobs (#86)
 *
 * `GST_RATE_SLABS` above answers "what rate might I meet in this shop's data?".
 * A picker needs a different question: "what rate may I charge on a sale I am
 * writing today?". They are not the same list, and using one for both is why
 * 12% still appears on a new bill.
 *
 * 12% WAS REMOVED FOR GOODS by Notification 09/2025-CT(R), effective
 * 22 Sep 2025. Verified against the notification this repo actually holds
 * rather than from commentary: of 1,351 parsed rate rows, ZERO are 12%. The
 * live rates in that document are 0.25, 1.5, 3, 5, 18, 28 and 40.
 *
 * BUT 12% MUST STAY AVAILABLE, and that is the half a naive fix gets wrong. A
 * shopkeeper entering last year's purchase bill, or raising a credit note
 * against an invoice from before 22 September, needs it. Deleting it from the
 * list would make correct historical data unenterable — and worse, would
 * silently reset an existing 12% product the moment someone opened it to edit
 * the name.
 *
 * So: NEW bills offer the current slabs; existing data keeps whatever it has;
 * validation and reporting keep the full historical set.
 * ═══════════════════════════════════════════════════════════════════════ */

/** What a NEW sale may be charged at. 12% is gone from here, and only here. */
export const CURRENT_GST_RATE_SLABS = [0, 3, 5, 18, 28, 40] as const

/**
 * Rates no longer live, kept so old bills remain enterable and editable.
 *
 * Not "deprecated" in the sense of unusable — an invoice dated before
 * 22 Sep 2025 is correctly 12%, and so is a credit note against it.
 */
export const LEGACY_GST_RATES = [12] as const

export function isLegacyGstRate(rate: number): boolean {
  return LEGACY_GST_RATES.includes(rate as (typeof LEGACY_GST_RATES)[number])
}

/**
 * The options a picker should show, given what the row already holds.
 *
 * THE SAFETY THAT MAKES THIS CHANGE SAFE. A shadcn Select whose value has no
 * matching option renders blank, and the next save writes whatever the user
 * then picks — so simply dropping 12% would quietly rewrite the rate on every
 * pre-September product the moment somebody opened it to fix a typo.
 *
 * Passing the row's own rate keeps it on the list for that row only. A new
 * bill, which passes nothing, never sees 12% at all.
 */
export function ratesForPicker(currentValue?: number | null): number[] {
  const base = [...CURRENT_GST_RATE_SLABS]
  const v = Number(currentValue)
  if (Number.isFinite(v) && v > 0 && !base.includes(v as (typeof CURRENT_GST_RATE_SLABS)[number])) {
    return [...base, v].sort((a, b) => a - b)
  }
  return base
}

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
