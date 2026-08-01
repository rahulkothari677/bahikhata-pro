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
import { Phone, Mail, MapPin, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { deriveMonogram } from '@/lib/brand-monogram'
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

  // Paired with icons so a reader can find the phone number without reading.
  const contactRows = (
    [
      { icon: Phone, value: data.phone },
      { icon: Mail, value: data.email },
      { icon: MapPin, value: data.address },
      { icon: Globe, value: data.website },
    ] as const
  ).filter(r => Boolean(r.value)) as Array<{ icon: typeof Phone; value: string }>

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
      {z.logo && (
        <div style={{ ...zoneStyle(z.logo), width: `${z.logo.size}%` }}>
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
              style={{
                color: z.logo.color ?? t.ink.primary,
                fontFamily:
                  z.logo.font === 'script'
                    ? 'ui-serif, Georgia, "Brush Script MT", cursive'
                    : z.logo.font === 'sans'
                      ? 'inherit'
                      : 'ui-serif, Georgia, serif',
                fontStyle: z.logo.font === 'script' ? 'italic' : 'normal',
                fontWeight: 700,
                fontSize: `${z.logo.size * 0.9}cqw`,
                letterSpacing: z.logo.font === 'script' ? '0' : '.01em',
              }}
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
          className="font-bold leading-[1.08] truncate"
          style={{ color: t.ink.primary, fontSize: '7cqw', letterSpacing: '-.02em' }}
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

      {/* ── owner ───────────────────────────────────────────────────────── */}
      {z.ownerName && data.ownerName && (
        <div style={zoneStyle(z.ownerName)}>
          <p className="font-semibold truncate" style={{ color: t.ink.primary, fontSize: '3.9cqw' }}>
            {data.ownerName}
          </p>
          {data.designation && (
            <p
              className="uppercase truncate"
              style={{ color: t.ink.secondary, fontSize: '2.7cqw', letterSpacing: '.12em' }}
            >
              {data.designation}
            </p>
          )}
        </div>
      )}

      {/* ── divider hairline ────────────────────────────────────────────── */}
      {z.divider && (
        <div style={{ ...zoneStyle(z.divider), height: '0.2cqw', background: t.ink.accent, opacity: 0.55 }} />
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
                      width: '5.2cqw',
                      height: '5.2cqw',
                      background: ic.style === 'circle' ? ic.background : 'transparent',
                      color: ic.color,
                    }}
                  >
                    <Icon style={{ width: '3.2cqw', height: '3.2cqw' }} strokeWidth={2} />
                  </span>
                )}
                {/* The hairline between icon and text, as in both references.
                    It is what stops the rows reading as a bulleted list. */}
                {t.contactIcons?.divider && (
                  <span
                    className="flex-none"
                    style={{ width: '0.2cqw', height: '4.4cqw', background: t.ink.secondary, opacity: 0.35 }}
                  />
                )}
                <span
                  className="truncate"
                  style={{ color: t.ink.secondary, fontSize: '3cqw', lineHeight: 1.5 }}
                >
                  {row.value}
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
