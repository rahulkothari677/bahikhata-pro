/**
 * Type sizing that adapts to the text, so names are not truncated.
 *
 * 🐛 2026-07-29. The card rendered the shop name at a fixed 7cqw. "RAHUL
 * KOTHARI" is 13 characters and overflowed its 42%-wide zone, so the card read
 * "RAHUL KO…". A fixed size cannot work: a shop is called "RK" or "Shree
 * Siddhivinayak General Stores & Provisions", and both must fit the same slot.
 *
 * WHY NOT MEASURE THE DOM: the card also renders server-side, into a PDF, and
 * onto a canvas for the PNG share. A measurement pass would exist in only one
 * of those, so the shared card would differ from the previewed one. Estimating
 * from character count is approximate but IDENTICAL everywhere, which matters
 * more than being exact.
 */

/**
 * Average glyph advance as a fraction of font size.
 *
 * MEASURED, not assumed. An earlier version guessed 0.56 and the shop name
 * still truncated; measuring "RAHUL KOTHARI" in the rendered card gave 0.61 for
 * bold uppercase sans (287px needed against 264px available). Callers rendering
 * bold caps should pass a higher ratio still — see SHOP_NAME_GLYPH_RATIO.
 */
const AVG_GLYPH_RATIO = 0.62

/**
 * For bold, frequently-uppercase display text like the shop name. Above the
 * measured 0.61 on purpose: the measurement was one string in one face, and a
 * name in Devanagari or a wide face would exceed it.
 */
export const SHOP_NAME_GLYPH_RATIO = 0.68

/**
 * Fraction of the zone the text may occupy.
 *
 * Without this the arithmetic produces a size that fits EXACTLY, so the text
 * sits flush against both edges and reads as cramped — and any error in the
 * ratio tips it straight into an ellipsis.
 */
const SAFETY = 0.94

export interface FitOptions {
  /** Zone width as a percentage of the card. */
  zoneWidthPercent: number
  /** Largest size to use when the text is short, in cqw. */
  maxCqw: number
  /** Never go below this, in cqw — past it, truncation beats illegibility. */
  minCqw: number
  /** Overrides the glyph ratio for unusually wide or narrow faces. */
  glyphRatio?: number
}

/**
 * Font size in cqw (percent of card width) that fits `text` in the zone.
 *
 * Returns `maxCqw` for short text and shrinks from there. Both units are
 * percentages of the same card width, so the arithmetic is unit-free and the
 * result holds at any rendered size — thumbnail, phone or print.
 */
export function fitTextCqw(text: string | null | undefined, opts: FitOptions): number {
  const chars = (text ?? '').trim().length
  if (chars === 0) return opts.maxCqw

  const ratio = opts.glyphRatio ?? AVG_GLYPH_RATIO
  const ideal = (opts.zoneWidthPercent * SAFETY) / (chars * ratio)

  return Math.max(opts.minCqw, Math.min(opts.maxCqw, ideal))
}

/**
 * True when even `minCqw` will not fit, so the caller can expect an ellipsis.
 *
 * Exposed so a preview or a test can assert "this name WILL be truncated"
 * rather than discovering it visually, which is how the last one shipped.
 */
export function willTruncate(text: string | null | undefined, opts: FitOptions): boolean {
  const chars = (text ?? '').trim().length
  if (chars === 0) return false
  const ratio = opts.glyphRatio ?? AVG_GLYPH_RATIO
  return (opts.zoneWidthPercent * SAFETY) / (chars * ratio) < opts.minCqw
}
