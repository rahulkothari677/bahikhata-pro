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

import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Phone, Mail, MapPin, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { deriveMonogram } from '@/lib/brand-monogram'
import { getMonogramFont, monogramStyle } from '@/lib/monogram-fonts'
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
  /** Which typeface the monogram uses. See lib/monogram-fonts. */
  monogramFontId?: string | null
}

interface Props {
  template: CardTemplate
  data: TemplateCardData
  qrValue?: string
  onLogoClick?: () => void
  className?: string
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

  // The icon, its divider and two gaps consume roughly 9cqw before any text.
  // Sizing against the full zone is what let the email overflow its slot.
  const CONTACT_CHROME_CQW = 9

  // Fitted sizes. A shop is called "RK" or "Shree Siddhivinayak General Stores"
  // and both land in the same slot, so a fixed size truncates one of them.
  const shopFit = {
    zoneWidthPercent: z.shopName.w,
    maxCqw: 6.4,
    // Below this the name is illegible at card size, so shrinking further is
    // not a fix. Names that still do not fit WRAP instead — see below.
    minCqw: 3.2,
    glyphRatio: SHOP_NAME_GLYPH_RATIO,
  }
  const shopNameCqw = fitTextCqw(data.shopName || 'My Shop', shopFit)

  // "Shree Siddhivinayak General Stores" is 34 characters and cannot fit one
  // line at a legible size. Two lines beat an ellipsis: a wrapped name is still
  // the shop's name, whereas "Shree Siddhivinayak Gen…" is not.
  const shopNameWraps = willTruncate(data.shopName, shopFit)
  const contactTextWidth = Math.max(8, (z.contact?.w ?? 40) - CONTACT_CHROME_CQW)

  const ownerCqw = fitTextCqw(data.ownerName, {
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
    // ~6pt. Below this it stops being readable at arm's length, which is the
    // only distance a business card is ever read at.
    minCqw: 2.1,
    glyphRatio: 0.52,
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
                <img
              src={data.logoUrl}
              alt={`${data.shopName || 'Shop'} logo`}
              className={cn(
                'w-full object-contain bg-white/95 shadow-sm',
                z.logo.shape === 'circle' ? 'rounded-full' : z.logo.shape === 'rounded' ? 'rounded-lg' : '',
              )}
              style={{ aspectRatio: '1' }}
            />
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
                'w-full grid place-items-center leading-none',
                onLogoClick && 'transition hover:opacity-80 cursor-pointer',
              )}
              style={monogramStyle(
                monoFont,
                z.logo.color ?? t.ink.primary,
                // 0.55 was too small to read the typeface; 0.86 overpowered the
                // shop name. 0.69 is 0.86 less the 20% Rahul asked for, and
                // lands close to his reference proportion.
                z.logo.size * 0.69,
              )}
            >
              {monogram}
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
          className={cn('font-bold leading-[1.08]', shopNameWraps ? 'line-clamp-2' : 'truncate')}
          style={{ color: t.ink.primary, fontSize: `${shopNameCqw}cqw`, letterSpacing: '-.02em' }}
        >
          {data.shopName || 'My Shop'}
        </p>
      </div>

      {z.tagline && data.tagline && (
        <div style={zoneStyle(z.tagline)}>
          <p
            className="font-semibold uppercase truncate"
            style={{ color: t.ink.accent, fontSize: '2.9cqw', letterSpacing: '.1em' }}
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
        <div style={zoneStyle(z.contact)} className="flex flex-col gap-[2.2cqw]">
          {contactRows.map((row, i) => {
            const Icon = row.icon
            const ic = t.contactIcons
            return (
              <div key={i} className="flex items-center gap-[2cqw] min-w-0">
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
                      // The owner's name is the one line that earns extra
                      // weight — it is who the card is FOR.
                      // The owner (row one) carries more weight than the
                      // contact lines — it is who the card is for.
                      fontSize: `${i === 0 ? ownerCqw : contactCqw}cqw`,
                      fontWeight: i === 0 ? 600 : 400,
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
              color: t.ink.label,
              fontSize: '2.7cqw',
              letterSpacing: '.06em',
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
            <QRCodeSVG
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
