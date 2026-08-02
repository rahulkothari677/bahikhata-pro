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

import { useState } from 'react'
import { TemplateCard } from '@/components/common/TemplateCard'
import { BusinessCardDisplay } from '@/components/common/BusinessCardDisplay'
import { BusinessCardSurface } from '@/components/common/BusinessCardSurface'
import { CARD_TEMPLATES } from '@/lib/card-templates'
import { BUSINESS_CARD_DESIGNS } from '@/lib/business-card-designs'
import { deriveMonogram } from '@/lib/brand-monogram'

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

export default function CardGalleryPage() {
  const [shop, setShop] = useState(SAMPLE.shopName)
  const [owner, setOwner] = useState(SAMPLE.ownerName)
  const data = { ...SAMPLE, shopName: shop, ownerName: owner }

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
                cardDesign: 'gold-fold',
              }}
              email={data.email}
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
