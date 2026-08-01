'use client'

/**
 * 🐛 UI/UX Phase 2: Business Card Display Component
 *
 * Renders the user's digital visiting card using the design registry.
 * Shows: shop logo, shop name, owner name, phone, email, GSTIN, address, QR code.
 * Supports 10 top-notch designs from src/lib/business-card-designs.ts.
 *
 * Also renders the design picker (horizontal scroll of preview thumbnails)
 * and the share/download buttons.
 */

import { useState, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  Share2, Send, Download, Phone, Mail, FileSpreadsheet, MapPin,
  Store, User, Image as ImageIcon, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast as sonnerToast } from 'sonner'
import { getCardDesign, BUSINESS_CARD_DESIGNS, generateCardSlug, type BusinessCardDesign } from '@/lib/business-card-designs'
import { BusinessCardSurface, type CardData } from '@/components/common/BusinessCardSurface'
import { offlineFetch } from '@/lib/offline-fetch'
import { cn } from '@/lib/utils'

interface BusinessCardDisplayProps {
  setting: {
    shopName?: string | null
    ownerName?: string | null
    phone?: string | null
    gstin?: string | null
    address?: string | null
    upiId?: string | null
    logoUrl?: string | null
    cardDesign?: string | null
    cardSlug?: string | null
  }
  email?: string | null
  onDesignChange?: (designId: string) => void
  /**
   * Opens the shop-logo uploader. Passed in rather than owned here so the card
   * stays presentational — and so the SAME uploader is reachable from the card,
   * from Settings, and from the Account screen without three copies of it.
   *
   * Until 2026-07-29 the only way in was Settings > Profile, at line 628 of a
   * long form. Several designs here are built around the logo, so it has to be
   * reachable from the thing it appears on.
   */
  onLogoClick?: () => void
}

export function BusinessCardDisplay({ setting, email, onDesignChange, onLogoClick }: BusinessCardDisplayProps) {
  const design = getCardDesign(setting.cardDesign)

  // One shape, used by the hero card AND every picker thumbnail, so a preview
  // can never disagree with the card it is previewing.
  const cardData: CardData = {
    shopName: setting.shopName,
    ownerName: setting.ownerName,
    phone: setting.phone,
    email,
    gstin: setting.gstin,
    address: setting.address,
    logoUrl: setting.logoUrl,
  }
  const [showPicker, setShowPicker] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Build vCard 3.0 for QR code (more universally supported than MECARD)
  const escapeVcard = (val: string) => val.replace(/([;,:\\])/g, '\\$1')
  const vcardLines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']
  if (setting.ownerName) vcardLines.push(`FN:${escapeVcard(setting.ownerName)}`)
  if (setting.shopName) vcardLines.push(`ORG:${escapeVcard(setting.shopName)}`)
  if (setting.phone) vcardLines.push(`TEL;TYPE=CELL:${escapeVcard(setting.phone)}`)
  if (email) vcardLines.push(`EMAIL:${escapeVcard(email)}`)
  if (setting.address) vcardLines.push(`ADR;TYPE=WORK:;;${escapeVcard(setting.address)};;;India`)
  if (setting.gstin) vcardLines.push(`NOTE:GSTIN ${escapeVcard(setting.gstin)}`)
  if (setting.upiId) vcardLines.push(`X-UPI:${escapeVcard(setting.upiId)}`)
  vcardLines.push('END:VCARD')
  const vcard = vcardLines.join('\n')

  // Share text (includes UPI ID if available — for payment collection)
  const shareText = [
    setting.shopName || 'My Shop',
    setting.ownerName ? `Proprietor: ${setting.ownerName}` : '',
    setting.phone ? `Phone: ${setting.phone}` : '',
    email ? `Email: ${email}` : '',
    setting.gstin ? `GSTIN: ${setting.gstin}` : '',
    setting.upiId ? `Pay via UPI: ${setting.upiId}` : '',
    setting.address ? `Address: ${setting.address}` : '',
  ].filter(Boolean).join('\n')

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: setting.shopName || 'My Shop', text: shareText })
      } catch {}
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareText)
        sonnerToast.success('Business card copied to clipboard')
      } catch {}
    }
  }

  const handleWhatsApp = () => {
    const waText = encodeURIComponent(shareText)
    window.open(`https://wa.me/?text=${waText}`, '_blank')
  }

  const handleDownload = async () => {
    if (!cardRef.current) return
    sonnerToast.info('Generating image...')
    try {
      // 🐛 Phase 2 Fix: Implement "Download as image" (was promised in comment but never implemented)
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(cardRef.current, {
        scale: 2, // 2x for retina quality
        useCORS: true,
        backgroundColor: null,
      })
      const link = document.createElement('a')
      link.download = `${(setting.shopName || 'business-card').replace(/\s+/g, '-').toLowerCase()}-card.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      sonnerToast.success('Card downloaded as image')
    } catch (err) {
      console.error('Download error:', err)
      sonnerToast.error('Could not generate image. Please try the Share button instead.')
    }
  }

  const handleDesignSelect = async (designId: string) => {
    if (onDesignChange) {
      onDesignChange(designId)
    } else {
      // Save directly via API
      try {
        await offlineFetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardDesign: designId }),
          offline: { invalidate: ['/api/settings'] },
        })
        sonnerToast.success(`Design changed to ${BUSINESS_CARD_DESIGNS.find(d => d.id === designId)?.name}`)
        // Force re-render by reloading
        window.location.reload()
      } catch {
        sonnerToast.error('Could not save design choice')
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* ═══ Design Picker Toggle ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{design.name}</p>
          <p className="text-2xs text-muted-foreground">{design.description}</p>
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
      {showPicker && (
        <div className="grid grid-cols-3 gap-2">
          {BUSINESS_CARD_DESIGNS.map((d) => (
            <button
              key={d.id}
              onClick={() => handleDesignSelect(d.id)}
              className={cn(
                'relative rounded-xl transition text-left',
                d.id === design.id
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : 'opacity-90 hover:opacity-100 hover:scale-[1.03]',
              )}
              title={d.name}
              aria-pressed={d.id === design.id}
            >
              <BusinessCardSurface design={d} data={cardData} qrValue={vcard} thumbnail />
              <p className="text-3xs mt-1 text-center truncate text-muted-foreground">{d.name}</p>
              {d.id === design.id && (
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
        <BusinessCardSurface
          design={design}
          data={cardData}
          qrValue={vcard}
          onLogoClick={onLogoClick}
        />
      </div>


      {/* ═══ Share buttons ═══ */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={handleShare}
          className="py-2.5 rounded-lg bg-gradient-saffron text-white text-sm font-medium flex items-center justify-center gap-1.5"
        >
          <Share2 className="w-4 h-4" />
          Share
        </button>
        <button
          onClick={handleWhatsApp}
          className="py-2.5 rounded-lg border border-emerald-300 text-emerald-700 dark:text-emerald-400 dark:border-emerald-800 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition"
        >
          <Send className="w-4 h-4" />
          WhatsApp
        </button>
        {/* 🐛 Phase 2 Fix: "Download as image" — was promised in comment but never implemented */}
        <button
          onClick={handleDownload}
          className="py-2.5 rounded-lg border border-blue-300 text-blue-700 dark:text-blue-400 dark:border-blue-800 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-blue-50 dark:hover:bg-blue-950 transition"
        >
          <Download className="w-4 h-4" />
          Image
        </button>
      </div>

      {/* ═══ Tip ═══ */}
      <div className="rounded-lg bg-muted/50 border border-border/60 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">💡 How to use:</p>
        <p>Share this card with customers via WhatsApp. They can scan the QR code to instantly save your shop&apos;s contact in their phone. Download as an image to attach to emails or print.</p>
      </div>
    </div>
  )
}
