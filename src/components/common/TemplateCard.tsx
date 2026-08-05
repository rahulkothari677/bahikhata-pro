'use client'

/**
 * TemplateCard — background artwork with LIVE text composited over it.
 *
 * 🎨 2026-07-29. The card artwork is an image a designer made; everything the
 * shopkeeper sees about themselves is drawn by the browser on top of it.
 *
 * That split is the whole design:
 *   - the artwork can be as rich as a photograph, because it IS one
 *   - the text stays vector-sharp when printed or zoomed, where text baked into
 *     a JPEG turns to mush
 *   - one image serves every shop in a category
 *   - the shopkeeper can edit their own details
 *
 * Everything scales in `cqw` (percent of card width), so a card is identical at
 * thumbnail size, on a phone, and at print resolution. Using px would mean
 * three sets of numbers that drift apart.
 */

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Phone, Mail, MapPin, User, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { deriveMonogram } from '@/lib/brand-monogram'
import {
  getMonogramFont,
  cardTextFont,
  canvasFontSpec,
  monogramFontFamilyName,
  monogramStyle,
  type MonogramFont,
} from '@/lib/monogram-fonts'
import { fitMonogram, resetMonogramMetrics } from '@/lib/monogram-fit'
import { measuredGlyphRatio, resetGlyphRatios } from '@/lib/fit-text'
import { fitTextCqw, willTruncate, SHOP_NAME_GLYPH_RATIO } from '@/lib/fit-text'
import type { CardTemplate, Zone } from '@/lib/card-templates'

export interface TemplateCardData {
  shopName?: string | null
  /** Free text under the shop name — "Your Daily Grocery Partner". Editable. */
  tagline?: string | null
  ownerName?: string | null
  /** "Proprietor", "Founder", "Manager". Editable. */
  designation?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  website?: string | null
  gstin?: string | null
  /** Uploaded logo. When absent the monogram is drawn instead — never empty. */
  logoUrl?: string | null
  /**
   * A typeface per element. See lib/monogram-fonts. null on any of these means
   * "keep the app's default face for that part of the card" — only the logo
   * always resolves to a face, because bare letterforms ARE the logo.
   */
  monogramFontId?: string | null
  shopFontId?: string | null
  taglineFontId?: string | null
  contactFontId?: string | null
}

interface Props {
  template: CardTemplate
  data: TemplateCardData
  qrValue?: string
  onLogoClick?: () => void
  className?: string
}

/**
 * Sizes the monogram from the real letterforms, once they can be measured.
 *
 * Two things have to happen before a measurement means anything: the component
 * has to be on a client (the server has no canvas), and the WOFF2 has to have
 * arrived (measuring a face that has not loaded measures Times New Roman). So
 * this starts on the registry's rough estimate — matching what the server
 * rendered, which keeps hydration quiet — and switches to the measured size
 * when both are true.
 */
function useMonogramFit(
  text: string,
  font: MonogramFont,
  opts: { logoSizeCqw: number; maxInkWidthCqw: number },
) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    const family = monogramFontFamilyName(font)
    const loaded =
      family && typeof document !== 'undefined' && document.fonts
        ? document.fonts.load(`${font.fontWeight} 200px "${family}"`)
        : Promise.resolve()

    loaded
      .catch(() => {
        // A face that fails to download still gets measured — as its fallback,
        // which is exactly what will be drawn.
      })
      .then(() => {
        if (!live) return
        // The first measurement may have been taken against the fallback face
        // while the WOFF2 was still in flight, and it was cached.
        resetMonogramMetrics()
        setReady(true)
      })

    return () => {
      live = false
    }
  }, [font])

  return fitMonogram(text, font, { ...opts, measure: ready })
}

/**
 * CSS for a text element that carries a chosen typeface.
 *
 * Returns `{}` when nothing is chosen, so the element keeps whatever the card
 * already gave it — the default appearance is untouched by this feature.
 */
function textFontStyle(font: MonogramFont | null): React.CSSProperties {
  if (!font) return {}
  return {
    fontFamily: font.fontFamily,
    fontWeight: font.fontWeight,
    fontStyle: font.fontStyle,
    letterSpacing: font.letterSpacing,
  }
}

/**
 * The glyph ratio to size this text with.
 *
 * A chosen face is MEASURED: one average glyph width cannot cover both
 * Archivo Black and Tangerine, and getting it wrong overflows the zone or
 * shrinks the text to nothing. Text on the default face keeps the estimate,
 * which is the sizing already approved.
 */
function ratioFor(text: string | null | undefined, font: MonogramFont | null, fallback?: number) {
  if (!font) return fallback
  return measuredGlyphRatio(text, canvasFontSpec(font, 100), font.letterSpacing) ?? fallback
}

/**
 * Re-renders once the chosen webfonts are usable.
 *
 * Without this the first paint measures the FALLBACK face and caches the
 * result, so a card set in Tangerine would be sized as if it were Times New
 * Roman — and it would stay that way, because the cache never expires.
 */
function useFontsReady(fonts: Array<MonogramFont | null>) {
  const [, bump] = useState(0)
  const key = fonts.map(f => f?.id ?? '-').join(',')

  useEffect(() => {
    let live = true
    if (typeof document === 'undefined' || !document.fonts) return
    const loads = fonts
      .filter((f): f is MonogramFont => Boolean(f?.file))
      .map(f => document.fonts.load(`${f.fontWeight} 200px "${monogramFontFamilyName(f)}"`))

    Promise.all(loads)
      .catch(() => {
        // A face that fails to download is still measured — as its fallback,
        // which is what will actually be drawn.
      })
      .then(() => {
        if (!live) return
        resetGlyphRatios()
        resetMonogramMetrics()
        bump(n => n + 1)
      })

    return () => {
      live = false
    }
    // Keyed on the font IDS, not the array: a new array every render would
    // re-run this on every render.
  }, [key])
}

/** Turns a zone into absolute positioning. */
function zoneStyle(z: Zone): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${z.x}%`,
    top: `${z.y}%`,
    width: `${z.w}%`,
    textAlign: z.align ?? 'left',
  }
}

export function TemplateCard({ template: t, data, qrValue, onLogoClick, className }: Props) {
  const [artFailed, setArtFailed] = useState(false)
  const z = t.zones

  const monogram = deriveMonogram(data.shopName, data.ownerName)

  const monoFont = getMonogramFont(data.monogramFontId)
  const shopFont = cardTextFont(data.shopFontId)
  const taglineFont = cardTextFont(data.taglineFontId)
  const contactFont = cardTextFont(data.contactFontId)
  useFontsReady([monoFont, shopFont, taglineFont, contactFont])

  // The mark is sized from its own letterforms, so every typeface lands on the
  // same optical weight. `logoSizeCqw` names the composition the artwork was
  // drawn for; `maxInkWidthCqw` is the slot it must not escape.
  const monoFit = useMonogramFit(monogram, monoFont, {
    logoSizeCqw: z.logo?.size ?? 25,
    maxInkWidthCqw: z.logo?.w ?? 28,
  })

  /**
   * The box the mark is centred in.
   *
   * Fixed to the REFERENCE size, not the fitted one. If the box tracked the
   * fitted size, a face that measured small would sit high and one that
   * measured large would sit low, and the mark would visibly hop up and down
   * the card as the shopkeeper tried typefaces. Anchoring the box means the ink
   * centre stays put and only the letters change.
   */
  const monoBoxCqw = (z.logo?.size ?? 25) * 0.69

  // The icon, its divider and two gaps consume roughly 9cqw before any text —
  // but only when the CARD draws them. Where the artwork already has its own
  // printed icons the text starts at the zone's edge, and subtracting chrome
  // that is not there would shrink every line for no reason.
  const CONTACT_CHROME_CQW = t.contactIcons ? 9 : 0

  // Fitted sizes. A shop is called "RK" or "Shree Siddhivinayak General Stores"
  // and both land in the same slot, so a fixed size truncates one of them.
  const shopFit = {
    zoneWidthPercent: z.shopName.w,
    maxCqw: 6.4,
    // Below this the name is illegible at card size, so shrinking further is
    // not a fix. Names that still do not fit WRAP instead — see below.
    minCqw: 3.2,
    glyphRatio: ratioFor(data.shopName || 'My Shop', shopFont, SHOP_NAME_GLYPH_RATIO),
  }
  const shopNameCqw = fitTextCqw(data.shopName || 'My Shop', shopFit)

  // "Shree Siddhivinayak General Stores" is 34 characters and cannot fit one
  // line at a legible size. Two lines beat an ellipsis: a wrapped name is still
  // the shop's name, whereas "Shree Siddhivinayak Gen…" is not.
  const shopNameWraps = willTruncate(data.shopName, shopFit)
  const contactTextWidth = Math.max(8, (z.contact?.w ?? 40) - CONTACT_CHROME_CQW)

  const contactRatio = ratioFor(data.email || data.phone, contactFont)
  const ownerCqw = fitTextCqw(data.ownerName, {
    glyphRatio: ratioFor(data.ownerName, contactFont),
    zoneWidthPercent: contactTextWidth,
    // Heads the contact panel, but must stay BELOW the shop name optically —
    // at 4.6 it rendered 28px against the name's 27px and stole the hierarchy.
    // The shop is the brand; the owner is who you ask for.
    maxCqw: 3.9,
    minCqw: 2.5,
  })
  const designationCqw = fitTextCqw(data.designation, {
    zoneWidthPercent: contactTextWidth,
    maxCqw: 2.6,
    minCqw: 1.9,
    // Uppercase with wide tracking eats far more width per character.
    glyphRatio: 0.78,
  })

  // (CONTACT_CHROME_CQW is declared above so the owner fit can use it too.)
  // Contact rows are fitted to the LONGEST line and all share that size.
  // Sizing each row independently would step the type up and down the block,
  // which reads as a rendering fault rather than a design.
  //
  // The icon, its divider and two gaps eat roughly 9cqw before any text, so the
  // usable width is the zone minus that — sizing against the full zone is what
  // let "rjrahuljain980@gmail.com" render 216px into a 189px slot.

  const contactRows = (
    [
      // The OWNER is row one, with its own icon.
      //
      // It used to sit above the list as a bare heading, which put it on a
      // different left edge from everything under it — the misalignment Rahul
      // spotted. As a row it shares the icon column, the divider and the text
      // column with the phone and address, so the whole panel reads as one
      // block instead of a title floating over a list.
      // Owner only. `designation` is deliberately NOT rendered: Rahul removed
      // "PROPRIETOR" from his reference, and on a card where the shop name is
      // already the headline it is a third label competing for the same eye.
      // The field is kept on the data type so a template can opt back in.
      { icon: User, value: data.ownerName },
      { icon: Phone, value: data.phone },
      { icon: Mail, value: data.email },
      { icon: MapPin, value: data.address },
      // GSTIN joins the list only where the artwork prints a GST icon for it.
      { icon: FileText, value: z.contact?.withGstin ? data.gstin : null },
    ] as const
  ).filter(r => Boolean(r.value)) as Array<{
    icon: typeof Phone
    value: string
    sub?: string | null
  }>

  // Only the PLAIN rows drive the shared size — the owner row has its own,
  // larger size, so including it would shrink the phone and address needlessly.
  const longestContact = contactRows
    .filter(r => !r.sub)
    .reduce((a, r) => (r.value.length > a.length ? r.value : a), '')
  const contactCqw = fitTextCqw(longestContact, {
    zoneWidthPercent: contactTextWidth,
    // 3.2cqw on a 1050px card is ~8pt — the upper end of business-card body copy.
    maxCqw: 3.2,
    // ~5.5pt at card size. Lowered from 2.1 on 2026-08-05: the eight new
    // artworks set their own line length with printed rules, and at 2.1 a
    // perfectly ordinary address — "Mumbai, Maharashtra - 400001" — hit the
    // floor and truncated on six of them. Small, but a shopkeeper would rather
    // read their whole address than half of it in a larger size.
    minCqw: 1.9,
    glyphRatio: contactRatio ?? 0.52,
  })

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-xl', className)}
      style={{ aspectRatio: String(t.aspect), background: t.fallbackColor, containerType: 'inline-size' }}
    >
      {/* Artwork. On failure the fallback colour shows through and the TEXT
          STILL RENDERS — a card missing its background is recoverable; a card
          that renders nothing is not. */}
      {!artFailed && (
        <img
          src={t.image}
          alt=""
          aria-hidden="true"
          onError={() => setArtFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* ── logo / monogram ─────────────────────────────────────────────── */}
      {/* Width comes from the ZONE (`w`), not from `size` — `size` drives the
          font size only. Overriding width with it made the monogram box 25%
          wide inside a 28% zone, so its centre sat at 22.5% while the ornament
          below centred at 24%: a 1.5% drift, visible as the mark not quite
          sitting over the rule. */}
      {z.logo && (
        <div style={zoneStyle(z.logo)}>
          {data.logoUrl ? (
            /* An uploaded logo takes the MONOGRAM'S box, not the whole zone.
               The zone is 28% of the card wide, and a square that wide is 42%
               of the card TALL — it would have run straight down through the
               ornamental rule and into the shop name. The monogram's box is the
               space the artwork actually leaves for a mark, so the logo gets
               exactly that, centred in the zone the same way the letters are.

               No white plate behind it. The logo slot sits on the calm, light
               part of the artwork by design, and a white square there reads as
               a sticker on the paper. */
            <button
              type="button"
              onClick={onLogoClick}
              disabled={!onLogoClick}
              aria-label={onLogoClick ? 'Change your shop logo' : undefined}
              className={cn('w-full block', onLogoClick && 'transition hover:opacity-80 cursor-pointer')}
              // As WIDE as the zone, but no taller than the monogram's box.
              //
              // Not a square. A square the width of the zone would be 42% of
              // the card tall and would run through the ornamental rule into
              // the shop name; a square the HEIGHT of the monogram box wastes
              // the zone's width, and most shop logos are wider than they are
              // tall — a wordmark boxed into a square renders at half the
              // weight of the initials it replaced. This rectangle lets a wide
              // logo use the full width and caps a tall one at the height the
              // artwork actually leaves free.
              style={{ height: `${monoBoxCqw}cqw` }}
            >
              <img
                src={data.logoUrl}
                alt={`${data.shopName || 'Shop'} logo`}
                className={cn(
                  'w-full h-full object-contain',
                  z.logo.shape === 'circle' ? 'rounded-full' : z.logo.shape === 'rounded' ? 'rounded-lg' : '',
                )}
              />
            </button>
          ) : z.logo.style === 'typographic' ? (
            /* Bare letterforms on the artwork — no badge, no fill.
               This is what makes the reference cards look printed rather than
               generated: a filled coloured square reads as an app avatar. */
            <button
              type="button"
              onClick={onLogoClick}
              disabled={!onLogoClick}
              aria-label={onLogoClick ? 'Add your shop logo' : undefined}
              className={cn(
                'w-full grid place-items-center leading-none overflow-visible',
                onLogoClick && 'transition hover:opacity-80 cursor-pointer',
              )}
              style={{
                ...monogramStyle(monoFont, z.logo.color ?? t.ink.primary, monoFit.fontSizeCqw),
                height: `${monoBoxCqw}cqw`,
              }}
            >
              {/* The nudge centres the INK, which is not where centring the
                  line box puts it — see lib/monogram-fit. `block` so the
                  transform applies; an inline span would ignore it. */}
              <span
                className="block"
                style={{ transform: `translate(${monoFit.dxEm}em, ${monoFit.dyEm}em)` }}
              >
                {monogram}
              </span>
            </button>
          ) : (
            /* Filled badge. For artwork too busy to carry bare letters. */
            <button
              type="button"
              onClick={onLogoClick}
              disabled={!onLogoClick}
              aria-label={onLogoClick ? 'Add your shop logo' : undefined}
              className={cn(
                'w-full grid place-items-center font-semibold shadow-sm text-white',
                z.logo.shape === 'circle' ? 'rounded-full' : z.logo.shape === 'rounded' ? 'rounded-lg' : '',
                onLogoClick && 'transition hover:scale-105 active:scale-95 cursor-pointer',
              )}
              style={{
                aspectRatio: '1',
                background: t.ink.accent,
                fontSize: `${z.logo.size * 0.42}cqw`,
                letterSpacing: '.02em',
              }}
            >
              {monogram}
            </button>
          )}
        </div>
      )}

      {/* ── shop name ───────────────────────────────────────────────────── */}
      <div style={zoneStyle(z.shopName)}>
        <p
          className={cn(
            'leading-[1.08]',
            // A chosen face brings its own weight and tracking; forcing bold on
            // a script thickens it into a blur.
            !shopFont && 'font-bold',
            shopNameWraps ? 'line-clamp-2' : 'truncate',
          )}
          style={{
            color: t.ink.primary,
            letterSpacing: '-.02em',
            ...textFontStyle(shopFont),
            fontSize: `${shopNameCqw}cqw`,
          }}
        >
          {data.shopName || 'My Shop'}
        </p>
      </div>

      {z.tagline && data.tagline && (
        <div style={zoneStyle(z.tagline)}>
          <p
            className={cn('truncate', !taglineFont && 'font-semibold uppercase')}
            style={{
              color: z.tagline.color ?? t.ink.accent,
              letterSpacing: '.1em',
              ...textFontStyle(taglineFont),
              // Fitted rather than fixed at 2.9cqw. "Your Daily Grocery Partner
              // Since 1998" is 40 characters and was silently ellipsised; a
              // tagline the shopkeeper cannot read back is not a tagline.
              fontSize: `${fitTextCqw(data.tagline, {
                zoneWidthPercent: z.tagline.w,
                maxCqw: 2.9,
                minCqw: 1.8,
                glyphRatio: ratioFor(data.tagline, taglineFont, taglineFont ? undefined : 0.72),
              })}cqw`,
            }}
          >
            {data.tagline}
          </p>
        </div>
      )}

      {/* The owner is no longer a standalone block — it is row one of the
          contact list below, so it shares that column's alignment. */}

      {/* ── ornamental rule: line · diamond · line ──────────────────────── */}
      {z.divider && (
        <div style={zoneStyle(z.divider)} className="flex items-center gap-[1.2cqw]">
          <span className="flex-1" style={{ height: '0.16cqw', background: t.ink.accent, opacity: 0.62 }} />
          {/* A rotated square, not a bullet: a • renders at a different optical
              size in every typeface, so the ornament would drift. */}
          <span
            className="flex-none rotate-45"
            style={{ width: '0.9cqw', height: '0.9cqw', background: t.ink.accent, opacity: 0.85 }}
          />
          <span className="flex-1" style={{ height: '0.16cqw', background: t.ink.accent, opacity: 0.62 }} />
        </div>
      )}

      {/* ── closing rule beneath the name ───────────────────────────────── */}
      {z.dividerBottom && (
        <div
          style={{ ...zoneStyle(z.dividerBottom), height: '0.16cqw', background: t.ink.accent, opacity: 0.62 }}
        />
      )}

      {/* ── contact rows ────────────────────────────────────────────────── */}
      {z.contact && contactRows.length > 0 && (
        /* Two layouts. With `rowPitch` the rows are pinned to the artwork's own
           printed icons — `y` is the first icon's CENTRE and each row is placed
           on its centre line. Without it, the card owns the spacing and stacks
           the rows itself. */
        <div
          style={z.contact.rowPitch ? { ...zoneStyle(z.contact), top: `${z.contact.y}%` } : zoneStyle(z.contact)}
          className={cn(!z.contact.rowPitch && 'flex flex-col gap-[2.2cqw]')}
        >
          {contactRows.map((row, i) => {
            const Icon = row.icon
            const ic = t.contactIcons
            const pitch = z.contact?.rowPitch
            return (
              <div
                key={i}
                className="flex items-center gap-[2cqw] min-w-0"
                style={
                  pitch
                    ? {
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: `${i * pitch}cqw`,
                        // The row's own centre onto the icon's centre line.
                        transform: 'translateY(-50%)',
                      }
                    : undefined
                }
              >
                {ic && (
                  <span
                    className={cn('grid place-items-center flex-none', ic.style === 'circle' && 'rounded-full')}
                    style={{
                      width: '4.4cqw',
                      height: '4.4cqw',
                      background: ic.style === 'circle' ? ic.background : 'transparent',
                      color: ic.color,
                    }}
                  >
                    <Icon style={{ width: '2.7cqw', height: '2.7cqw' }} strokeWidth={2} />
                  </span>
                )}
                {/* The hairline between icon and text, as in both references.
                    It is what stops the rows reading as a bulleted list. */}
                {t.contactIcons?.divider && (
                  <span
                    className="flex-none"
                    style={{ width: '0.2cqw', height: '4.4cqw', background: t.ink.contact ?? t.ink.secondary, opacity: 0.35 }}
                  />
                )}
                <span className="min-w-0">
                  <span
                    className="block truncate"
                    style={{
                      color: t.ink.contact ?? t.ink.secondary,
                      ...textFontStyle(contactFont),
                      // The owner (row one) carries more weight than the
                      // contact lines — it is who the card is for. A chosen
                      // face keeps its own weight; a script has no bold, and
                      // asking for one gets a smeared synthetic version.
                      fontSize: `${i === 0 ? ownerCqw : contactCqw}cqw`,
                      fontWeight: contactFont ? contactFont.fontWeight : i === 0 ? 600 : 400,
                      lineHeight: 1.35,
                    }}
                  >
                    {row.value}
                  </span>
                  {row.sub && (
                    <span
                      className="block uppercase truncate"
                      style={{
                        color: t.ink.label,
                        fontSize: `${designationCqw}cqw`,
                        letterSpacing: '.16em',
                        lineHeight: 1.4,
                      }}
                    >
                      {row.sub}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── GSTIN — tabular so the digits line up ───────────────────────── */}
      {z.gstin && data.gstin && (
        <div style={zoneStyle(z.gstin)}>
          <p
            className="truncate"
            style={{
              color: z.gstin.color ?? t.ink.label,
              // Fitted, not fixed: a 15-character GSTIN plus the label is 21
              // characters, which did not fit 2.7cqw in every zone.
              fontSize: `${fitTextCqw(`GSTIN ${data.gstin}`, {
                zoneWidthPercent: z.gstin.w,
                maxCqw: 2.7,
                minCqw: 1.9,
                glyphRatio: 0.58,
              })}cqw`,
              letterSpacing: '.06em',
              // Tabular figures so the digits line up — a GSTIN is read digit
              // by digit when someone is checking it against a bill.
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            GSTIN {data.gstin}
          </p>
        </div>
      )}

      {/* ── QR ──────────────────────────────────────────────────────────── */}
      {z.qr && qrValue && (
        <div style={{ ...zoneStyle(z.qr), width: `${z.qr.size}%` }}>
          <div className="w-full bg-white rounded p-[4%]" style={{ aspectRatio: '1' }}>
            {/* `data-card-qr` is how the PNG exporter finds this SVG to
                serialise it. Re-encoding the QR in the exporter would mean a
                second implementation that can disagree with this one about
                error-correction level or quiet zone. */}
            <QRCodeSVG
              data-card-qr=""
              value={qrValue}
              level="M"
              bgColor="#FFFFFF"
              fgColor="#111111"
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
