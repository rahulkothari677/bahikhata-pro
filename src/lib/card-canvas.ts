/**
 * Draws a business card straight onto a canvas, at print resolution.
 *
 * 🐛 2026-08-04. Rahul: "the card is not get downloaded or share as it is,
 * it's being shared as text format."
 *
 * Two faults, one symptom. Share only ever sent `shareText` — a plain-text
 * summary — and Download did `await import('html2canvas')` against a package
 * that was never in package.json, so it threw on every click and fell into a
 * toast that blamed the browser. Neither path had ever produced an image.
 *
 * WHY DRAW IT RATHER THAN SCREENSHOT IT. A DOM screenshotter re-implements the
 * browser's layout engine and gets a vote on every CSS feature the card uses —
 * this card uses `cqw` units, `container-type: inline-size` and a stylesheet
 * with 150 `oklch()` colours, and a screenshotter that mis-parses any one of
 * them silently produces a wrong image rather than an error. But an artwork
 * card is only ever a background image plus text at known coordinates, and that
 * spec already exists in `card-templates.ts`. Reading the same spec means the
 * PNG cannot drift from the screen: change a zone and both move together.
 *
 * It also renders at 2100px regardless of the phone's screen — a screenshot is
 * capped by the on-screen size, and a 380px-wide card is unusable in print.
 *
 * The legacy vector designs (business-card-designs.ts) have no such spec; they
 * are CSS all the way down, and are exported with html2canvas-pro instead.
 * See `renderCardBlob` for how the two paths are chosen.
 */

import type { CardTemplate, Zone } from '@/lib/card-templates'
import type { TemplateCardData } from '@/components/common/TemplateCard'
import { deriveMonogram } from '@/lib/brand-monogram'
import {
  getMonogramFont,
  cardTextFont,
  canvasFontSpec,
  monogramFontFamilyName,
  type MonogramFont,
} from '@/lib/monogram-fonts'
import { fitMonogram, resetMonogramMetrics } from '@/lib/monogram-fit'
import {
  fitTextCqw,
  willTruncate,
  measuredGlyphRatio,
  resetGlyphRatios,
  SHOP_NAME_GLYPH_RATIO,
} from '@/lib/fit-text'

/**
 * 2100px wide = 7in at 300dpi, so the card prints at 3.5in with room to crop.
 * The artwork files are 1050–1536px, so this upscales them roughly 1.5×; the
 * TEXT is drawn at full resolution either way, and text is what a reader's eye
 * catches blur in. Going higher would only enlarge the artwork's own softness.
 */
const EXPORT_WIDTH = 2100

/**
 * lucide-react's geometry for the four contact icons, copied from the package
 * so the PNG uses the same marks as the screen.
 *
 * They are re-serialised into a standalone SVG and decoded as an image rather
 * than replayed as Path2D: these icons mix `path`, `circle` and `rect` with
 * round joins and caps, and re-implementing that faithfully is work the
 * browser's own SVG renderer already does correctly.
 */
const ICONS: Record<string, string> = {
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  phone:
    '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  mappin:
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
}

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load image: ${src.slice(0, 80)}`))
    img.src = src
  })
}

/** A lucide icon as a decoded image, stroked in `color`. */
function iconImage(name: keyof typeof ICONS | string, color: string, px: number) {
  const body = ICONS[name] ?? ICONS.user
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${body}</svg>`
  // encodeURIComponent, not base64: the colour is interpolated in, and base64
  // of a string containing '#' is one more place to get the escaping wrong.
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
}

/**
 * Waits for a self-hosted monogram face to be usable.
 *
 * Without this the PNG is a coin toss. `font-display: swap` means the first
 * card render paints in Times New Roman and switches when the WOFF2 arrives —
 * fine on screen, where the swap happens in 200ms, but a canvas has no second
 * chance: whatever is loaded when `fillText` runs is what ships in the file.
 *
 * Never throws. A monogram in a fallback face is a worse card; a card that
 * fails to export is no card.
 */
async function ensureFont(family: string | null, sizePx: number, weight: number) {
  if (!family || typeof document === 'undefined' || !document.fonts) return
  try {
    await document.fonts.load(`${weight} ${Math.round(sizePx)}px "${family}"`)
    await document.fonts.ready
    // Any metrics cached while the face was still downloading were taken
    // against the fallback and would size this export wrongly.
    resetMonogramMetrics()
  } catch {
    // Deliberate: see above.
  }
}

/**
 * Sets canvas letter-spacing.
 *
 * ⚠️ `'normal'` IS NOT A VALID VALUE HERE. The CSS property accepts it; the
 * canvas one takes a `<length>` only, and rejects anything else by SILENTLY
 * KEEPING THE PREVIOUS VALUE. So `setLetterSpacing(ctx, 'normal')` — the
 * obvious way to write "reset this" — reset nothing, and every element
 * inherited the tracking of whichever element was drawn before it.
 *
 * It surfaced when the tagline was added: its 0.1em carried into the contact
 * rows below, adding 0.1em per character, and a 28-character address measured
 * 840px against a 735px slot and came out as "Mumbai, Maharashtra - 4…" in the
 * exported PNG while the on-screen card showed it in full. Before the tagline
 * existed the leak was the shop name's -0.02em, which made contacts slightly
 * TIGHTER than the screen — wrong in the same way, but invisible.
 *
 * Normalising to `0px` is the fix; the guard remains for engines with no
 * letterSpacing at all.
 */
function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string) {
  try {
    ctx.letterSpacing = value === 'normal' || !value ? '0px' : value
  } catch {
    // Older engines ignore tracking, which is a cosmetic difference only.
  }
}

/** Shortens to fit, with an ellipsis — the canvas equivalent of `truncate`. */
function clip(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string {
  if (ctx.measureText(text).width <= maxPx) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxPx) s = s.slice(0, -1)
  return `${s}…`
}

/** Greedy word wrap, capped at `maxLines`; the last line is ellipsised. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxPx: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > maxPx && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines - 1) break
    } else {
      line = next
    }
  }
  const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length
  const rest = words.slice(consumed).join(' ')
  if (rest) lines.push(clip(ctx, rest, maxPx))
  else if (line) lines.push(clip(ctx, line, maxPx))
  return lines.slice(0, maxLines)
}

/**
 * Renders an artwork template to a PNG blob.
 *
 * Mirrors TemplateCard's arithmetic deliberately — the same `fitTextCqw` calls
 * with the same bounds — so the exported file is the card the shopkeeper saw.
 * Where the component says `4.4cqw`, this says `cqw(4.4)`.
 */
export async function renderTemplateCardToBlob(
  template: CardTemplate,
  data: TemplateCardData,
  opts: { width?: number; qrSvg?: SVGElement | null } = {},
): Promise<Blob> {
  const W = opts.width ?? EXPORT_WIDTH
  const H = Math.round(W / template.aspect)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not create a canvas to draw the card.')

  /** cqw is percent-of-card-width, exactly as in the component. */
  const cqw = (v: number) => (v / 100) * W
  const px = (pct: number) => (pct / 100) * W
  const py = (pct: number) => (pct / 100) * H

  const z = template.zones
  const ink = template.ink

  // Every chosen face must be resolved and LOADED before anything is measured
  // or drawn. A canvas has no second chance: whatever is available when
  // fillText runs is what ships in the file, and a face that arrives a moment
  // later cannot repaint it.
  const shopFont = cardTextFont(data.shopFontId)
  const taglineFont = cardTextFont(data.taglineFontId)
  const contactFont = cardTextFont(data.contactFontId)
  const monoFont = getMonogramFont(data.monogramFontId)
  await Promise.all(
    [monoFont, shopFont, taglineFont, contactFont]
      .filter((f): f is MonogramFont => Boolean(f?.file))
      .map(f => ensureFont(monogramFontFamilyName(f), 200, f.fontWeight)),
  )
  // Ratios cached while those faces were still downloading were measured
  // against the fallback and would size this export wrongly.
  resetGlyphRatios()
  resetMonogramMetrics()

  /** Font shorthand for a card element, honouring the shopkeeper's choice. */
  const fontFor = (font: MonogramFont | null, sizePx: number, weight: number, fallbackFamily: string) =>
    font ? canvasFontSpec(font, sizePx) : `${weight} ${sizePx}px ${fallbackFamily}`

  /** Matches TemplateCard: measure a chosen face, estimate the default one. */
  const ratioFor = (text: string | null | undefined, font: MonogramFont | null, fallback?: number) =>
    font ? measuredGlyphRatio(text, canvasFontSpec(font, 100), font.letterSpacing) ?? fallback : fallback

  // The app's own body face, so the card's text matches the rest of the UI.
  // Read from the live document rather than hard-coded: the app loads its sans
  // through a CSS variable, and duplicating the stack here would let the two
  // drift apart the first time it changes.
  const bodyFont =
    (typeof window !== 'undefined' &&
      getComputedStyle(document.body).fontFamily) ||
    'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

  // ── background artwork ────────────────────────────────────────────────
  ctx.fillStyle = template.fallbackColor
  ctx.fillRect(0, 0, W, H)
  try {
    // `anonymous` so a Cloudinary-hosted template does not taint the canvas —
    // a tainted canvas throws on toBlob, which would break export for exactly
    // the templates that are not bundled with the app.
    const art = await loadImage(template.image, 'anonymous')
    // object-cover: fill the frame, crop the overflow, never distort.
    const scale = Math.max(W / art.width, H / art.height)
    const dw = art.width * scale
    const dh = art.height * scale
    ctx.drawImage(art, (W - dw) / 2, (H - dh) / 2, dw, dh)
  } catch {
    // Same contract as the component: artwork failing leaves the fallback
    // colour and the text still renders. A card with no background is
    // recoverable; a card with no details is not.
  }

  ctx.textBaseline = 'alphabetic'

  // ── logo / monogram ───────────────────────────────────────────────────
  if (z.logo) {
    const zoneL = px(z.logo.x)
    const zoneW = px(z.logo.w)
    const zoneT = py(z.logo.y)

    if (data.logoUrl) {
      try {
        const logo = await loadImage(data.logoUrl, 'anonymous')
        // As wide as the zone, capped at the monogram's box height — matching
        // the component. See TemplateCard for why it is a rectangle and not a
        // square: a square the zone's width would run through the ornamental
        // rule, and a square the box's height wastes the width that most shop
        // logos, being wordmarks, actually need.
        const boxW = zoneW
        const boxH = cqw(z.logo.size * 0.69)
        // object-contain: fit inside, never crop, never distort.
        const s = Math.min(boxW / logo.width, boxH / logo.height)
        ctx.drawImage(
          logo,
          zoneL + (boxW - logo.width * s) / 2,
          zoneT + (boxH - logo.height * s) / 2,
          logo.width * s,
          logo.height * s,
        )
      } catch {
        // An unreachable logo URL must not cost the shopkeeper their card.
        // Cloudinary being slow is not a reason to hand back no card at all.
      }
    } else {
      const font = monoFont
      const monogram = deriveMonogram(data.shopName, data.ownerName)

      // The same fit the screen used, from the same module — the exported card
      // cannot disagree with the previewed one about how big the mark is.
      const fit = fitMonogram(monogram, font, {
        logoSizeCqw: z.logo.size,
        maxInkWidthCqw: z.logo.w,
      })
      const sizePx = cqw(fit.fontSizeCqw)

      ctx.font = `${font.fontStyle} ${font.fontWeight} ${sizePx}px ${font.fontFamily}`
      setLetterSpacing(ctx, font.letterSpacing)
      ctx.fillStyle = z.logo.color ?? ink.primary
      ctx.textAlign = 'center'

      // The box the mark is centred in is fixed to the REFERENCE size, exactly
      // as in the component — so switching typefaces changes the letters and
      // not their position on the card.
      const boxH = cqw(z.logo.size * 0.69)
      const centreY = zoneT + boxH / 2

      // Centre the INK, not the line box and not the advance width: a script's
      // swash hangs outside both.
      //
      // ⚠️ actualBoundingBoxLeft/Right are measured from the ALIGNMENT POINT,
      // which `textAlign` moves. With 'center' set above, the alignment point is
      // already the middle of the advance, so the ink spans [-left, +right]
      // around it and its centre is (right - left) / 2. Subtracting the advance
      // width here — correct for left-aligned text — shifted every mark right by
      // half its own width, which the on-screen card did not do and the exported
      // PNG did. Caught by measuring the exported pixels, not by reading this.
      const m = ctx.measureText(monogram)
      const inkCentreX = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2
      const inkCentreY = (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2

      ctx.fillText(monogram, zoneL + zoneW / 2 - inkCentreX, centreY - inkCentreY)
      setLetterSpacing(ctx, 'normal')
    }
  }

  // ── shop name ─────────────────────────────────────────────────────────
  {
    const name = data.shopName || 'My Shop'
    const fit = {
      zoneWidthPercent: z.shopName.w,
      maxCqw: 6.4,
      minCqw: 3.2,
      glyphRatio: ratioFor(name, shopFont, SHOP_NAME_GLYPH_RATIO),
    }
    const sizePx = cqw(fitTextCqw(name, fit))
    ctx.font = fontFor(shopFont, sizePx, 700, bodyFont)
    setLetterSpacing(ctx, shopFont ? shopFont.letterSpacing : '-0.02em')
    ctx.fillStyle = ink.primary
    const zoneL = px(z.shopName.x)
    const zoneW = px(z.shopName.w)
    ctx.textAlign = z.shopName.align ?? 'left'
    const anchorX =
      ctx.textAlign === 'center' ? zoneL + zoneW / 2 : ctx.textAlign === 'right' ? zoneL + zoneW : zoneL

    // Two lines beat an ellipsis: a wrapped name is still the shop's name,
    // where "Shree Siddhivinayak Gen…" is not.
    const lines = willTruncate(name, fit) ? wrap(ctx, name, zoneW, 2) : [clip(ctx, name, zoneW)]
    const lineH = sizePx * 1.08
    lines.forEach((ln, i) => {
      // The DOM's first text line sits about 0.8em below the block's top.
      ctx.fillText(ln, anchorX, py(z.shopName.y) + sizePx * 0.82 + i * lineH)
    })
    setLetterSpacing(ctx, 'normal')
  }

  // ── tagline ───────────────────────────────────────────────────────────
  if (z.tagline && data.tagline) {
    const sizePx = cqw(
      fitTextCqw(data.tagline, {
        zoneWidthPercent: z.tagline.w,
        maxCqw: 2.9,
        minCqw: 1.8,
        glyphRatio: ratioFor(data.tagline, taglineFont, taglineFont ? undefined : 0.72),
      }),
    )
    ctx.font = fontFor(taglineFont, sizePx, 600, bodyFont)
    setLetterSpacing(ctx, taglineFont ? taglineFont.letterSpacing : '0.1em')
    ctx.fillStyle = z.tagline.color ?? ink.accent
    ctx.textAlign = z.tagline.align ?? 'left'
    const zoneL = px(z.tagline.x)
    const zoneW = px(z.tagline.w)
    const anchorX =
      ctx.textAlign === 'center' ? zoneL + zoneW / 2 : ctx.textAlign === 'right' ? zoneL + zoneW : zoneL
    // Uppercased only on the default face — a script has no capitals worth the
    // name, and forcing them turns a signature into shouting.
    const shown = taglineFont ? data.tagline : data.tagline.toUpperCase()
    ctx.fillText(clip(ctx, shown, zoneW), anchorX, py(z.tagline.y) + sizePx * 0.82)
    setLetterSpacing(ctx, 'normal')
  }

  // ── ornamental rule: line · diamond · line ────────────────────────────
  if (z.divider) {
    const zoneL = px(z.divider.x)
    const zoneW = px(z.divider.w)
    const y = py(z.divider.y)
    const ruleH = cqw(0.16)
    const dia = cqw(0.9)
    const gap = cqw(1.2)
    const armW = (zoneW - dia - gap * 2) / 2

    ctx.globalAlpha = 0.62
    ctx.fillStyle = ink.accent
    ctx.fillRect(zoneL, y - ruleH / 2, armW, ruleH)
    ctx.fillRect(zoneL + zoneW - armW, y - ruleH / 2, armW, ruleH)

    // A rotated square, not a bullet: a • renders at a different optical size
    // in every typeface, so the ornament would drift between fonts.
    ctx.globalAlpha = 0.85
    ctx.save()
    ctx.translate(zoneL + zoneW / 2, y)
    ctx.rotate(Math.PI / 4)
    ctx.fillRect(-dia / 2, -dia / 2, dia, dia)
    ctx.restore()
    ctx.globalAlpha = 1
  }

  if (z.dividerBottom) {
    ctx.globalAlpha = 0.62
    ctx.fillStyle = ink.accent
    ctx.fillRect(px(z.dividerBottom.x), py(z.dividerBottom.y), px(z.dividerBottom.w), cqw(0.16))
    ctx.globalAlpha = 1
  }

  // ── contact rows ──────────────────────────────────────────────────────
  if (z.contact) {
    const rows = (
      [
        { icon: 'user', value: data.ownerName },
        { icon: 'phone', value: data.phone },
        { icon: 'mail', value: data.email },
        { icon: 'mappin', value: data.address },
      ] as const
    ).filter(r => Boolean(r.value)) as Array<{ icon: string; value: string }>

    if (rows.length > 0) {
      // The icon, its hairline and two gaps eat ~9cqw before any text — the
      // component's CONTACT_CHROME_CQW. Sizing against the full zone is what
      // let a long email render past its slot.
      const CHROME = 9
      const textWidthCqw = Math.max(8, z.contact.w - CHROME)
      const textWidthPx = cqw(textWidthCqw)

      const ownerPx = cqw(
        fitTextCqw(data.ownerName, {
          zoneWidthPercent: textWidthCqw,
          maxCqw: 3.9,
          minCqw: 2.5,
          glyphRatio: ratioFor(data.ownerName, contactFont),
        }),
      )
      // Only the plain rows drive the shared size; the owner has its own.
      const longest = rows.slice(1).reduce((a, r) => (r.value.length > a.length ? r.value : a), '')
      const bodyPx = cqw(
        fitTextCqw(longest, {
          zoneWidthPercent: textWidthCqw,
          maxCqw: 3.2,
          minCqw: 2.1,
          glyphRatio: ratioFor(longest, contactFont, 0.52),
        }),
      )

      const iconBox = cqw(4.4)
      const iconGlyph = cqw(2.7)
      const gap = cqw(2)
      const rowGap = cqw(2.2)
      const ic = template.contactIcons
      const contactInk = ink.contact ?? ink.secondary

      // The DOM stacks rows with `gap`, each row as tall as its tallest child —
      // the icon box, since it is larger than any of the text.
      const rowH = iconBox
      const zoneL = px(z.contact.x)
      let y = py(z.contact.y)

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const cy = y + rowH / 2
        let x = zoneL

        if (ic) {
          if (ic.style === 'circle' && ic.background) {
            ctx.fillStyle = ic.background
            ctx.beginPath()
            ctx.arc(x + iconBox / 2, cy, iconBox / 2, 0, Math.PI * 2)
            ctx.fill()
          }
          try {
            // Rasterised at 4× the drawn size so the strokes stay crisp when
            // the PNG is zoomed or printed.
            const img = await iconImage(row.icon, ic.color, Math.round(iconGlyph * 4))
            ctx.drawImage(img, x + (iconBox - iconGlyph) / 2, cy - iconGlyph / 2, iconGlyph, iconGlyph)
          } catch {
            // A missing icon must not cost the row its text.
          }
          x += iconBox + gap
        }

        if (ic?.divider) {
          // The hairline between icon and text — it is what stops the rows
          // reading as a bulleted list.
          ctx.globalAlpha = 0.35
          ctx.fillStyle = contactInk
          ctx.fillRect(x, cy - iconBox / 2, cqw(0.2), iconBox)
          ctx.globalAlpha = 1
          x += cqw(0.2) + gap
        }

        const isOwner = i === 0
        const sizePx = isOwner ? ownerPx : bodyPx
        ctx.font = fontFor(contactFont, sizePx, isOwner ? 600 : 400, bodyFont)
        setLetterSpacing(ctx, contactFont ? contactFont.letterSpacing : 'normal')
        ctx.fillStyle = contactInk
        ctx.textAlign = 'left'
        // Centred on the row, using the font's own metrics rather than a
        // guessed fraction of the size — the two differ enough at 3cqw to read
        // as a row that has slipped.
        const m = ctx.measureText('Hxg')
        const half = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
        ctx.fillText(clip(ctx, row.value, textWidthPx), x, cy + half)
        setLetterSpacing(ctx, 'normal')

        y += rowH + rowGap
      }
    }
  }

  // ── GSTIN ─────────────────────────────────────────────────────────────
  if (z.gstin && data.gstin) {
    const label = `GSTIN ${data.gstin}`
    const sizePx = cqw(
      fitTextCqw(label, { zoneWidthPercent: z.gstin.w, maxCqw: 2.7, minCqw: 1.9, glyphRatio: 0.58 }),
    )
    ctx.font = `400 ${sizePx}px ${bodyFont}`
    setLetterSpacing(ctx, '0.06em')
    ctx.fillStyle = z.gstin.color ?? ink.label
    ctx.textAlign = 'left'
    ctx.fillText(clip(ctx, label, px(z.gstin.w)), px(z.gstin.x), py(z.gstin.y) + sizePx * 0.82)
    setLetterSpacing(ctx, 'normal')
  }

  // ── QR ────────────────────────────────────────────────────────────────
  if (z.qr && opts.qrSvg) {
    try {
      // Serialised from the live card rather than re-encoded here: re-encoding
      // means a second QR implementation that can disagree with the one on
      // screen about error-correction level or quiet zone.
      const svgText = new XMLSerializer().serializeToString(opts.qrSvg)
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`)
      const box = px(z.qr.size)
      const pad = box * 0.04
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(px(z.qr.x), py(z.qr.y), box, box)
      ctx.drawImage(img, px(z.qr.x) + pad, py(z.qr.y) + pad, box - pad * 2, box - pad * 2)
    } catch {
      // The QR is a convenience; the printed details are the card.
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('The browser could not turn the card into an image.'))),
      'image/png',
    )
  })
}

/**
 * Screenshots a DOM node. Used only for the legacy vector designs, which are
 * described entirely in CSS and so have no zone spec to draw from.
 *
 * html2canvas-pro rather than html2canvas: the app's stylesheet has 150
 * `oklch()` colours (Tailwind 4's default palette) and the original throws on
 * the first one it meets. The import is dynamic so the ~400 KB only ever
 * reaches a device that actually exports a vector design.
 */
export async function renderNodeToBlob(node: HTMLElement, scale = 3): Promise<Blob> {
  const html2canvas = (await import('html2canvas-pro')).default
  const canvas = await html2canvas(node, {
    scale,
    useCORS: true,
    backgroundColor: null,
    logging: false,
  })
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('The browser could not turn the card into an image.'))),
      'image/png',
    )
  })
}

/** Filename for the download and for the shared file. */
export function cardFileName(shopName?: string | null): string {
  const base = (shopName || 'business-card')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${base || 'business-card'}-card.png`
}
