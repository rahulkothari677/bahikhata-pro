/**
 * Monogram typefaces — the letterforms of the auto-generated logo.
 *
 * 🎨 2026-07-29. The monogram shipped with one serif and Rahul called it basic,
 * correctly: the letters ARE the logo for any shop that never uploads a file,
 * so a single face means every card in the app shares a logo.
 *
 * 🎨 2026-08-04. Nine system-font variations were built and shown to him; he
 * kept only Classic Serif and picked eleven Google faces instead. He was right
 * — system stacks can vary weight and tracking, but they cannot give you a
 * copperplate script or a chrome-tube display face, and those are what read as
 * a designed logo rather than a default.
 *
 * SELF-HOSTED, NOT CDN. The card renders into a PNG for sharing and into the
 * invoice PDF. A CDN font that has not finished loading falls back silently, so
 * the shared logo would differ from the previewed one. The files live in
 * public/fonts/card/ (fetched by scripts/fetch-card-fonts.mjs) and are declared
 * as @font-face in globals.css. Every family is SIL Open Font License or
 * Apache 2.0, both of which permit self-hosting.
 *
 * LOADED ON DEMAND. `font-display: swap` plus no preload means a shopkeeper who
 * never opens the card screen downloads none of these — 271 KB that would
 * otherwise sit on the critical path of a Dashboard on a 3G connection.
 */

export interface MonogramFont {
  /** Stable id, stored in Setting.cardFontId. Never change. */
  id: string
  /** Shown in the picker. */
  name: string
  /** One line on who it suits — the picker is for shopkeepers, not designers. */
  description: string
  fontFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  /** em. Wide tracking suits light weights; tight suits heavy ones. */
  letterSpacing: string
  /**
   * FALLBACK SIZE ONLY — a rough hand estimate, used for the first paint before
   * the face has downloaded and on the server, where nothing can be measured.
   *
   * The real size is derived by measuring the letterforms; see lib/monogram-fit.
   * These numbers were the whole sizing mechanism until 2026-08-04, when three
   * of the scripts turned out to overflow the logo zone and collide with the
   * shop name. Estimating type metrics by reasoning about them does not work.
   */
  sizeScale: number
  /** Outline-only, for marks that should read as engraved rather than solid. */
  outlined?: boolean
  /**
   * Filename stem in public/fonts/card/, or null for a system stack.
   *
   * The canvas PNG renderer uses this to wait on the exact face before it
   * draws — `document.fonts.load()` needs a real family name, and a face that
   * is still loading paints as Times New Roman with no error.
   */
  file?: string
}

export const MONOGRAM_FONTS: MonogramFont[] = [
  {
    id: 'serif-classic',
    name: 'Classic Serif',
    description: 'Traditional and trustworthy. Suits most trades.',
    fontFamily: "Georgia, 'Times New Roman', ui-serif, serif",
    fontWeight: 700,
    fontStyle: 'normal',
    letterSpacing: '0.01em',
    sizeScale: 1,
  },
  {
    id: 'libertinus-serif',
    name: 'Libertinus Serif',
    description: 'A book serif. Quiet, bookish, very readable.',
    fontFamily: "'Libertinus Serif', Georgia, serif",
    fontWeight: 700,
    fontStyle: 'normal',
    letterSpacing: '0.02em',
    sizeScale: 1.02,
    file: 'libertinus-serif',
  },
  {
    id: 'archivo-black',
    name: 'Archivo Black',
    description: 'Heavy block capitals. Bold and modern.',
    fontFamily: "'Archivo Black', 'Arial Black', sans-serif",
    fontWeight: 400,
    fontStyle: 'normal',
    // Heavy faces need air between the letters or the two initials merge into
    // one shape at card size.
    letterSpacing: '0.04em',
    sizeScale: 0.86,
    file: 'archivo-black',
  },
  {
    id: 'orbitron',
    name: 'Orbitron',
    description: 'Geometric and technical. Suits electronics and mobile shops.',
    fontFamily: "'Orbitron', 'Trebuchet MS', sans-serif",
    fontWeight: 700,
    fontStyle: 'normal',
    letterSpacing: '0.03em',
    sizeScale: 0.9,
    file: 'orbitron',
  },
  {
    id: 'tourney',
    name: 'Tourney',
    description: 'Sharp and sporty, with a chrome edge.',
    fontFamily: "'Tourney', 'Trebuchet MS', sans-serif",
    fontWeight: 700,
    fontStyle: 'normal',
    letterSpacing: '0.02em',
    sizeScale: 0.95,
    file: 'tourney',
  },
  {
    id: 'monoton',
    name: 'Monoton',
    description: 'Neon-sign lines. Eye-catching for cafés and salons.',
    fontFamily: "'Monoton', 'Trebuchet MS', sans-serif",
    fontWeight: 400,
    fontStyle: 'normal',
    letterSpacing: '0.03em',
    sizeScale: 0.94,
    file: 'monoton',
  },
  {
    id: 'great-vibes',
    name: 'Great Vibes',
    description: 'Flowing signature script. Elegant and personal.',
    fontFamily: "'Great Vibes', cursive",
    fontWeight: 400,
    fontStyle: 'normal',
    // Scripts are drawn to touch. Extra tracking breaks the join between the
    // two letters and the mark stops reading as handwriting.
    letterSpacing: '0em',
    // Scripts have a small x-height and long ascenders, so they need to be set
    // LARGER than a serif to look the same size on the card.
    sizeScale: 1.32,
    file: 'great-vibes',
  },
  {
    id: 'tangerine',
    name: 'Tangerine',
    description: 'Fine calligraphy. Delicate and premium.',
    fontFamily: "'Tangerine', cursive",
    fontWeight: 700,
    fontStyle: 'normal',
    letterSpacing: '0em',
    // The most extreme case: Tangerine's x-height is roughly a third of its em.
    sizeScale: 1.6,
    file: 'tangerine',
  },
  {
    id: 'lavishly-yours',
    name: 'Lavishly Yours',
    description: 'Loose modern script. Warm and hand-written.',
    fontFamily: "'Lavishly Yours', cursive",
    fontWeight: 400,
    fontStyle: 'normal',
    letterSpacing: '0em',
    sizeScale: 1.34,
    file: 'lavishly-yours',
  },
  {
    id: 'engagement',
    name: 'Engagement',
    description: 'Ornate copperplate. Formal, for jewellers and boutiques.',
    fontFamily: "'Engagement', cursive",
    fontWeight: 400,
    fontStyle: 'normal',
    letterSpacing: '0em',
    sizeScale: 1.3,
    file: 'engagement',
  },
  {
    id: 'chewy',
    name: 'Chewy',
    description: 'Round and friendly. Good for sweet shops and bakeries.',
    fontFamily: "'Chewy', 'Comic Sans MS', cursive",
    fontWeight: 400,
    fontStyle: 'normal',
    letterSpacing: '0.02em',
    sizeScale: 1.06,
    file: 'chewy',
  },
  {
    id: 'henny-penny',
    name: 'Henny Penny',
    description: 'Playful and quirky. For toy, gift and party shops.',
    fontFamily: "'Henny Penny', cursive",
    fontWeight: 400,
    fontStyle: 'normal',
    letterSpacing: '0.02em',
    sizeScale: 1.02,
    file: 'henny-penny',
  },
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
 * The family name alone, unquoted — what `document.fonts.load()` and the canvas
 * `font` shorthand need. Returns null for system stacks, which are always ready.
 */
export function monogramFontFamilyName(font: MonogramFont): string | null {
  if (!font.file) return null
  return font.fontFamily.split(',')[0].replace(/['"]/g, '').trim()
}

/**
 * CSS for the monogram letters.
 *
 * `sizeCqw` is the FINAL size in card-width percent — no scaling is applied
 * here. The caller owns the sizing arithmetic (see lib/monogram-fit) so this
 * stays a pure style mapper and the DOM and canvas paths cannot diverge.
 */
export function monogramStyle(font: MonogramFont, color: string, sizeCqw: number): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: font.fontFamily,
    fontWeight: font.fontWeight,
    fontStyle: font.fontStyle,
    letterSpacing: font.letterSpacing,
    fontSize: `${sizeCqw}cqw`,
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
