/**
 * Monogram typefaces — 10 options for the auto-generated logo letters.
 *
 * 🎨 2026-07-29. The monogram shipped with one serif and Rahul called it basic,
 * correctly: the letters ARE the logo for any shop that never uploads a file,
 * so a single face means every card in the app shares a logo.
 *
 * NO WEBFONTS. The card renders inside a PDF export and a canvas-to-PNG share,
 * and a webfont that has not finished loading silently falls back — producing a
 * logo that differs between the screen and the downloaded file. Every option
 * below resolves from system stacks that exist on Android, iOS, Windows and
 * macOS, so what is on screen is what gets shared.
 *
 * Distinctiveness therefore comes from FAMILY + WEIGHT + TRACKING + CASE
 * together, not family alone. Two options sharing a family still read as
 * different marks when one is 900-weight tight and the other 300-weight wide.
 */

export interface MonogramFont {
  /** Stable id, stored per template or per user. Never change. */
  id: string
  /** Shown in the picker. */
  name: string
  /** One line on who it suits. */
  description: string
  fontFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  /** em. Wide tracking suits light weights; tight suits heavy ones. */
  letterSpacing: string
  /**
   * Multiplies the template's logo size. A script face has a much smaller
   * x-height than Arial Black at the same px, so without this the "same" size
   * looks wildly inconsistent across options.
   */
  sizeScale: number
  /** Outline-only, for marks that should read as engraved rather than solid. */
  outlined?: boolean
}

export const MONOGRAM_FONTS: MonogramFont[] = [
  {
    id: 'serif-classic',
    name: 'Classic Serif',
    description: 'Traditional and trustworthy. Suits most trades.',
    fontFamily: 'Georgia, "Times New Roman", ui-serif, serif',
    fontWeight: 700,
    fontStyle: 'normal',
    letterSpacing: '0.01em',
    sizeScale: 1,
  },
  // 🔜 MORE COMING. Nine system faces were built and shown to Rahul; he kept
  // only this one and is choosing the rest from Google Fonts, which can do
  // things no system face can — a true inscriptional Roman, or a monogram
  // ligature where the K tucks under the R's arm, as in his reference card.
  //
  // To add one: download the file to public/fonts/, declare an @font-face in
  // globals.css, and append an entry here. Self-hosted rather than loaded from
  // Google's CDN because this card also renders into the PDF invoice and the
  // PNG share — a CDN font that has not finished loading falls back silently,
  // so the shared logo would differ from the previewed one.
]

export const DEFAULT_MONOGRAM_FONT_ID = 'serif-classic'

export function getMonogramFont(id: string | null | undefined): MonogramFont {
  if (id) {
    const f = MONOGRAM_FONTS.find(x => x.id === id)
    if (f) return f
  }
  return (
    MONOGRAM_FONTS.find(f => f.id === DEFAULT_MONOGRAM_FONT_ID) ?? MONOGRAM_FONTS[0]
  )
}

/**
 * CSS for the monogram letters.
 *
 * `sizePx` is the resolved font size; the caller owns the sizing arithmetic so
 * this stays a pure style mapper.
 */
export function monogramStyle(font: MonogramFont, color: string, sizeCqw: number): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: font.fontFamily,
    fontWeight: font.fontWeight,
    fontStyle: font.fontStyle,
    letterSpacing: font.letterSpacing,
    fontSize: `${sizeCqw * font.sizeScale}cqw`,
    lineHeight: 1,
  }

  if (font.outlined) {
    // Hollow letters. `color` becomes the stroke; the fill is removed. The
    // stroke width scales with the text so it stays proportional at any card
    // size — a fixed px stroke looks hairline on a big card and heavy on a
    // thumbnail.
    return {
      ...base,
      color: 'transparent',
      WebkitTextStrokeWidth: '0.12em',
      WebkitTextStrokeColor: color,
    } as React.CSSProperties
  }

  return { ...base, color }
}
