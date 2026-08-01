'use client'

/**
 * BusinessCardSurface — renders the visiting card itself, for all 10 layouts.
 *
 * 🎨 NEW 2026-07-29. Split out of BusinessCardDisplay, which had the card markup
 * inlined with two `layout ===` branches. Ten distinct structures cannot live
 * inside a component that also owns sharing, downloading and vCard building —
 * they were fighting for the same file, which is part of why the old designs
 * never got past "same layout, different colour".
 *
 * This component renders ONLY the card. It holds no state and performs no I/O,
 * so it can be reused for the picker thumbnails, the Account screen hero, the
 * PNG export target and the public card page without any of them diverging.
 *
 * TYPOGRAPHY IS THE POINT. The premium feel comes almost entirely from the gap
 * between a large, tightly-tracked name and tiny, widely-tracked, low-contrast
 * labels. If a design ever looks flat, that gap has usually been narrowed.
 */

import { QRCodeSVG } from 'qrcode.react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { textureStyle, type BusinessCardDesign } from '@/lib/business-card-designs'

export interface CardData {
  shopName?: string | null
  ownerName?: string | null
  phone?: string | null
  email?: string | null
  gstin?: string | null
  address?: string | null
  logoUrl?: string | null
}

interface Props {
  design: BusinessCardDesign
  data: CardData
  /** Encoded into the QR — a vCard string or a URL. */
  qrValue: string
  /**
   * When provided, the logo slot becomes a tappable "add logo" affordance.
   * This is the whole reason the uploader is reachable at all: it used to sit
   * at line 628 of Settings.tsx, three taps deep, where nobody found it.
   */
  onLogoClick?: () => void
  /** Compact mode for picker thumbnails — hides detail lines and the QR. */
  thumbnail?: boolean
  className?: string
}

/* ── type helpers, driven entirely by the design spec ─────────────────────── */

const nameSizeClass = (s: BusinessCardDesign['nameSize'], thumb: boolean) =>
  thumb
    ? 'text-3xs'
    : s === '2xl'
      ? 'text-2xl'
      : s === 'xl'
        ? 'text-xl'
        : 'text-lg'

const trackingClass = (t: BusinessCardDesign['nameTracking']) =>
  t === 'tight' ? 'tracking-tight' : t === 'wide' ? 'tracking-[0.12em]' : 'tracking-normal'

const familyClass = (f: BusinessCardDesign['fontFamily']) =>
  f === 'serif' ? 'font-serif' : f === 'mono' ? 'font-mono' : 'font-sans'

/** The uppercase micro-label. Wide tracking + low contrast is the premium tell. */
function Label({ design, children }: { design: BusinessCardDesign; children: React.ReactNode }) {
  if (!design.showLabels) return null
  return (
    <p
      className="text-3xs uppercase tracking-[0.18em] font-medium leading-none"
      style={{ color: design.labelTextColor }}
    >
      {children}
    </p>
  )
}

/** A hairline. 1px at low opacity reads as engraving; a solid border does not. */
function Rule({ design, className }: { design: BusinessCardDesign; className?: string }) {
  return <div className={cn('h-px w-full', className)} style={{ background: design.ruleColor }} />
}

function Logo({
  design,
  data,
  size,
  onLogoClick,
  round,
}: {
  design: BusinessCardDesign
  data: CardData
  size: number
  onLogoClick?: () => void
  round?: boolean
}) {
  const shape = round ? 'rounded-full' : 'rounded-md'

  if (data.logoUrl) {
    return (
      <img
        src={data.logoUrl}
        alt={`${data.shopName || 'Shop'} logo`}
        className={cn(shape, 'object-cover bg-white/90 shadow-sm')}
        style={{ width: size, height: size }}
      />
    )
  }

  // No logo. Only show a placeholder where the user can act on it — an empty
  // dashed box on a shared or exported card would look broken.
  if (!onLogoClick) return null

  return (
    <button
      type="button"
      onClick={onLogoClick}
      aria-label="Add your shop logo"
      className={cn(
        shape,
        'flex flex-col items-center justify-center gap-0.5 border border-dashed transition',
        'hover:scale-105 active:scale-95',
      )}
      style={{
        width: size,
        height: size,
        borderColor: design.ruleColor,
        color: design.labelTextColor,
      }}
    >
      <Plus className="w-3 h-3" />
      {size >= 56 && <span className="text-3xs uppercase tracking-wider">Logo</span>}
    </button>
  )
}

function QR({ design, value, size }: { design: BusinessCardDesign; value: string; size: number }) {
  const code = (
    <QRCodeSVG value={value} size={size} bgColor={design.qrBgColor} fgColor={design.qrFgColor} level="M" />
  )
  if (design.qrStyle === 'framed') {
    return (
      <div className="p-1.5 rounded-md" style={{ background: design.qrBgColor, border: `1px solid ${design.ruleColor}` }}>
        {code}
      </div>
    )
  }
  if (design.qrStyle === 'tinted') {
    return <div className="p-1.5 rounded-md" style={{ background: design.accentColor }}>{code}</div>
  }
  return <div className="p-1.5 rounded-md" style={{ background: design.qrBgColor }}>{code}</div>
}

/** Name + owner, used by most layouts. */
function Identity({
  design,
  data,
  thumbnail,
  align = 'left',
}: {
  design: BusinessCardDesign
  data: CardData
  thumbnail: boolean
  align?: 'left' | 'center'
}) {
  return (
    <div className={align === 'center' ? 'text-center' : ''}>
      <h3
        className={cn('font-semibold leading-tight truncate', nameSizeClass(design.nameSize, thumbnail), trackingClass(design.nameTracking), familyClass(design.fontFamily))}
        style={{ color: design.primaryTextColor }}
      >
        {data.shopName || 'My Shop'}
      </h3>
      {data.ownerName && !thumbnail && (
        <div className={cn('mt-1.5', align === 'center' && 'flex flex-col items-center')}>
          <Label design={design}>Proprietor</Label>
          <p className="text-xs mt-0.5" style={{ color: design.secondaryTextColor }}>
            {data.ownerName}
          </p>
        </div>
      )}
    </div>
  )
}

/** Contact lines. Plain text, no icons — icons at this size read as clutter. */
function Details({
  design,
  data,
  thumbnail,
  align = 'left',
}: {
  design: BusinessCardDesign
  data: CardData
  thumbnail: boolean
  align?: 'left' | 'center'
}) {
  if (thumbnail) return null
  const rows = [data.phone, data.email, data.gstin ? `GSTIN ${data.gstin}` : null].filter(Boolean)
  if (rows.length === 0) return null
  return (
    <div className={cn('space-y-0.5', align === 'center' && 'text-center')}>
      {rows.map((r, i) => (
        <p key={i} className="text-3xs leading-relaxed truncate" style={{ color: design.secondaryTextColor }}>
          {r}
        </p>
      ))}
    </div>
  )
}

/* ── the card ─────────────────────────────────────────────────────────────── */

export function BusinessCardSurface({
  design,
  data,
  qrValue,
  onLogoClick,
  thumbnail = false,
  className,
}: Props) {
  const t = thumbnail
  const qrSize = t ? 0 : 60
  const pad = t ? 'p-2.5' : 'p-5'

  // Portrait is the one layout with a different aspect ratio — that is the
  // point of it, so it must not be forced into the shared 1.75:1 frame.
  const aspect = design.layout === 'portrait' ? 'aspect-[3/4]' : 'aspect-[1.75/1]'

  const body = (() => {
    switch (design.layout) {
      /* Name left, QR right. The traditional arrangement. */
      case 'classic':
        return (
          <div className={cn('relative h-full flex flex-col justify-between', pad)}>
            <div className="flex items-start justify-between gap-3">
              <Logo design={design} data={data} size={t ? 18 : 34} onLogoClick={onLogoClick} />
              {!t && <QR design={design} value={qrValue} size={qrSize} />}
            </div>
            <div>
              <Rule design={design} className={t ? 'mb-1.5' : 'mb-2.5'} />
              <Identity design={design} data={data} thumbnail={t} />
              <div className="mt-2"><Details design={design} data={data} thumbnail={t} /></div>
            </div>
          </div>
        )

      /* Solid spine down the left third. Logo lives in the spine. */
      case 'left-bar':
        return (
          <div className="relative h-full flex">
            <div
              className="w-[30%] flex flex-col items-center justify-center gap-2 flex-shrink-0"
              style={{ background: design.accentSurface }}
            >
              <Logo design={design} data={data} size={t ? 16 : 38} onLogoClick={onLogoClick} round />
            </div>
            <div className={cn('flex-1 min-w-0 flex flex-col justify-between', pad)}>
              <Identity design={design} data={data} thumbnail={t} />
              {!t && (
                <div className="flex items-end justify-between gap-2">
                  <Details design={design} data={data} thumbnail={t} />
                  <QR design={design} value={qrValue} size={48} />
                </div>
              )}
            </div>
          </div>
        )

      /* Two tones on a diagonal. The cut is the decoration. */
      case 'diagonal':
        return (
          <div className={cn('relative h-full flex flex-col justify-between', pad)}>
            <div
              className="absolute inset-0"
              style={{ background: design.accentSurface, clipPath: 'polygon(0 0, 100% 0, 100% 42%, 0 68%)' }}
            />
            <div className="relative flex items-start justify-between gap-3">
              <Logo design={design} data={data} size={t ? 18 : 34} onLogoClick={onLogoClick} />
              {!t && <QR design={design} value={qrValue} size={qrSize} />}
            </div>
            <div className="relative">
              <Identity design={design} data={data} thumbnail={t} />
              <div className="mt-2"><Details design={design} data={data} thumbnail={t} /></div>
            </div>
          </div>
        )

      /* Logo is the hero: large, centred, ringed. Name beneath. */
      case 'emblem':
        return (
          <div className={cn('relative h-full flex flex-col items-center justify-center text-center', pad)}>
            <div
              className="rounded-full flex items-center justify-center mb-2"
              style={{ padding: t ? 2 : 5, border: `1px solid ${design.ruleColor}` }}
            >
              <Logo design={design} data={data} size={t ? 20 : 52} onLogoClick={onLogoClick} round />
            </div>
            <Identity design={design} data={data} thumbnail={t} align="center" />
            {!t && (
              <>
                <div className="w-10 my-2"><Rule design={design} /></div>
                <Details design={design} data={data} thumbnail={t} align="center" />
              </>
            )}
          </div>
        )

      /* Inset hairline frame, generous margin. The engraved look. */
      case 'framed':
        return (
          <div className={cn('relative h-full', t ? 'p-1.5' : 'p-3')}>
            <div
              className={cn('h-full flex flex-col items-center justify-center text-center', t ? 'p-1.5' : 'p-4')}
              style={{ border: `1px solid ${design.ruleColor}` }}
            >
              <Logo design={design} data={data} size={t ? 16 : 30} onLogoClick={onLogoClick} />
              <div className={t ? 'mt-1' : 'mt-2'}>
                <Identity design={design} data={data} thumbnail={t} align="center" />
              </div>
              {!t && (
                <>
                  <div className="w-12 my-2"><Rule design={design} /></div>
                  <Details design={design} data={data} thumbnail={t} align="center" />
                </>
              )}
            </div>
          </div>
        )

      /* Colour band across the top; details on the body below. */
      case 'top-band':
        return (
          <div className="relative h-full flex flex-col">
            <div
              className={cn('flex items-center gap-2.5', t ? 'h-[38%] px-2.5' : 'h-[40%] px-5')}
              style={{ background: design.accentSurface }}
            >
              <Logo design={design} data={data} size={t ? 16 : 32} onLogoClick={onLogoClick} />
              <h3
                className={cn('font-semibold truncate', nameSizeClass(design.nameSize, t), trackingClass(design.nameTracking), familyClass(design.fontFamily))}
                style={{ color: '#FFFFFF' }}
              >
                {data.shopName || 'My Shop'}
              </h3>
            </div>
            <div className={cn('flex-1 flex items-end justify-between gap-2', pad)}>
              <div>
                {data.ownerName && !t && (
                  <>
                    <Label design={design}>Proprietor</Label>
                    <p className="text-xs mt-0.5 mb-1.5" style={{ color: design.secondaryTextColor }}>{data.ownerName}</p>
                  </>
                )}
                <Details design={design} data={data} thumbnail={t} />
              </div>
              {!t && <QR design={design} value={qrValue} size={52} />}
            </div>
          </div>
        )

      /* Type only. One rule. Maximum whitespace. */
      case 'minimal':
        return (
          <div className={cn('relative h-full flex flex-col justify-center', t ? 'p-3' : 'p-7')}>
            <div className="flex items-center gap-2">
              <Logo design={design} data={data} size={t ? 14 : 24} onLogoClick={onLogoClick} />
              <Identity design={design} data={data} thumbnail={t} />
            </div>
            {!t && (
              <>
                <div className="w-8 my-3"><Rule design={design} /></div>
                <div className="flex items-end justify-between gap-3">
                  <Details design={design} data={data} thumbnail={t} />
                  <QR design={design} value={qrValue} size={44} />
                </div>
              </>
            )}
          </div>
        )

      /* Vertical card, centred stack. */
      case 'portrait':
        return (
          <div className={cn('relative h-full flex flex-col items-center justify-between text-center', t ? 'p-2.5' : 'p-5')}>
            <Logo design={design} data={data} size={t ? 18 : 40} onLogoClick={onLogoClick} round />
            <div className="w-full">
              <Identity design={design} data={data} thumbnail={t} align="center" />
              {!t && (
                <>
                  <div className="w-10 mx-auto my-2.5"><Rule design={design} /></div>
                  <Details design={design} data={data} thumbnail={t} align="center" />
                </>
              )}
            </div>
            {!t && <QR design={design} value={qrValue} size={56} />}
          </div>
        )

      /* One bold corner wedge; the rest deliberately quiet. */
      case 'corner':
        return (
          <div className={cn('relative h-full flex flex-col justify-between', pad)}>
            <div
              className="absolute top-0 left-0"
              style={{
                background: design.accentSurface,
                width: '46%',
                height: '46%',
                clipPath: 'polygon(0 0, 100% 0, 0 100%)',
              }}
            />
            <div className="relative flex items-start justify-end">
              <Logo design={design} data={data} size={t ? 18 : 34} onLogoClick={onLogoClick} />
            </div>
            <div className="relative">
              <Identity design={design} data={data} thumbnail={t} />
              {!t && (
                <div className="mt-2 flex items-end justify-between gap-3">
                  <Details design={design} data={data} thumbnail={t} />
                  <QR design={design} value={qrValue} size={48} />
                </div>
              )}
            </div>
          </div>
        )

      /* Pattern fills the card; text sits on a scrim so it stays legible. */
      case 'full-bleed':
      default:
        return (
          <div className={cn('relative h-full flex flex-col justify-end', pad)}>
            <div className="absolute inset-0" style={{ background: design.accentSurface ?? design.background }} />
            <div
              className="absolute inset-x-0 bottom-0 h-2/3"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))' }}
            />
            <div className="relative">
              <Logo design={design} data={data} size={t ? 16 : 28} onLogoClick={onLogoClick} />
              <div className="mt-2">
                <Identity design={design} data={data} thumbnail={t} />
              </div>
              {!t && <div className="mt-1.5"><Details design={design} data={data} thumbnail={t} /></div>}
            </div>
          </div>
        )
    }
  })()

  return (
    <div
      className={cn('relative overflow-hidden w-full', aspect, t ? 'rounded-lg' : 'rounded-2xl', className)}
      style={{ background: design.background }}
    >
      {/* Texture sits ABOVE the background and BELOW the content. On the content
          it would inherit the blend mode and turn the type muddy. */}
      <div className="absolute inset-0 pointer-events-none" style={textureStyle(design.texture, design.isDark)} />
      <div className="relative h-full">{body}</div>
    </div>
  )
}
