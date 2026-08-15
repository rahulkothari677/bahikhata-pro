/**
 * Turn an InvoiceTheme into the numbers jsPDF needs.
 *
 * 📄 2026-08-15, Phase 1 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * WHAT WAS WRONG. `Setting.invoiceTheme` offers eight looks, and the setting
 * tells the shopkeeper in as many words that it is "used on the bill picture,
 * the bill link and the PDF". It was not used on the PDF. `pdf/theme.ts`
 * hardcoded `brand: {r:217,g:110,b:27}` — saffron — and `invoice-pdf.ts` never
 * received a theme id at all. A shop that picked Midnight got a dark blue
 * picture, a dark blue payment page, and an orange PDF.
 *
 * WHY A BRIDGE RATHER THAN A SECOND PALETTE. `invoice-themes.ts` is the single
 * registry every surface reads, and it stores CSS colours because two of the
 * three renderers are a canvas and a web page. jsPDF wants {r,g,b} integers and
 * understands no alpha. The choice was to give the PDF its own copy of the
 * eight palettes — which is the "two lists describing one thing" mistake that
 * has produced four bugs in this codebase — or to convert. This converts.
 *
 * THE ALPHA PROBLEM, stated because it is the only subtle part. `headerMuted`
 * is `rgba(255,255,255,0.78)`: white at 78% over whatever the header band is.
 * A PDF has no alpha channel for text, so the translucency has to be resolved
 * to a flat colour by compositing it over its own backdrop. Printing it at full
 * opacity instead would lose the muted/loud distinction the theme is built on,
 * and printing it as white on a light header would be invisible.
 */

import { getInvoiceTheme, type InvoiceTheme } from '../invoice-themes'

/** jsPDF's colour shape: 0-255 per channel, no alpha. */
export interface Rgb {
  r: number
  g: number
  b: number
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/**
 * Parse one CSS colour from `invoice-themes.ts`.
 *
 * Deliberately narrow: it accepts `#rgb`, `#rrggbb`, `rgb()` and `rgba()`,
 * which is every form the registry actually uses, and returns null for anything
 * else rather than guessing. A named colour or an `oklch()` would be a silent
 * black box otherwise — and black is a plausible-looking wrong answer, which is
 * the worst kind.
 */
export function parseCssColor(input: string): { rgb: Rgb; alpha: number } | null {
  const value = input.trim().toLowerCase()

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
    return {
      rgb: {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
      },
      alpha: 1,
    }
  }

  const fn = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (fn) {
    const a = fn[4] === undefined ? 1 : Number(fn[4])
    if (!Number.isFinite(a)) return null
    return {
      rgb: { r: clamp255(Number(fn[1])), g: clamp255(Number(fn[2])), b: clamp255(Number(fn[3])) },
      alpha: Math.max(0, Math.min(1, a)),
    }
  }

  return null
}

/** Composite `fg` (with alpha) over opaque `bg`. */
export function flatten(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return {
    r: clamp255(fg.r * alpha + bg.r * (1 - alpha)),
    g: clamp255(fg.g * alpha + bg.g * (1 - alpha)),
    b: clamp255(fg.b * alpha + bg.b * (1 - alpha)),
  }
}

/**
 * Resolve a theme colour to flat RGB, compositing over `backdrop` when it is
 * translucent. `fallback` is used only when the string cannot be parsed, so a
 * malformed entry degrades to a readable document instead of a black one.
 */
export function toRgb(color: string, backdrop: Rgb, fallback: Rgb): Rgb {
  const parsed = parseCssColor(color)
  if (!parsed) return fallback
  return parsed.alpha >= 1 ? parsed.rgb : flatten(parsed.rgb, parsed.alpha, backdrop)
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }

/**
 * The palette one invoice PDF is drawn with.
 *
 * Names describe ROLE, not colour — `band`, `onBand`, `accent` — so the same
 * field means the same thing in Midnight as in Saffron. The status colours are
 * the deliberate exception below.
 */
export interface PdfPalette {
  /** The header band, and the fill behind the grand total. */
  band: Rgb
  /** Text on the band. */
  onBand: Rgb
  /** Secondary text on the band — phone, GSTIN, address. */
  onBandMuted: Rgb
  /** The one highlight: rules, the amount due, the total box. */
  accent: Rgb
  /** A pale wash of the accent — table stripes, the due panel. */
  accentSoft: Rgb
  /** Body text on white. */
  text: Rgb
  /** Labels and secondary lines on white. */
  textMuted: Rgb
  /** Hairlines and table rules. */
  border: Rgb
  /** Alternating table rows. */
  zebra: Rgb
  /** Card fills — the Bill To block. */
  cardBg: Rgb
  white: Rgb

  /*
   * PAID / PARTIAL / DUE are NOT themed, on purpose.
   *
   * The same rule the WhatsApp image already follows (see invoice-share-image).
   * Green means settled and red means owed to everyone who has ever seen a
   * bill; a theme that recoloured them would make a paid invoice and an unpaid
   * one differ only by a word, on the one document where that distinction
   * carries money. A shop's brand is worth less than that.
   */
  paid: Rgb
  partial: Rgb
  due: Rgb

  /** The theme this came from, for the renderer's own decisions. */
  theme: InvoiceTheme
}

/** Build the PDF palette for a stored `Setting.invoiceTheme` value. */
export function paletteFor(themeId: string | null | undefined): PdfPalette {
  const theme = getInvoiceTheme(themeId)

  const band = toRgb(theme.headerBg, WHITE, { r: 15, g: 23, b: 42 })
  const onBand = toRgb(theme.headerText, band, WHITE)

  return {
    band,
    onBand,
    // Composited over the band, because it is the backdrop it will sit on.
    onBandMuted: toRgb(theme.headerMuted, band, onBand),
    accent: toRgb(theme.accent, WHITE, { r: 194, g: 65, b: 12 }),
    accentSoft: toRgb(theme.accentSoft, WHITE, { r: 254, g: 242, b: 242 }),
    text: toRgb(theme.text, WHITE, { r: 17, g: 24, b: 39 }),
    textMuted: toRgb(theme.muted, WHITE, { r: 107, g: 114, b: 128 }),
    border: toRgb(theme.line, WHITE, { r: 229, g: 231, b: 235 }),
    // Not in the theme: a stripe must stay near-white or the table stops being
    // readable in print, and every theme would need a hand-tuned value.
    zebra: { r: 251, g: 252, b: 253 },
    cardBg: { r: 248, g: 250, b: 252 },
    white: WHITE,
    paid: { r: 5, g: 150, b: 105 },
    partial: { r: 217, g: 119, b: 6 },
    due: { r: 220, g: 38, b: 38 },
    theme,
  }
}
