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
 *     Both now render a real PNG; see lib/card-canvas.
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

import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Share2, Send, Download, Image as ImageIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast as sonnerToast } from 'sonner'
import { getCardDesign, BUSINESS_CARD_DESIGNS } from '@/lib/business-card-designs'
import { BusinessCardSurface, type CardData } from '@/components/common/BusinessCardSurface'
import { TemplateCard } from '@/components/common/TemplateCard'
import { CardDetailsEditor } from '@/components/common/CardDetailsEditor'
import { CARD_TEMPLATES, getTemplate } from '@/lib/card-templates'
import { resolveCardData, type CardSettingLike } from '@/lib/card-details'
import { renderTemplateCardToBlob, renderNodeToBlob, cardFileName } from '@/lib/card-canvas'
import { offlineFetch } from '@/lib/offline-fetch'
import { cn } from '@/lib/utils'

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
  const cardRef = useRef<HTMLDivElement>(null)

  // ONE resolution, used by the hero card, every picker thumbnail and the PNG
  // export — a preview can never disagree with the card it is previewing, and
  // the downloaded file can never disagree with either.
  const templateData = resolveCardData(setting, email)

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

  // Caption for the share sheet. It accompanies the image now rather than
  // replacing it — WhatsApp shows both, and a recipient on a platform that
  // strips the file still gets the phone number.
  const shareText = [
    templateData.shopName || 'My Shop',
    templateData.ownerName ? `Proprietor: ${templateData.ownerName}` : '',
    templateData.phone ? `Phone: ${templateData.phone}` : '',
    templateData.email ? `Email: ${templateData.email}` : '',
    templateData.gstin ? `GSTIN: ${templateData.gstin}` : '',
    setting.upiId ? `Pay via UPI: ${setting.upiId}` : '',
    templateData.address ? `Address: ${templateData.address}` : '',
  ].filter(Boolean).join('\n')

  /**
   * The card as a PNG.
   *
   * Artwork templates are DRAWN from their zone spec, at 2100px — print
   * resolution regardless of the phone's screen. The legacy vector designs have
   * no such spec (they are CSS all the way down) so they are screenshotted
   * instead. Both paths return the same thing, so the callers do not care.
   */
  const buildImage = async (): Promise<Blob> => {
    if (template) {
      const qrSvg = cardRef.current?.querySelector<SVGElement>('svg[data-card-qr]') ?? null
      return await renderTemplateCardToBlob(template, templateData, { qrSvg })
    }
    if (!cardRef.current) throw new Error('The card is not ready yet. Please try again.')
    return await renderNodeToBlob(cardRef.current)
  }

  const handleShare = async () => {
    setBusy(true)
    try {
      const blob = await buildImage()
      const file = new File([blob], cardFileName(templateData.shopName), { type: 'image/png' })

      // canShare({ files }) must be checked, not assumed: several Android
      // browsers expose navigator.share but reject files, and calling share
      // with an unsupported payload throws instead of degrading.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: templateData.shopName || 'My Shop', text: shareText })
        return
      }

      // No file sharing — save it instead, so the shopkeeper still ends up with
      // the image and can attach it themselves. Silently sending text would be
      // the original bug.
      downloadBlob(blob, cardFileName(templateData.shopName))
      sonnerToast.success('Card saved to your downloads — attach it to your message')
    } catch (err) {
      // AbortError is the user dismissing the share sheet. Not a failure.
      if (err instanceof Error && err.name === 'AbortError') return
      sonnerToast.error(err instanceof Error ? err.message : 'Could not create the card image')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async () => {
    setBusy(true)
    try {
      const blob = await buildImage()
      downloadBlob(blob, cardFileName(templateData.shopName))
      sonnerToast.success('Card downloaded as an image')
    } catch (err) {
      sonnerToast.error(err instanceof Error ? err.message : 'Could not create the card image')
    } finally {
      setBusy(false)
    }
  }

  /**
   * WhatsApp's web link (`wa.me/?text=`) can only carry text — there is no URL
   * form that attaches a file. So this goes through the share sheet when one
   * exists, which is how a real image reaches WhatsApp, and falls back to the
   * text link only where no share sheet is available at all.
   */
  const handleWhatsApp = async () => {
    setBusy(true)
    try {
      const blob = await buildImage()
      const file = new File([blob], cardFileName(templateData.shopName), { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: templateData.shopName || 'My Shop', text: shareText })
        return
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
    } finally {
      setBusy(false)
    }
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
      {/* ═══ Design Picker Toggle ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{template?.name ?? design.name}</p>
          <p className="text-2xs text-muted-foreground">{template?.description ?? design.description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPicker(!showPicker)}
          className="gap-1.5"
        >
          <ImageIcon className="w-3.5 h-3.5" />
          {showPicker ? 'Hide Designs' : 'Choose Design'}
        </Button>
      </div>

      {/* ═══ Design Picker — real mini-renders, not colour swatches ═══
          The old picker showed a gradient rectangle with the name on it, so
          every design looked like a colour choice. Rendering the ACTUAL layout
          at thumbnail size is what makes the gallery worth scrolling. */}
      {showPicker && CARD_TEMPLATES.length > 0 && (
        <div className="space-y-2">
          <p className="text-3xs uppercase tracking-wider text-muted-foreground">Designer templates</p>
          <div className="grid grid-cols-2 gap-2">
            {CARD_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => handleDesignSelect(tpl.id)}
                className={cn(
                  'relative rounded-xl transition text-left',
                  tpl.id === template?.id
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'opacity-90 hover:opacity-100 hover:scale-[1.02]',
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

      {showPicker && (
        <div className="grid grid-cols-3 gap-2">
          {BUSINESS_CARD_DESIGNS.map((d) => (
            <button
              key={d.id}
              onClick={() => handleDesignSelect(d.id)}
              className={cn(
                'relative rounded-xl transition text-left',
                !template && d.id === design.id
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : 'opacity-90 hover:opacity-100 hover:scale-[1.03]',
              )}
              title={d.name}
              aria-pressed={!template && d.id === design.id}
            >
              <BusinessCardSurface design={d} data={cardData} qrValue={vcard} thumbnail />
              <p className="text-3xs mt-1 text-center truncate text-muted-foreground">{d.name}</p>
              {!template && d.id === design.id && (
                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow">
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ═══ The card ═══ */}
      <div className="shadow-card rounded-2xl overflow-hidden" ref={cardRef}>
        {template ? (
          <TemplateCard template={template} data={templateData} qrValue={vcard} onLogoClick={onLogoClick} />
        ) : (
          <BusinessCardSurface
            design={design}
            data={cardData}
            qrValue={vcard}
            onLogoClick={onLogoClick}
          />
        )}
      </div>

      {/* ═══ Share buttons ═══ */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={handleShare}
          disabled={busy}
          className="py-2.5 rounded-lg bg-gradient-saffron text-white text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <Share2 className="w-4 h-4" />
          Share
        </button>
        <button
          onClick={handleWhatsApp}
          disabled={busy}
          className="py-2.5 rounded-lg border border-emerald-300 text-emerald-700 dark:text-emerald-400 dark:border-emerald-800 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition disabled:opacity-60"
        >
          <Send className="w-4 h-4" />
          WhatsApp
        </button>
        <button
          onClick={handleDownload}
          disabled={busy}
          className="py-2.5 rounded-lg border border-blue-300 text-blue-700 dark:text-blue-400 dark:border-blue-800 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-blue-50 dark:hover:bg-blue-950 transition disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          {busy ? 'Working…' : 'Image'}
        </button>
      </div>

      {/* ═══ Details editor ═══ */}
      <CardDetailsEditor
        setting={setting}
        sessionEmail={email}
        // The saved values must show on the card immediately — Rahul's fifth
        // point. Refetching the setting re-renders the card above from the
        // server's copy, so what he sees is what is actually stored.
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['setting'] })}
      />

      {/* ═══ Tip ═══ */}
      <div className="rounded-lg bg-muted/50 border border-border/60 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">💡 How to use:</p>
        <p>Share this card with customers on WhatsApp — it sends as a picture they can save. They can scan the QR code to store your shop&apos;s contact in their phone.</p>
      </div>
    </div>
  )
}

/** Saves a blob to the user's downloads and releases the object URL. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
