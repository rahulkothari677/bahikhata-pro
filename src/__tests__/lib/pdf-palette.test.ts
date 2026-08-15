/**
 * The PDF palette: does the shopkeeper's chosen theme reach the paper?
 *
 * 📄 2026-08-15, Phase 1 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * The bug this exists for: `Setting.invoiceTheme` offers eight looks and says
 * they are used on "the bill picture, the bill link and the PDF". The PDF
 * hardcoded saffron. Picking Midnight gave a dark blue picture, a dark blue
 * payment page and an orange PDF.
 *
 * These are plain functions taking arguments and returning values, which is the
 * point — the guard rule earned on 15 Aug is that a rule buried in a file sweep
 * cannot be exercised without committing a real bug. Every assertion here calls
 * the thing directly with a known-good and a known-bad input.
 */

import {
  parseCssColor, flatten, toRgb, paletteFor, type Rgb,
} from '@/lib/pdf/palette'
import { INVOICE_THEMES, getInvoiceTheme } from '@/lib/invoice-themes'

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

describe('parseCssColor', () => {
  it('reads the forms the theme registry actually uses', () => {
    expect(parseCssColor('#FFFFFF')).toEqual({ rgb: WHITE, alpha: 1 })
    expect(parseCssColor('#0F172A')).toEqual({ rgb: { r: 15, g: 23, b: 42 }, alpha: 1 })
    expect(parseCssColor('#fff')).toEqual({ rgb: WHITE, alpha: 1 })
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ rgb: { r: 1, g: 2, b: 3 }, alpha: 1 })
    expect(parseCssColor('rgba(255,255,255,0.78)')).toEqual({ rgb: WHITE, alpha: 0.78 })
  })

  it('returns null rather than guessing', () => {
    // Black is a plausible-looking wrong answer, so anything unparseable must
    // reach the caller's fallback instead of silently becoming a colour.
    expect(parseCssColor('rebeccapurple')).toBeNull()
    expect(parseCssColor('oklch(0.5 0.1 200)')).toBeNull()
    expect(parseCssColor('')).toBeNull()
    expect(parseCssColor('#12345')).toBeNull()
  })
})

describe('flatten', () => {
  it('composites translucent colour over its backdrop', () => {
    expect(flatten(WHITE, 1, BLACK)).toEqual(WHITE)
    expect(flatten(WHITE, 0, BLACK)).toEqual(BLACK)
    expect(flatten(WHITE, 0.5, BLACK)).toEqual({ r: 128, g: 128, b: 128 })
  })
})

describe('toRgb', () => {
  it('uses the fallback when a colour cannot be read', () => {
    expect(toRgb('not-a-colour', WHITE, { r: 9, g: 9, b: 9 })).toEqual({ r: 9, g: 9, b: 9 })
  })

  it('flattens alpha against the backdrop it will be printed on', () => {
    // White at 78% over a near-black band is a light grey, not white.
    const onDark = toRgb('rgba(255,255,255,0.78)', { r: 15, g: 23, b: 42 }, WHITE)
    expect(onDark).toEqual({ r: 202, g: 204, b: 208 })
  })
})

describe('paletteFor — the fix itself', () => {
  it('gives each theme its OWN band colour, not a hardcoded saffron', () => {
    /*
     * The regression this whole phase exists for. Before the fix every theme
     * produced brand {217,110,27}. If someone reintroduces a constant, the
     * distinct-count below collapses and this fails.
     */
    const bands = INVOICE_THEMES.map(t => JSON.stringify(paletteFor(t.id).band))
    expect(new Set(bands).size).toBeGreaterThan(1)

    const midnight = paletteFor('midnight')
    const saffron = paletteFor('saffron')
    expect(midnight.band).not.toEqual(saffron.band)
    expect(midnight.accent).not.toEqual(saffron.accent)
  })

  it('matches the registry the other two renderers read', () => {
    // One vocabulary: the PDF must not drift from invoice-themes.ts.
    for (const t of INVOICE_THEMES) {
      const p = paletteFor(t.id)
      const expected = parseCssColor(t.headerBg)!
      expect(p.band).toEqual(expected.rgb)
      expect(p.theme.id).toBe(t.id)
    }
  })

  it('falls back to the registry default for an unknown or missing id', () => {
    const fallback = getInvoiceTheme(null)
    expect(paletteFor(null).theme.id).toBe(fallback.id)
    expect(paletteFor(undefined).theme.id).toBe(fallback.id)
    expect(paletteFor('theme-that-was-deleted').theme.id).toBe(fallback.id)
  })

  it('never leaves band text unreadable on its own band', () => {
    /*
     * A theme could in principle pair a light header with white text. Checked
     * by luminance rather than by eye, for all eight, because this is the one
     * failure that makes an invoice unusable rather than merely ugly.
     */
    const lum = (c: Rgb) =>
      (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
    for (const t of INVOICE_THEMES) {
      const p = paletteFor(t.id)
      const contrast = Math.abs(lum(p.band) - lum(p.onBand))
      expect({ theme: t.id, contrast: contrast > 0.4 }).toEqual({ theme: t.id, contrast: true })
    }
  })

  it('keeps PAID/PARTIAL/DUE out of the theme', () => {
    // Deliberate: green means settled and red means owed to everyone. A theme
    // that recoloured them would make a paid and an unpaid bill differ by a
    // word, on the document where that distinction carries money.
    const a = paletteFor('midnight')
    const b = paletteFor('crimson')
    expect(a.paid).toEqual(b.paid)
    expect(a.due).toEqual(b.due)
    expect(a.partial).toEqual(b.partial)
  })
})
