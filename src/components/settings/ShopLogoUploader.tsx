'use client'

/**
 * ShopLogoUploader — upload/remove the shop logo for invoice PDFs.
 *
 * 🔒 PDF Redesign Spec Part 3 §2: Renders at 18×18 mm in the brand band of
 * every invoice PDF. Reuses the existing Cloudinary upload helper.
 *
 * Two states:
 *   - No logo: shows an "Upload logo" drop zone (click to pick a file).
 *   - Has logo: shows the current logo + a "Replace" button + a "Remove" button.
 *
 * File constraints:
 *   - Image only (PNG/JPEG/WebP).
 *   - < 2 MB (Cloudinary transforms to 400×400 max).
 *
 * After upload, the parent Settings form's logoUrl field is updated so the
 * next "Save" persists it. The /api/settings/logo endpoint already persists
 * to the DB immediately, but we ALSO update the form so the user sees the
 * change without a refetch.
 */

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Upload, Trash2, ImageIcon, X } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { readError } from '@/lib/read-error'
import { cn } from '@/lib/utils'

interface Props {
  /** Current logo URL (from Setting.logoUrl). null = no logo. */
  logoUrl: string | null
  /** Called when a new logo is uploaded (URL) or removed (null). */
  onLogoChange: (logoUrl: string | null) => void
}

export function ShopLogoUploader({ logoUrl, onLogoChange }: Props) {
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file) return
    // Validate type
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      sonnerToast.error('Please use a PNG, JPEG, or WebP image')
      return
    }
    // Validate size (< 2 MB)
    if (file.size > 2_000_000) {
      sonnerToast.error('Logo too large — please use an image under 2 MB', {
        description: `Selected file is ${(file.size / 1_000_000).toFixed(1)} MB`,
      })
      return
    }
    setUploading(true)
    try {
      // Convert to base64 data URL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Could not read the file'))
        reader.readAsDataURL(file)
      })

      // Upload to /api/settings/logo (which calls Cloudinary + persists URL)
      const r = await offlineFetch('/api/settings/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      if (!r.ok) throw new Error(await readError(r))
      const result = await r.json()
      onLogoChange(result.logoUrl)
      sonnerToast.success('Logo uploaded — appears on your next invoice')
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn't upload the logo")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = async () => {
    if (!logoUrl) return
    if (!window.confirm('Remove the shop logo? Invoices will show just the shop name.')) return
    setRemoving(true)
    try {
      const r = await offlineFetch('/api/settings/logo', { method: 'DELETE' })
      if (!r.ok) throw new Error(await readError(r))
      onLogoChange(null)
      setPreviewError(false)
      sonnerToast.success('Logo removed')
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn't remove the logo")
    } finally {
      setRemoving(false)
    }
  }

  // No logo state — drop zone
  if (!logoUrl || previewError) {
    return (
      <div>
        <Label>Shop Logo</Label>
        <p className="text-2xs text-muted-foreground mb-1.5">
          Appears on your invoice PDFs (top-left of the header). Optional.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={cn(
            'w-full min-h-[80px] rounded-lg border-2 border-dashed border-border hover:border-primary/60 hover:bg-muted/40 transition flex flex-col items-center justify-center gap-1.5 text-muted-foreground',
            uploading && 'opacity-60 cursor-wait',
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" />
              <span className="text-xs font-medium">Click to upload logo</span>
              <span className="text-2xs">PNG, JPEG, or WebP · max 2 MB</span>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
      </div>
    )
  }

  // Has logo state — preview + replace + remove
  return (
    <div>
      <Label>Shop Logo</Label>
      <p className="text-2xs text-muted-foreground mb-1.5">
        Appears on your invoice PDFs (top-left of the header).
      </p>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-lg border border-border bg-card flex items-center justify-center overflow-hidden flex-shrink-0">
          <img
            src={logoUrl}
            alt="Shop logo"
            className="w-full h-full object-contain"
            onError={() => setPreviewError(true)}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || removing}
              className="gap-1.5 h-8"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Replace
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={uploading || removing}
              className="gap-1.5 h-8 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Remove
            </Button>
          </div>
          <p className="text-2xs text-muted-foreground mt-1.5 truncate">
            <ImageIcon className="w-3 h-3 inline mr-1" />
            {logoUrl.split('/').pop()}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
      </div>
    </div>
  )
}

// Local import — Label is small enough to inline rather than adding to the
// top-level imports of this file.
import { Label } from '@/components/ui/label'
