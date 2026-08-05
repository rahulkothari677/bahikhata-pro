'use client'

/**
 * DEV-ONLY card gallery — every template and design at full size.
 *
 * Design cannot be reviewed by reading TypeScript. This renders the real
 * components with real content so the artwork, the text zones and the monogram
 * can be judged together, which is the only way to tell whether the live text
 * actually lands where the artwork expects it.
 *
 * Not linked from anywhere and carries no data of its own.
 */

import { useEffect, useState } from 'react'
import { TemplateCard } from '@/components/common/TemplateCard'
import { BusinessCardDisplay } from '@/components/common/BusinessCardDisplay'
import { BusinessCardSurface } from '@/components/common/BusinessCardSurface'
import { CARD_TEMPLATES } from '@/lib/card-templates'
import { renderTemplateCardImage } from '@/lib/card-canvas'
import { BUSINESS_CARD_DESIGNS } from '@/lib/business-card-designs'
import { deriveMonogram } from '@/lib/brand-monogram'
import {
  MONOGRAM_FONTS,
  DEFAULT_MONOGRAM_FONT_ID,
  CARD_FONT_TARGETS,
  CARD_FONT_TARGET_LABELS,
  type CardFontTarget,
} from '@/lib/monogram-fonts'

const SAMPLE = {
  shopName: 'RAHUL KOTHARI',
  ownerName: 'Rahul Kothari',
  designation: 'Proprietor',
  tagline: 'Trust · Quality · Growth',
  phone: '+91 98765 43210',
  email: 'rjrahuljain980@gmail.com',
  address: 'Mumbai, Maharashtra - 400001',
  website: 'www.rahulkothari.in',
  gstin: '27ABCDE1234F1Z5',
  logoUrl: null as string | null,
}

const VCARD = 'BEGIN:VCARD\nVERSION:3.0\nFN:Rahul Kothari\nEND:VCARD'

/**
 * A stand-in shop logo, inline so the gallery needs no Cloudinary account and
 * no network. Deliberately NOT square — a real shop logo rarely is, and a
 * non-square mark is exactly what naive fitting gets wrong.
 */
const SAMPLE_LOGO =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180">
       <circle cx="70" cy="90" r="52" fill="#1F6F5C"/>
       <path d="M46 90 l18 18 l34 -40" stroke="#fff" stroke-width="12" fill="none"
             stroke-linecap="round" stroke-linejoin="round"/>
       <text x="140" y="82" font-family="Georgia, serif" font-size="42" fill="#1F6F5C">SHREE</text>
       <text x="140" y="128" font-family="Georgia, serif" font-size="30" fill="#8A6A34">TRADERS</text>
     </svg>`,
  )

export default function CardGalleryPage() {
  const [shop, setShop] = useState(SAMPLE.shopName)
  const [owner, setOwner] = useState(SAMPLE.ownerName)
  // A typeface can only be judged on the card it will be printed on — at picker
  // size every one of these looks fine. Per ELEMENT, because that is how the
  // shopkeeper sets them.
  const [target, setTarget] = useState<CardFontTarget>('logo')
  // The mark is either/or, so the gallery has to be able to show BOTH states.
  const [useLogo, setUseLogo] = useState(false)
  const [fonts, setFonts] = useState<Record<CardFontTarget, string | null>>({
    logo: DEFAULT_MONOGRAM_FONT_ID,
    shopName: null,
    tagline: null,
    contact: null,
  })
  const data = {
    ...SAMPLE,
    shopName: shop,
    ownerName: owner,
    monogramFontId: fonts.logo,
    shopFontId: fonts.shopName,
    taglineFontId: fonts.tagline,
    contactFontId: fonts.contact,
    logoUrl: useLogo ? SAMPLE_LOGO : null,
  }

  /*
   * Renders EVERY template through the real export path and returns the data
   * URLs, so a whole gallery can be reviewed as exported images rather than as
   * screenshots of the DOM. Reviewing the DOM would check the wrong renderer —
   * the exported file is what a shopkeeper actually sends.
   */
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__renderAllCards = async () =>
      Promise.all(
        CARD_TEMPLATES.map(async t => ({
          id: t.id,
          name: t.name,
          url: await renderTemplateCardImage(t, data, { width: 900 }),
        })),
      )
  }, [data])

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Card gallery</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {CARD_TEMPLATES.length} artwork templates · {BUSINESS_CARD_DESIGNS.length} built-in designs · dev preview
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            <label className="text-sm">
              <span className="block text-2xs text-muted-foreground mb-1">Shop name</span>
              <input value={shop} onChange={e => setShop(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-background" />
            </label>
            <label className="text-sm">
              <span className="block text-2xs text-muted-foreground mb-1">Owner</span>
              <input value={owner} onChange={e => setOwner(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-background" />
            </label>
            <div className="text-sm self-end pb-1">
              <span className="text-2xs text-muted-foreground">Monogram → </span>
              <span className="font-semibold">{deriveMonogram(shop, owner)}</span>
            </div>
            <label className="text-sm self-end pb-1 flex items-center gap-1.5">
              <input type="checkbox" data-testid="dev-logo" checked={useLogo}
                onChange={e => setUseLogo(e.target.checked)} />
              <span className="text-2xs text-muted-foreground">Shop logo</span>
            </label>
            <label className="text-sm">
              <span className="block text-2xs text-muted-foreground mb-1">Font applies to</span>
              <select
                data-testid="dev-target"
                value={target}
                onChange={e => setTarget(e.target.value as CardFontTarget)}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                {CARD_FONT_TARGETS.map(t => (
                  <option key={t} value={t}>{CARD_FONT_TARGET_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-2xs text-muted-foreground mb-1">Font</span>
              <select
                data-testid="dev-font"
                value={fonts[target] ?? ''}
                onChange={e => setFonts(f => ({ ...f, [target]: e.target.value || null }))}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                {/* Only the logo must have a face; the rest can stay on the
                    app's own type, which is what every existing card uses. */}
                {target !== 'logo' && <option value="">App default</option>}
                {MONOGRAM_FONTS.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {/* The REAL screen component, with a template selected. This is the
            path a shopkeeper actually hits — verifying TemplateCard alone would
            not prove that BusinessCardDisplay picks the template over the
            vector design. */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Live screen component (cardDesign = &quot;gold-fold&quot;)
          </h2>
          <div className="max-w-md" data-testid="live-card-screen">
            <BusinessCardDisplay
              setting={{
                shopName: data.shopName,
                ownerName: data.ownerName,
                phone: data.phone,
                address: data.address,
                gstin: data.gstin,
                // The shop's own address, as stored in Settings → Profile.
                email: data.email,
                cardDesign: 'gold-fold',
                cardFontId: fonts.logo,
                cardShopFontId: fonts.shopName,
                cardTaglineFontId: fonts.tagline,
                cardContactFontId: fonts.contact,
                cardMode: 'manual',
                logoUrl: useLogo ? SAMPLE_LOGO : null,
                cardMark: useLogo ? 'logo' : 'monogram',
                // Card-only fields, so the tagline and GSTIN zones added on
                // 2026-08-04 actually have something to render.
                cardTagline: data.tagline,
                cardGstin: data.gstin,
              }}
              // The SIGN-IN address. Deliberately different from the profile
              // one above: if this ever shows on the card, the bug Rahul
              // reported on 2026-08-04 is back.
              email="signin-account@example.com"
              onLogoClick={() => {}}
            />
          </div>
        </section>

        {CARD_TEMPLATES.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Artwork templates
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {CARD_TEMPLATES.map(t => (
                <div key={t.id}>
                  <TemplateCard template={t} data={data} qrValue={VCARD} onLogoClick={() => {}} />
                  <p className="text-sm font-medium mt-2">{t.name}</p>
                  <p className="text-2xs text-muted-foreground">{t.description}</p>
                  <p className="text-3xs text-muted-foreground/70 mt-0.5 font-mono">{t.image}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Built-in designs (no artwork needed)
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {BUSINESS_CARD_DESIGNS.map(d => (
              <div key={d.id}>
                <BusinessCardSurface design={d} data={data} qrValue={VCARD} onLogoClick={() => {}} />
                <p className="text-sm font-medium mt-2">{d.name}</p>
                <p className="text-2xs text-muted-foreground">{d.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
