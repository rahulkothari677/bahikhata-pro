/**
 * Type sizing that adapts to the text, so names are not truncated.
 *
 * 🐛 2026-07-29. The card rendered the shop name at a fixed 7cqw. "RAHUL
 * KOTHARI" is 13 characters and overflowed its 42%-wide zone, so the card read
 * "RAHUL KO…". A fixed size cannot work: a shop is called "RK" or "Shree
 * Siddhivinayak General Stores & Provisions", and both must fit the same slot.
 *
 * WHY THE DEFAULT IS AN ESTIMATE RATHER THAN A MEASUREMENT: the card also
 * renders server-side and into a PDF. A measurement pass would exist in only
 * some of those, so the shared card could differ from the previewed one.
 * Estimating from character count is approximate but IDENTICAL everywhere,
 * which matters more than being exact.
 *
 * 🎨 2026-08-04. That reasoning holds only while every card uses the same face.
 * Once a shopkeeper can set the shop name in Tangerine or Archivo Black, one
 * average glyph width is wrong by a factor of two, and the name either
 * overflows its zone or shrinks to nothing. `measuredGlyphRatio` supplies the
 * real number for a chosen face, and callers pass it as `glyphRatio` — the
 * arithmetic below is unchanged. Text left on the DEFAULT face keeps using the
 * estimate, deliberately: that sizing is what Rahul approved, and measuring it
 * would quietly resize every existing card.
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
// One canvas, reused. Measuring happens on every render of every card and
// thumbnail in the picker.
let measureCtx: CanvasRenderingContext2D | null | undefined
const ratioCache = new Map<string, number>()

/**
 * The real average glyph width for `text` in `cssFont`, as a fraction of font
 * size — a drop-in `glyphRatio` for the functions above.
 *
 * Returns null when there is nothing to measure with (server render, or a face
 * still downloading), so the caller falls back to the estimate rather than
 * laying out against a measurement of Times New Roman.
 *
 * `letterSpacing` matters: a face set with wide tracking needs more room per
 * character than its glyphs alone suggest, and that is exactly the error that
 * pushes a name into an ellipsis.
 */
export function measuredGlyphRatio(
  text: string | null | undefined,
  cssFont: string,
  letterSpacing?: string,
): number | null {
  const t = (text ?? '').trim()
  if (t.length === 0) return null
  if (typeof document === 'undefined') return null

  const key = `${cssFont}|${letterSpacing ?? ''}|${t}`
  const hit = ratioCache.get(key)
  if (hit !== undefined) return hit

  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return null

  // A large reference size keeps the ratio clear of hinting and rounding; the
  // result is scale-free.
  const REF = 200
  measureCtx.textAlign = 'left'
  measureCtx.font = cssFont.replace(/\b\d+(\.\d+)?px\b/, `${REF}px`)
  try {
    measureCtx.letterSpacing = letterSpacing || 'normal'
  } catch {
    // Older engines ignore tracking; the estimate is then a few percent low.
  }

  const m = measureCtx.measureText(t)

  // The WIDER of the advance and the ink.
  //
  // Advance alone is what a layout engine reserves, and for most faces the ink
  // sits inside it. A script does the opposite: Great Vibes' capitals throw
  // swashes well past their own advance, so sizing by advance let the shop name
  // fit "perfectly" on paper and visibly cross the fold into the dark panel of
  // the artwork. Ink alone would be wrong the other way — it ignores the
  // trailing space a face reserves — so the fit takes whichever is larger.
  const ink = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  const width = Math.max(m.width, isFinite(ink) ? ink : 0)
  if (!isFinite(width) || width <= 0) return null

  const ratio = width / (t.length * REF)
  ratioCache.set(key, ratio)
  return ratio
}

/** Clears the measured ratios. Call after a webfont finishes loading. */
export function resetGlyphRatios() {
  ratioCache.clear()
}

export function willTruncate(text: string | null | undefined, opts: FitOptions): boolean {
  const chars = (text ?? '').trim().length
  if (chars === 0) return false
  const ratio = opts.glyphRatio ?? AVG_GLYPH_RATIO
  return (opts.zoneWidthPercent * SAFETY) / (chars * ratio) < opts.minCqw
}
