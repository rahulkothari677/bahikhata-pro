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
}

export function BusinessCardDisplay({ setting, email, onDesignChange }: BusinessCardDisplayProps) {
  const design = getCardDesign(setting.cardDesign)
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

      {/* ═══ Design Picker (horizontal scroll) ═══ */}
      {showPicker && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
          {BUSINESS_CARD_DESIGNS.map((d) => (
            <button
              key={d.id}
              onClick={() => handleDesignSelect(d.id)}
              className={cn(
                'flex-shrink-0 w-24 h-32 rounded-xl border-2 transition relative overflow-hidden',
                d.id === design.id ? 'border-primary shadow-md scale-105' : 'border-border hover:border-primary/50',
              )}
              style={{ background: d.previewGradient }}
              title={d.name}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-end p-2">
                <p className={cn('text-2xs font-medium text-center leading-tight', d.isDark ? 'text-white' : 'text-gray-900')}>
                  {d.name}
                </p>
              </div>
              {d.id === design.id && (
                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ═══ Digital Business Card ═══ */}
      <div className="relative rounded-2xl overflow-hidden shadow-card" ref={cardRef}>
        {/* Card front — design-specific background */}
        <div
          className="p-6 relative"
          style={{ background: design.background }}
        >
          {/* Decorations */}
          {design.decoration === 'circles' && (
            <>
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full -ml-12 -mb-12" />
            </>
          )}
          {design.decoration === 'waves' && (
            <svg className="absolute bottom-0 left-0 w-full h-20 opacity-10" viewBox="0 0 1440 120" preserveAspectRatio="none">
              <path d="M0,60 C240,100 480,20 720,60 C960,100 1200,20 1440,60 L1440,120 L0,120 Z" fill="white" />
            </svg>
          )}
          {design.decoration === 'mandala' && (
            <div className="absolute top-1/2 right-0 w-48 h-48 -mr-24 -translate-y-1/2 opacity-8" style={{ opacity: 0.08 }}>
              <svg viewBox="0 0 200 200" fill="none" className="w-full h-full">
                <circle cx="100" cy="100" r="80" stroke="white" strokeWidth="1" />
                <circle cx="100" cy="100" r="60" stroke="white" strokeWidth="1" />
                <circle cx="100" cy="100" r="40" stroke="white" strokeWidth="1" />
                {[...Array(8)].map((_, i) => (
                  <line key={i} x1="100" y1="20" x2="100" y2="180" stroke="white" strokeWidth="0.5" transform={`rotate(${i * 45} 100 100)`} />
                ))}
              </svg>
            </div>
          )}
          {design.decoration === 'particles' && (
            <>
              <div className="absolute top-4 left-8 w-1.5 h-1.5 bg-white/30 rounded-full" />
              <div className="absolute top-12 right-12 w-1 h-1 bg-white/20 rounded-full" />
              <div className="absolute bottom-8 left-16 w-2 h-2 bg-white/15 rounded-full" />
              <div className="absolute bottom-16 right-8 w-1 h-1 bg-white/25 rounded-full" />
              <div className="absolute top-20 left-4 w-1 h-1 bg-white/20 rounded-full" />
            </>
          )}

          {/* 🐛 Phase 2 Fix: Show logo on business card (was: completely absent) */}
          {setting.logoUrl && (
            <div className="relative mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={setting.logoUrl}
                alt={`${setting.shopName || 'Shop'} logo`}
                className="w-12 h-12 rounded-lg object-cover bg-white/90 p-1 shadow-md"
              />
            </div>
          )}

          {/* Card content — layout variant */}
          {design.layout === 'centered' ? (
            <div className="relative text-center">
              <p className="text-3xs uppercase tracking-wider font-semibold" style={{ color: design.labelTextColor }}>
                Business Name
              </p>
              <h3 className="text-xl font-bold mt-0.5 truncate" style={{ color: design.primaryTextColor }}>
                {setting.shopName || 'My Shop'}
              </h3>
              {setting.ownerName && (
                <p className="text-sm mt-1" style={{ color: design.secondaryTextColor }}>
                  {setting.ownerName}
                </p>
              )}
              <div className="mt-3 space-y-1">
                {setting.phone && (
                  <p className="text-xs flex items-center justify-center gap-1.5" style={{ color: design.secondaryTextColor }}>
                    <Phone className="w-3 h-3 flex-shrink-0" /> {setting.phone}
                  </p>
                )}
                {email && (
                  <p className="text-xs flex items-center justify-center gap-1.5" style={{ color: design.secondaryTextColor }}>
                    <Mail className="w-3 h-3 flex-shrink-0" /> {email}
                  </p>
                )}
              </div>
              <div className="mt-3 flex justify-center">
                <div className="p-2 rounded-xl shadow-lg" style={{ background: design.qrBgColor }}>
                  <QRCodeSVG value={vcard} size={80} level="Q" fgColor={design.qrFgColor} bgColor={design.qrBgColor} includeMargin={false} />
                </div>
              </div>
              <p className="text-3xs text-center mt-1" style={{ color: design.labelTextColor }}>Scan to save contact</p>
            </div>
          ) : design.layout === 'split' ? (
            <div className="relative">
              {/* Top half: text */}
              <div className="mb-4">
                <p className="text-3xs uppercase tracking-wider font-semibold" style={{ color: design.labelTextColor }}>
                  Business Name
                </p>
                <h3 className="text-xl font-bold mt-0.5 truncate" style={{ color: design.primaryTextColor }}>
                  {setting.shopName || 'My Shop'}
                </h3>
                {setting.ownerName && (
                  <p className="text-sm mt-1" style={{ color: design.secondaryTextColor }}>
                    {setting.ownerName}
                  </p>
                )}
                <div className="mt-2 space-y-1">
                  {setting.phone && (
                    <p className="text-xs flex items-center gap-1.5" style={{ color: design.secondaryTextColor }}>
                      <Phone className="w-3 h-3 flex-shrink-0" /> {setting.phone}
                    </p>
                  )}
                  {email && (
                    <p className="text-xs flex items-center gap-1.5" style={{ color: design.secondaryTextColor }}>
                      <Mail className="w-3 h-3 flex-shrink-0" /> {email}
                    </p>
                  )}
                </div>
              </div>
              {/* Bottom half: QR + GSTIN */}
              <div className="flex items-center justify-between gap-4 pt-3 border-t" style={{ borderColor: design.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }}>
                <div className="flex-1 min-w-0">
                  {setting.gstin && (
                    <p className="text-2xs font-mono" style={{ color: design.secondaryTextColor }}>
                      GSTIN: {setting.gstin}
                    </p>
                  )}
                  {setting.address && (
                    <p className="text-2xs mt-1 leading-relaxed" style={{ color: design.labelTextColor }}>
                      {setting.address}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0">
                  <div className="p-1.5 rounded-lg shadow-md" style={{ background: design.qrBgColor }}>
                    <QRCodeSVG value={vcard} size={72} level="Q" fgColor={design.qrFgColor} bgColor={design.qrBgColor} includeMargin={false} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Classic layout: text left, QR right */
            <div className="relative flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-3xs uppercase tracking-wider font-semibold" style={{ color: design.labelTextColor }}>
                  Business Name
                </p>
                <h3 className="text-xl font-bold mt-0.5 truncate" style={{ color: design.primaryTextColor }}>
                  {setting.shopName || 'My Shop'}
                </h3>
                {setting.ownerName && (
                  <p className="text-sm mt-2" style={{ color: design.secondaryTextColor }}>
                    <span style={{ color: design.labelTextColor }}>Proprietor:</span> {setting.ownerName}
                  </p>
                )}
                <div className="mt-3 space-y-1">
                  {setting.phone && (
                    <p className="text-xs flex items-center gap-1.5" style={{ color: design.secondaryTextColor }}>
                      <Phone className="w-3 h-3 flex-shrink-0" />
                      {setting.phone}
                    </p>
                  )}
                  {email && (
                    <p className="text-xs flex items-center gap-1.5" style={{ color: design.secondaryTextColor }}>
                      <Mail className="w-3 h-3 flex-shrink-0" />
                      {email}
                    </p>
                  )}
                  {setting.gstin && (
                    <p className="text-xs flex items-center gap-1.5 font-mono" style={{ color: design.secondaryTextColor }}>
                      <FileSpreadsheet className="w-3 h-3 flex-shrink-0" />
                      GSTIN: {setting.gstin}
                    </p>
                  )}
                </div>
                {setting.address && (
                  <p className="text-2xs mt-2 leading-relaxed" style={{ color: design.labelTextColor }}>
                    {setting.address}
                  </p>
                )}
              </div>
              {/* QR Code */}
              <div className="flex-shrink-0">
                <div className="p-2 rounded-xl shadow-lg" style={{ background: design.qrBgColor }}>
                  <QRCodeSVG
                    value={vcard}
                    size={96}
                    level="Q"
                    fgColor={design.qrFgColor}
                    bgColor={design.qrBgColor}
                    includeMargin={false}
                  />
                </div>
                <p className="text-3xs text-center mt-1" style={{ color: design.labelTextColor }}>Scan to save</p>
              </div>
            </div>
          )}
        </div>
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
