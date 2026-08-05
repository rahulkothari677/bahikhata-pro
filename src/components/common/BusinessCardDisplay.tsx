'use client'

/**
 * The business card screen: the card itself, the design gallery, the details
 * editor, and the share/download actions.
 *
 * 🐛 2026-08-04 — four faults Rahul reported, and what each turned out to be:
 *
 *   "it's being shared as text format" — Share only ever sent `shareText`, a
 *     plain-text summary. Download called `await import('html2canvas')` against
 *     a package that was not in package.json, so it threw on every click and
 *     landed in a toast blaming the browser. Neither had ever made an image.
 *     Both now render a real image; see lib/card-canvas.
 *
 *   "it's not taking the correct email from the profile" — the card was given
 *     `session.user.email`, the address you SIGN IN with, while Settings has
 *     had its own editable Email field all along. Resolution now lives in
 *     lib/card-details so no caller can answer that question differently.
 *
 *   "whenever i choose a new card ... it restart the app" — `handleDesignSelect`
 *     ended in `window.location.reload()`. In the Capacitor build a full reload
 *     IS a restart: splash screen, re-auth, back to the dashboard. It was there
 *     to make the new design show, which react-query does properly.
 *
 *   "i want a proper section ... where the user can fill or edit all the things"
 *     — CardDetailsEditor, below the card.
 */

import { useEffect, useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Share2, Download, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast as sonnerToast } from 'sonner'
import { getCardDesign, BUSINESS_CARD_DESIGNS } from '@/lib/business-card-designs'
import { BusinessCardSurface, type CardData } from '@/components/common/BusinessCardSurface'
import { TemplateCard } from '@/components/common/TemplateCard'
import { CardDetailsEditor } from '@/components/common/CardDetailsEditor'
import { CARD_TEMPLATES, getTemplate } from '@/lib/card-templates'
import { resolveCardData, type CardSettingLike } from '@/lib/card-details'
import { renderTemplateCardImage, renderNodeImage, cardFileName } from '@/lib/card-canvas'
import { shareCardImage, saveCardImage, isShareCancelled } from '@/lib/share-file'
import { offlineFetch } from '@/lib/offline-fetch'
import { cn } from '@/lib/utils'

/** Trade names for the picker's groups — the registry's ids are code, not copy. */
const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  grocery: 'Grocery & kirana',
  pharmacy: 'Pharmacy',
  gifts: 'Gifts & boutiques',
  textile: 'Textile',
  hardware: 'Hardware & trade',
  food: 'Food & catering',
  services: 'Services & professional',
  festive: 'Festive',
  patriotic: 'Patriotic',
}

interface BusinessCardDisplayProps {
  setting: CardSettingLike & {
    upiId?: string | null
    cardDesign?: string | null
    cardSlug?: string | null
  }
  /** The sign-in address. Last resort only — Setting.email wins. */
  email?: string | null
  onDesignChange?: (designId: string) => void
  /**
   * Opens the shop-logo uploader. Passed in rather than owned here so the card
   * stays presentational — and so the SAME uploader is reachable from the card,
   * from Settings, and from the Account screen without three copies of it.
   */
  onLogoClick?: () => void
}

export function BusinessCardDisplay({ setting, email, onDesignChange, onLogoClick }: BusinessCardDisplayProps) {
  // Setting.cardDesign holds EITHER an artwork-template id or a vector-design
  // id — one field, two galleries. Resolving the template first means a
  // template always wins, and an unknown id still falls back to a real design
  // rather than rendering nothing.
  const template = getTemplate(setting.cardDesign)
  const design = getCardDesign(setting.cardDesign)

  const queryClient = useQueryClient()
  const [showPicker, setShowPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * Unsaved edits from the details editor, rendered OVER the saved settings.
   *
   * A preview, never an autosave: the shopkeeper can try six typefaces and
   * leave without having changed their card. Save is still what stores it.
   */
  const [preview, setPreview] = useState<Partial<CardSettingLike> | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  /** The chosen thumbnail, so opening the strip scrolls it into view. */
  const selectedThumbRef = useRef<HTMLButtonElement>(null)

  // ONE resolution, used by the hero card, every picker thumbnail and the
  // exported image — a preview can never disagree with the card it is previewing, and
  // the downloaded file can never disagree with either.
  const effective = preview ? { ...setting, ...preview } : setting
  const templateData = resolveCardData(effective, email)

  const cardData: CardData = {
    shopName: templateData.shopName,
    ownerName: templateData.ownerName,
    phone: templateData.phone,
    email: templateData.email,
    gstin: templateData.gstin,
    address: templateData.address,
    logoUrl: templateData.logoUrl,
  }

  // vCard 3.0 for the QR — more universally supported than MECARD.
  const escapeVcard = (val: string) => val.replace(/([;,:\\])/g, '\\$1')
  const vcardLines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']
  if (templateData.ownerName) vcardLines.push(`FN:${escapeVcard(templateData.ownerName)}`)
  if (templateData.shopName) vcardLines.push(`ORG:${escapeVcard(templateData.shopName)}`)
  if (templateData.phone) vcardLines.push(`TEL;TYPE=CELL:${escapeVcard(templateData.phone)}`)
  if (templateData.email) vcardLines.push(`EMAIL:${escapeVcard(templateData.email)}`)
  if (templateData.address) vcardLines.push(`ADR;TYPE=WORK:;;${escapeVcard(templateData.address)};;;India`)
  if (templateData.gstin) vcardLines.push(`NOTE:GSTIN ${escapeVcard(templateData.gstin)}`)
  if (setting.upiId) vcardLines.push(`X-UPI:${escapeVcard(setting.upiId)}`)
  vcardLines.push('END:VCARD')
  const vcard = vcardLines.join('\n')

  // No share caption. The details used to ride along as text beside the file,
  // on the theory that a recipient whose app stripped the image still got the
  // phone number. In practice WhatsApp shows BOTH, so every card arrived with a
  // seven-line paragraph repeating what the picture already said. The card is
  // the message; if it does not arrive, the fix is to make it arrive.

  /**
   * The card as an image, returned as a data URL — see lib/card-canvas for why
   * that rather than a Blob.
   *
   * Artwork templates are DRAWN from their zone spec, at 1500px — 428dpi at
   * card size, regardless of the phone's screen. The legacy vector designs have
   * no such spec (they are CSS all the way down) so they are screenshotted
   * instead. Both paths return the same thing, so the callers do not care.
   */
  const buildImage = async (): Promise<string> => {
    if (template) {
      const qrSvg = cardRef.current?.querySelector<SVGElement>('svg[data-card-qr]') ?? null
      return await renderTemplateCardImage(template, templateData, { qrSvg })
    }
    if (!cardRef.current) throw new Error('The card is not ready yet. Please try again.')
    return await renderNodeImage(cardRef.current)
  }

  /**
   * Share and Save both go through the SYSTEM share sheet on Android — that is
   * what "all share option of my mobile" means, and it is the only route a
   * WebView has to WhatsApp, Gmail, Drive or the gallery with a file attached.
   *
   * There is deliberately no wa.me fallback any more. `wa.me/?text=` can only
   * carry text, so falling back to it turned "share my card" into "send a
   * paragraph" — the original complaint. If the image cannot be produced, the
   * shopkeeper is told so rather than quietly sent something else.
   */
  const runExport = async (mode: 'share' | 'save') => {
    setBusy(true)
    try {
      const image = await buildImage()
      const name = cardFileName(templateData.shopName)
      const where =
        mode === 'share'
          ? await shareCardImage(image, name, {
              // 🐛 2026-08-05: NO `text`. Rahul: "only cards should be shared
              // and no text should be shared with card." A caption alongside
              // the file meant WhatsApp sent the picture AND a seven-line
              // paragraph repeating what the picture already says. The card is
              // the message.
              title: templateData.shopName || 'My Shop',
              dialogTitle: 'Share your card',
            })
          : await saveCardImage(image, name, templateData.shopName || 'My Shop')

      if (where === 'downloaded') sonnerToast.success('Card saved as an image')
    } catch (err) {
      if (isShareCancelled(err)) return
      sonnerToast.error(err instanceof Error ? err.message : 'Could not create the card image')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Tapping the mark on the card scrolls to where it is changed.
   *
   * Before this the mark was inert on the card and the uploader lived in
   * Settings → Profile — so the one place a shopkeeper is actually looking at
   * their logo was the one place they could not do anything about it.
   */
  // Opening the strip on a card halfway along it should not start at the
  // beginning — the shopkeeper wants to see what they have now, and what is
  // next to it.
  useEffect(() => {
    if (!showPicker) return
    selectedThumbRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [showPicker])

  const scrollToMark = () => {
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleDesignSelect = async (designId: string) => {
    if (onDesignChange) {
      onDesignChange(designId)
      return
    }
    try {
      await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardDesign: designId }),
        offline: { invalidate: ['/api/settings'] },
      })
      const name =
        CARD_TEMPLATES.find(t => t.id === designId)?.name ??
        BUSINESS_CARD_DESIGNS.find(d => d.id === designId)?.name ??
        'your new design'
      sonnerToast.success(`Design changed to ${name}`)
      // 🐛 Was `window.location.reload()`. In the Capacitor build that is a full
      // app restart — splash screen, re-auth, back to the dashboard — for what
      // is a one-field change. Invalidating the query refetches the setting and
      // re-renders just this card.
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch {
      sonnerToast.error('Could not save design choice')
    }
  }

  return (
    <div className="space-y-4">
      {/* ═══ Design picker ═══
          🎨 2026-08-05. Rahul: "card should be not visible in the whole area.
          make it scrollable so user can scroll it and pick the one and also add
          the a dropbox from where it can directly click through name."

          It used to open TWO full grids — twenty cards stacked down the page,
          which pushed the card itself off screen and made choosing a design a
          scrolling exercise. Now: a name dropdown for going straight to one you
          know, and a single swipeable row for browsing. Both drive the same
          selection, so neither is a second-class path. */}
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <label className="flex-1 min-w-0">
            <span className="block text-3xs uppercase tracking-wider text-muted-foreground mb-1">
              Card design
            </span>
            <select
              value={template?.id ?? design.id}
              onChange={e => handleDesignSelect(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background px-2 text-sm"
              aria-label="Choose a card design by name"
            >
              {/* Grouped by trade. With twenty designs a flat list is a wall of
                  names; a shopkeeper looking for something for a sweet shop
                  should not have to read all twenty. */}
              {CARD_TEMPLATES.length > 0 &&
                Object.entries(
                  CARD_TEMPLATES.reduce<Record<string, typeof CARD_TEMPLATES>>((acc, t) => {
                    ;(acc[t.category] ||= []).push(t)
                    return acc
                  }, {}),
                ).map(([category, list]) => (
                  <optgroup key={category} label={CATEGORY_LABELS[category] ?? category}>
                    {list.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              <optgroup label="Simple colours">
                {BUSINESS_CARD_DESIGNS.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPicker(!showPicker)}
            className="gap-1.5 h-9 flex-none"
            aria-expanded={showPicker}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            {showPicker ? 'Hide' : 'Browse'}
          </Button>
        </div>
        <p className="text-2xs text-muted-foreground">{template?.description ?? design.description}</p>
      </div>

      {showPicker && (
        <div className="space-y-3">
          {CARD_TEMPLATES.length > 0 && (
            <div>
              <p className="text-3xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Designer templates
              </p>
              {/* A single swipeable row, not a grid. `snap-x` so a card always
                  comes to rest square in the viewport rather than half cut off,
                  which is what makes a strip feel deliberate on a phone. */}
              <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scrollbar-thin">
                {CARD_TEMPLATES.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => handleDesignSelect(tpl.id)}
                    ref={tpl.id === template?.id ? selectedThumbRef : undefined}
                    className={cn(
                      'relative flex-none w-[44%] min-w-[150px] snap-start rounded-xl transition text-left',
                      tpl.id === template?.id
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        : 'opacity-90 hover:opacity-100',
                    )}
                    title={tpl.name}
                    aria-pressed={tpl.id === template?.id}
                  >
                    <TemplateCard template={tpl} data={templateData} />
                    <p className="text-3xs mt-1 text-center truncate text-muted-foreground">{tpl.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-3xs uppercase tracking-wider text-muted-foreground mb-1.5">Simple colours</p>
            <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
              {BUSINESS_CARD_DESIGNS.map(d => (
                <button
                  key={d.id}
                  onClick={() => handleDesignSelect(d.id)}
                  ref={!template && d.id === design.id ? selectedThumbRef : undefined}
                  className={cn(
                    'relative flex-none w-[32%] min-w-[110px] snap-start rounded-xl transition text-left',
                    !template && d.id === design.id
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'opacity-90 hover:opacity-100',
                  )}
                  title={d.name}
                  aria-pressed={!template && d.id === design.id}
                >
                  <BusinessCardSurface design={d} data={cardData} qrValue={vcard} thumbnail />
                  <p className="text-3xs mt-1 text-center truncate text-muted-foreground">{d.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ The card ═══ */}
      <div className="shadow-card rounded-2xl overflow-hidden" ref={cardRef}>
        {template ? (
          <TemplateCard template={template} data={templateData} qrValue={vcard} onLogoClick={onLogoClick ?? scrollToMark} />
        ) : (
          <BusinessCardSurface
            design={design}
            data={cardData}
            qrValue={vcard}
            onLogoClick={onLogoClick ?? scrollToMark}
          />
        )}
      </div>

      {/* ═══ Share buttons ═══
          Two, not three. The old WhatsApp button could only ever send a text
          link, and on the phone that is precisely what it did. WhatsApp is one
          tap inside the share sheet, with the picture attached. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => runExport('share')}
          disabled={busy}
          className="py-2.5 rounded-lg bg-gradient-saffron text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <Share2 className="w-4 h-4" />
          {busy ? 'Preparing…' : 'Share card'}
        </button>
        <button
          onClick={() => runExport('save')}
          disabled={busy}
          className="py-2.5 rounded-lg border border-blue-300 text-blue-700 dark:text-blue-400 dark:border-blue-800 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-blue-50 dark:hover:bg-blue-950 transition disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          {busy ? 'Preparing…' : 'Save image'}
        </button>
      </div>

      {/* ═══ Details editor ═══ */}
      <div ref={editorRef}>
      <CardDetailsEditor
        setting={setting}
        sessionEmail={email}
        onPreview={setPreview}
        // The saved values must show on the card immediately — Rahul's fifth
        // point. Refetching the setting re-renders the card above from the
        // server's copy, so what he sees is what is actually stored.
        onSaved={() => {
          // Drop the preview so the card goes back to rendering the SERVER's
          // copy. Keeping it would hide a save that silently failed to store
          // something — the card would look right while the data was not.
          setPreview(null)
          queryClient.invalidateQueries({ queryKey: ['setting'] })
        }}
      />
      </div>

      {/* ═══ Tip ═══ */}
      <div className="rounded-lg bg-muted/50 border border-border/60 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">💡 How to use:</p>
        <p>Tap <span className="font-medium">Share card</span> and pick WhatsApp — your customer gets the card as a picture they can save. They can scan the QR code to store your shop&apos;s contact in their phone.</p>
      </div>
    </div>
  )
}
