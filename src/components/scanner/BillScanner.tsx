'use client'

import { useState, useRef } from 'react'
import { useTranslation } from '@/hooks/use-translation'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { formatINR, cn } from '@/lib/utils'
import {
  ScanLine, Upload, Camera, Sparkles, X, Check, Loader2,
  ImageIcon, FileText, ArrowRight, Trash2, ShoppingCart, Truck, Plus,
} from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { useSubscription } from '@/hooks/use-subscription'
import { Capacitor } from '@capacitor/core'

/**
 * takePhotoNative — uses Capacitor Camera plugin on native (Android app)
 * to open the camera directly. Falls back to <input capture> on web.
 *
 * Uses CameraResultType.Base64 (more reliable than DataUrl on some Android
 * devices where DataUrl comes back empty after the user confirms the photo).
 *
 * Returns a File object or null if cancelled/failed.
 */
async function takePhotoNative(): Promise<File | null> {
  // On native platform, use Capacitor Camera plugin
  if (Capacitor.isNativePlatform()) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')

      // Explicitly request camera permission before calling getPhoto.
      try {
        const permStatus = await Camera.checkPermissions()
        if (permStatus.camera !== 'granted') {
          const reqResult = await Camera.requestPermissions({ permissions: ['camera'] })
          if (reqResult.camera !== 'granted') {
            return null
          }
        }
      } catch (permErr) {
      }

      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        saveToGallery: false,
      })

      // Read the file from the URI using Capacitor Filesystem API
      if (photo.path) {
        try {
          const { Filesystem } = await import('@capacitor/filesystem')
          const fileResult = await Filesystem.readFile({ path: photo.path })

          let blob: Blob
          if (typeof fileResult.data === 'string') {
            const format = photo.format || 'jpeg'
            const byteCharacters = atob(fileResult.data)
            const byteNumbers = new Array(byteCharacters.length)
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i)
            }
            const byteArray = new Uint8Array(byteNumbers)
            blob = new Blob([byteArray], { type: `image/${format}` })
          } else {
            blob = fileResult.data as Blob
          }

          const format = photo.format || 'jpeg'
          const file = new File([blob], `bill_${Date.now()}.${format}`, { type: `image/${format}` })
          return file
        } catch (fsErr) {
          if (photo.webPath) {
            const res = await fetch(photo.webPath)
            const blob = await res.blob()
            const format = photo.format || 'jpeg'
            return new File([blob], `bill_${Date.now()}.${format}`, { type: `image/${format}` })
          }
          throw fsErr
        }
      }

      if (photo.webPath) {
        const res = await fetch(photo.webPath)
        const blob = await res.blob()
        const format = photo.format || 'jpeg'
        return new File([blob], `bill_${Date.now()}.${format}`, { type: `image/${format}` })
      }

      return null
    } catch (err: any) {
      const msg = String(err?.message || err || '').toLowerCase()
      if (msg.includes('cancelled') || msg.includes('user denied') || msg.includes('canceled')) {
        return null
      }
      throw new Error(err?.message || String(err))
    }
  }
  return null
}

/**
 * pickPhotoNative — uses Capacitor Camera plugin on native (Android app)
 * to open the photo gallery. Falls back to <input> on web.
 */
async function pickPhotoNative(): Promise<File | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')

      // Check/request photo library permission
      try {
        const permStatus = await Camera.checkPermissions()
        if (permStatus.photos !== 'granted' && permStatus.photos !== 'limited') {
          const reqResult = await Camera.requestPermissions({ permissions: ['photos'] })
        }
      } catch (permErr) {
        console.warn('[Camera] Photos permission check failed (continuing):', permErr)
      }

      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
      })
      if (!photo.base64String) {
        console.warn('[Camera] No base64String returned from gallery')
        return null
      }
      const format = photo.format || 'jpeg'
      const dataUrl = `data:image/${format};base64,${photo.base64String}`
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      return new File([blob], `bill_${Date.now()}.${format}`, { type: `image/${format}` })
    } catch (err: any) {
      const msg = String(err?.message || err || '').toLowerCase()
      if (msg.includes('cancelled') || msg.includes('user denied') || msg.includes('canceled')) {
        return null
      }
      console.error('[Camera] Native pick failed:', err)
      throw new Error(err?.message || String(err))
    }
  }
  return null
}

export function BillScanner() {
  const { t } = useTranslation()
  const { setView, scannerBillType, setScannerBillType, setScannerResult } = useAppStore()
  const { toast } = useToast()
  const { requireFeature } = useSubscription()
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<any>(null)
  const [preview, setPreview] = useState<string>('')
  const [billType, setBillType] = useState<'sale' | 'purchase'>(scannerBillType)
  // Grayscale mode for printed bills — saves ~20% tokens on AI providers
  // that bill by image tiles (Gemini, GPT-4o). Handwritten bills stay color
  // because ink color (red/blue) can carry meaning.
  const [grayscale, setGrayscale] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    // Subscription gating — re-enabled. Free users get 5 scans/month,
    // Pro gets 150 (marketed as "unlimited" with FUP), Elite gets 500.
    // The hook shows the PaywallModal automatically if the feature is gated.
    if (!requireFeature('ai_scanner')) {
      return
    }
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Please select an image file', variant: 'destructive' })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Image too large. Max 10MB', variant: 'destructive' })
      return
    }

    // Compress and resize image on client side before sending to API
    // This prevents Vercel serverless timeout on large phone photos
    // Made more aggressive (smaller dimensions + lower quality) to handle
    // large phone photos that were causing timeouts/failures
    const compressImage = (file: File, useGrayscale: boolean = false): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const img = new Image()
          img.onload = () => {
            // Reduced max dimensions for more aggressive compression
            // 800x1000 is still enough for AI to read text on bills
            const MAX_WIDTH = 1000
            const MAX_HEIGHT = 1400
            let width = img.width
            let height = img.height

            if (width > MAX_WIDTH || height > MAX_HEIGHT) {
              const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height)
              width = Math.round(width * ratio)
              height = Math.round(height * ratio)
            }

            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              reject(new Error('Canvas not supported'))
              return
            }
            ctx.drawImage(img, 0, 0, width, height)

            // Grayscale conversion — for printed bills, color adds no value
            // but costs ~20% more tokens on Gemini/GPT-4o (which tile images
            // into 3-channel RGB patches). Converting to luminance only saves
            // that cost. Skip for handwritten bills where ink color matters.
            if (useGrayscale) {
              const imageData = ctx.getImageData(0, 0, width, height)
              const data = imageData.data
              for (let i = 0; i < data.length; i += 4) {
                // ITU-R BT.601 luminance formula — standard for grayscale conversion
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
                data[i] = gray
                data[i + 1] = gray
                data[i + 2] = gray
              }
              ctx.putImageData(imageData, 0, 0)
            }

            // JPEG at 75% quality on a 1000x1400 image — good text readability
            // while keeping file size reasonable (~200-300KB for upload)
            const compressed = canvas.toDataURL('image/jpeg', 0.75)
            resolve(compressed)
          }
          img.onerror = () => {
            reject(new Error('Failed to load image'))
          }
          img.src = e.target?.result as string
        }
        reader.onerror = () => {
          reject(new Error('Failed to read file'))
        }
        reader.readAsDataURL(file)
      })
    }

    // Fallback compression for Capacitor WebView — if FileReader/Image fails,
    // convert the file to base64 directly without going through Image/canvas
    const compressImageFallback = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const result = e.target?.result as string
          if (result) {
            resolve(result)
          } else {
            reject(new Error('FileReader returned no result'))
          }
        }
        reader.onerror = () => {
          reject(new Error('FileReader failed'))
        }
        reader.readAsDataURL(file)
      })
    }

    try {
      // Compress the image first — try main method, fall back to direct base64
      let base64: string
      try {
        base64 = await compressImage(file, grayscale)
      } catch (compressErr) {
        base64 = await compressImageFallback(file)
      }
      setPreview(base64)
      setScanning(true)
      // Save existing items before scanning (for "adding more" mode)
      const existingItems = scanned?._isAddingMore ? (scanned?.items || []) : []
      const isAddingMore = scanned?._isAddingMore || false
      // Don't set scanned to null if we're adding more — keep showing items
      if (!isAddingMore) {
        setScanned(null)
      }
      try {
        // Step 1: Upload to Cloudinary (gets a URL, stores image for future)
        sonnerToast.info('Uploading image...', { description: 'Step 1 of 2', duration: 2000 })
        const uploadRes = await offlineFetch('/api/upload-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 }),
        })

        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.json().catch(() => ({}))
          sonnerToast.error('Image upload failed', {
            description: `HTTP ${uploadRes.status}: ${uploadErr.error || uploadRes.statusText || 'Unknown error'}`,
            duration: 8000,
          })
          return
        }

        const uploadData = await uploadRes.json()
        sonnerToast.info('Image uploaded! Scanning with AI...', { description: 'Step 2 of 2', duration: 2000 })

        // Step 2: Send to AI scanner (use Cloudinary URL if upload succeeded, else base64)
        const imageUrl = uploadData.success ? uploadData.url : null
        const scanRes = await offlineFetch('/api/scan-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(imageUrl ? { imageUrl, billType } : { imageBase64: base64, billType }),
        })

        // Handle 402 quota exceeded — show upgrade prompt instead of generic error
        if (scanRes.status === 402) {
          const quotaData = await scanRes.json().catch(() => ({}))
          sonnerToast.error('AI scan limit reached', {
            description: quotaData.message || 'Upgrade to Pro for more scans',
            duration: 6000,
          })
          // Trigger the paywall via the subscription hook
          requireFeature('ai_scanner')
          return
        }

        // Handle non-200 responses with visible error details
        if (!scanRes.ok) {
          const errData = await scanRes.json().catch(() => ({}))
          const errorDetail = errData.detail || errData.error || errData.message || scanRes.statusText || 'Unknown server error'
          sonnerToast.error(`Scan failed (HTTP ${scanRes.status})`, {
            description: errorDetail,
            duration: 10000,
          })
          return
        }

        const data = await scanRes.json()
        if (data.error) {
          sonnerToast.error('AI scan error', {
            description: `${data.error}${data.detail ? ': ' + data.detail : ''}`,
            duration: 10000,
          })
        } else if (!data.bill || !data.bill.items || data.bill.items.length === 0) {
          sonnerToast.warning('Scan returned no items', {
            description: 'AI could not detect any items in this image. Try a clearer photo.',
            duration: 8000,
          })
        } else {
          // If we're in "adding more" mode, append new items to existing
          if (isAddingMore && existingItems.length > 0) {
            const newItems = data.bill.items || []
            setScanned({
              ...data.bill,
              items: [...existingItems, ...newItems],
              _isAddingMore: false,
            })
            sonnerToast.success(`Added ${newItems.length} more items from second bill!`)
          } else {
            setScanned(data.bill)
            sonnerToast.success(`Bill scanned! Found ${data.bill.items?.length || 0} items.`)
          }
        }
      } catch (e: any) {
        // Network error, fetch failed, JSON parse error, etc.
        sonnerToast.error('Scan request failed', {
          description: `${e?.name || 'Error'}: ${e?.message || String(e)}. Check your internet connection and try again.`,
          duration: 10000,
        })
      } finally {
        setScanning(false)
      }
    } catch (compressError: any) {
      sonnerToast.error('Failed to process image', {
        description: `${compressError?.name || 'Error'}: ${compressError?.message || 'Could not read the image file'}. Try a different image (PNG/JPG under 10MB).`,
        duration: 10000,
      })
      setScanning(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // Try native camera first (Capacitor plugin). If unavailable or cancelled,
  // fall back to the hidden <input capture> element (web browser).
  const handleTakePhoto = async () => {
    try {
      // On web (not native), skip the native plugin entirely and go straight to input
      if (!Capacitor.isNativePlatform()) {
        if (cameraInputRef.current) {
          cameraInputRef.current.click()
        } else {
          console.error('[Scanner] cameraInputRef.current is null!')
          // Try fileInputRef as fallback
          if (fileInputRef.current) {
            fileInputRef.current.click()
          }
        }
        return
      }

      // Native platform — use native Android camera (reliable, has built-in flash + grid)
      const file = await takePhotoNative()
      if (file) {
        handleFile(file)
      } else {
        toast({
          title: 'Camera unavailable',
          description: 'Camera may be in use by another app, or permission was denied. Check Android Settings → Apps → BahiKhata Pro → Permissions.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('[Scanner] handleTakePhoto error:', err)
      toast({
        title: 'Camera error',
        description: String(err?.message || err),
        variant: 'destructive',
      })
    }
  }

  // Try native photo picker first (Capacitor plugin). If unavailable,
  // fall back to the hidden <input> element (web browser).
  const handlePickPhoto = async () => {
    try {
      // On web (not native), skip the native plugin entirely
      if (!Capacitor.isNativePlatform()) {
        if (fileInputRef.current) {
          fileInputRef.current.click()
        } else {
          console.error('[Scanner] fileInputRef.current is null!')
        }
        return
      }

      // Native platform — use Capacitor Camera plugin
      const file = await pickPhotoNative()
      if (file) {
        handleFile(file)
      } else {
        toast({
          title: 'Photo picker unavailable',
          description: 'Could not open photo gallery. Check storage permissions in Android Settings.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('[Scanner] handlePickPhoto error:', err)
      toast({
        title: 'Photo picker error',
        description: String(err?.message || err),
        variant: 'destructive',
      })
    }
  }

  const updateItem = (index: number, field: string, value: any) => {
    if (!scanned) return
    const newItems = [...scanned.items]
    newItems[index] = { ...newItems[index], [field]: value }
    // Recalculate item total
    if (['quantity', 'unitPrice'].includes(field)) {
      const item = newItems[index]
      newItems[index].total = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) * (1 + (Number(item.gstRate) || 0) / 100)
    }
    setScanned({ ...scanned, items: newItems })
  }

  const removeItem = (index: number) => {
    if (!scanned) return
    setScanned({ ...scanned, items: scanned.items.filter((_: any, i: number) => i !== index) })
  }

  const addItem = () => {
    if (!scanned) return
    setScanned({
      ...scanned,
      items: [...scanned.items, { name: '', quantity: 1, unit: 'pcs', unitPrice: 0, gstRate: 0, total: 0 }],
    })
  }

  const handleProceedToSave = () => {
    if (!scanned) return
    // Pass data to ledger via window object (since both live in same SPA)
    ;(window as any).__ledgerPreset = { type: billType, data: scanned }
    setScannerBillType(billType)
    setView(billType === 'sale' ? 'sales' : 'purchases')
    sonnerToast.info('Review the auto-filled form and save')
  }

  const handleReset = () => {
    setScanned(null)
    setPreview('')
    setScanning(false)
  }

  // Totals
  let subtotal = 0, totalGst = 0
  scanned?.items?.forEach((item: any) => {
    const amt = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
    subtotal += amt
    totalGst += amt * (Number(item.gstRate) || 0) / 100
  })
  const grandTotal = subtotal - (scanned?.discountAmount || 0) + totalGst

  return (
    <div className="space-y-4">
      {/* Bill type selector */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-4">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">I am scanning a...</Label>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <button
              onClick={() => setBillType('purchase')}
              className={cn(
                'rounded-xl p-4 border-2 transition text-left',
                billType === 'purchase'
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                  : 'border-border hover:border-amber-300 dark:hover:border-amber-700'
              )}
            >
              <Truck className={cn('w-6 h-6 mb-2', billType === 'purchase' ? 'text-amber-600' : 'text-muted-foreground')} />
              <p className="font-semibold text-sm">{t('scanner.purchase_bill')}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t('scanner.goods_bought')}</p>
            </button>
            <button
              onClick={() => setBillType('sale')}
              className={cn(
                'rounded-xl p-4 border-2 transition text-left',
                billType === 'sale'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                  : 'border-border hover:border-emerald-300 dark:hover:border-emerald-700'
              )}
            >
              <ShoppingCart className={cn('w-6 h-6 mb-2', billType === 'sale' ? 'text-emerald-600' : 'text-muted-foreground')} />
              <p className="font-semibold text-sm">{t('scanner.sales_bill')}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t('scanner.goods_sold')}</p>
            </button>
          </div>

          {/* Grayscale toggle — saves ~20% AI cost on printed bills */}
          <div className="mt-3 flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/40">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">Printed bill mode</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Converts to grayscale — saves AI cost. Off for handwritten bills.
              </p>
            </div>
            <Switch
              checked={grayscale}
              onCheckedChange={(checked) => {
                setGrayscale(checked)
                sonnerToast.info(checked ? 'Grayscale on — better for printed bills' : 'Color mode — better for handwritten bills', { duration: 2500 })
              }}
            />
          </div>
        </CardContent>
      </Card>

      {!scanned && (
        <>
          {/* Upload area */}
          <Card
            className="shadow-card border-border/60 border-2 border-dashed hover:border-primary/50 transition"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <CardContent className="p-8 lg:p-12 text-center">
              {scanning ? (
                <div className="py-12">
                  {/* Animated scanning visualization */}
                  <div className="relative w-24 h-24 mx-auto mb-6">
                    {/* Outer pulsing ring */}
                    <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
                    {/* Middle ring */}
                    <div className="absolute inset-2 rounded-full bg-primary/15" />
                    {/* Inner circle with icon */}
                    <div className="absolute inset-4 rounded-full bg-gradient-saffron flex items-center justify-center shadow-lg">
                      <ScanLine className="w-8 h-8 text-white animate-pulse" />
                    </div>
                    {/* Scanning line animation */}
                    <div className="absolute inset-0 rounded-full overflow-hidden">
                      <div
                        className="absolute left-0 right-0 h-0.5 bg-primary/60"
                        style={{
                          animation: 'scanline 1.5s ease-in-out infinite',
                        }}
                      />
                    </div>
                  </div>

                  <h3 className="font-semibold text-lg font-heading">{t('scanner.scanning')}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{t('scanner.extracting')}</p>

                  {/* Animated tips — cycle through while scanning */}
                  <div className="mt-6 max-w-xs mx-auto">
                    <div className="flex items-center gap-2 justify-center text-xs text-muted-foreground">
                      <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
                      <span className="animate-pulse">Reading text with AI vision...</span>
                    </div>
                  </div>

                  {/* Progress steps */}
                  <div className="mt-4 flex items-center justify-center gap-1.5">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-primary"
                        style={{
                          animation: `pulse 1s ease-in-out ${i * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : preview ? (
                <div className="space-y-3">
                  <img src={preview} alt="Bill preview" className="max-h-64 mx-auto rounded-lg shadow-md" />
                  <Button variant="outline" onClick={handleReset}>Choose another image</Button>
                </div>
              ) : (
                <>
                  <div className="w-20 h-20 mx-auto rounded-full bg-gradient-saffron flex items-center justify-center mb-4 shadow-lg">
                    <ScanLine className="w-10 h-10 text-white" />
                  </div>
                  <h3 className="text-lg lg:text-xl font-bold">{t('scanner.scan_bill')}</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                    Snap a photo of any bill, invoice or receipt. Our AI will extract every item, price, tax and party detail automatically.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
                    <Button
                      size="lg"
                      onClick={handleTakePhoto}
                      className="bg-gradient-saffron gap-2 shadow-lg"
                    >
                      <Camera className="w-5 h-5" /> {t('scanner.take_photo')}
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={handlePickPhoto}
                      className="gap-2"
                    >
                      <Upload className="w-5 h-5" /> {t('scanner.upload_image')}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-4">
                    Supports JPG, PNG • Max 10MB • Works best with clear photos
                  </p>

                  {/* Feature highlights */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8 max-w-2xl mx-auto">
                    <div className="rounded-lg bg-muted/50 p-3 text-left">
                      <Sparkles className="w-4 h-4 text-primary mb-1" />
                      <p className="text-xs font-semibold">Auto-Extract Items</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Name, qty, price, GST all filled</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 text-left">
                      <FileText className="w-4 h-4 text-primary mb-1" />
                      <p className="text-xs font-semibold">Smart Tax Split</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">CGST/SGST/IGST auto-detected</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 text-left">
                      <Check className="w-4 h-4 text-primary mb-1" />
                      <p className="text-xs font-semibold">Verify & Edit</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Add, remove or change anything</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Hidden file inputs — always rendered (outside conditional) so
          'Scan More Items' can trigger them even when results are showing */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = '' }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = '' }}
      />

      {/* Verification & edit view */}
      {scanned && (
        <div className="space-y-3">
          {/* Header banner — full width, no card padding around it */}
          <div className={cn('rounded-xl overflow-hidden shadow-card text-white', billType === 'sale' ? 'bg-gradient-emerald' : 'bg-gradient-saffron')}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold font-heading">{billType === 'sale' ? 'Sales Bill' : 'Purchase Bill'}</p>
                    <p className="text-[10px] text-white/70">
                      AI Extracted
                      {scanned.overallConfidence !== undefined && (
                        <span className="ml-1">· {Math.round(scanned.overallConfidence * 100)}% confidence</span>
                      )}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 h-8" onClick={handleReset}>
                  <X className="w-4 h-4" /> Reset
                </Button>
              </div>
              {/* 2 rows, 2 columns each — bigger text, clearly visible */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-[10px] text-white/60 uppercase tracking-wide">Invoice</p>
                  <p className="font-semibold text-sm">{scanned.invoiceNo || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/60 uppercase tracking-wide">Date</p>
                  <p className="font-semibold text-sm">{scanned.date || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/60 uppercase tracking-wide">Party</p>
                  <p className="font-semibold text-sm truncate">{scanned.sellerName || 'Walk-in'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/60 uppercase tracking-wide">Payment</p>
                  <p className="font-semibold text-sm capitalize">{scanned.paymentMode || 'cash'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Items table - editable */}
          <Card className="shadow-card border-border/60 py-3 gap-2">
            <CardHeader className="pb-1 px-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" />
                  Items ({scanned.items.length})
                </CardTitle>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={addItem} className="gap-1 h-7 text-xs">
                    <Plus className="w-3 h-3" /> Add
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setScanned({ ...scanned, _isAddingMore: true })
                      setPreview('')
                      if (Capacitor.isNativePlatform()) {
                        handleTakePhoto()
                      } else {
                        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                        if (isMobile) {
                          cameraInputRef.current?.click()
                        } else {
                          fileInputRef.current?.click()
                        }
                      }
                    }}
                    className="bg-gradient-saffron gap-1 h-7 text-xs"
                  >
                    <ScanLine className="w-3 h-3" /> Scan More
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-2">
              <div className="space-y-1">
                {scanned.items.map((item: any, i: number) => {
                  return (
                    <div key={i} className="group rounded-lg bg-muted/20 hover:bg-muted/40 transition px-3 py-2">
                      {/* Row 1: Number + Name (full width) + Total + Delete */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-muted-foreground flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center">
                          {i + 1}
                        </span>
                        <input
                          value={item.name}
                          onChange={(e) => updateItem(i, 'name', e.target.value)}
                          className="flex-1 min-w-0 bg-transparent border border-transparent rounded font-medium text-sm transition px-1 py-0.5 focus:bg-background focus:border-border focus:px-2"
                          placeholder="Product name"
                        />
                        {item.confidence !== undefined && (
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full flex-shrink-0',
                              item.confidence >= 0.8 ? 'bg-emerald-500' :
                              item.confidence >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'
                            )}
                            title={`AI confidence: ${Math.round(item.confidence * 100)}%`}
                          />
                        )}
                        <span className="font-bold tabular-nums flex-shrink-0 text-sm text-primary">
                          {formatINR(item.total || 0)}
                        </span>
                        <button
                          className="p-1 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition flex-shrink-0"
                          onClick={() => removeItem(i)}
                          title="Remove this item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* Row 2: Qty + Unit + Price + GST — flat, no inner boxes, bigger */}
                      <div className="flex items-center gap-2 pl-7">
                        <div className="flex-1 min-w-0 flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground w-7">Qty</span>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))}
                            className="w-full min-w-0 bg-background border border-border rounded tabular-nums focus:ring-1 focus:ring-primary text-center text-sm px-1 py-1"
                          />
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-1 w-16">
                          <select
                            value={item.unit || 'pcs'}
                            onChange={(e) => updateItem(i, 'unit', e.target.value)}
                            className="w-full bg-background border border-border rounded focus:ring-1 focus:ring-primary text-sm px-1 py-1"
                          >
                            {['pcs', 'kg', 'gm', 'ltr', 'ml', 'box', 'dozen', 'packet', 'set'].map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <span className="text-muted-foreground flex-shrink-0 text-xs">×</span>
                        <div className="flex-1 min-w-0 flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground w-8">₹</span>
                          <input
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(i, 'unitPrice', Number(e.target.value))}
                            className="w-full min-w-0 bg-background border border-border rounded tabular-nums focus:ring-1 focus:ring-primary text-center text-sm px-1 py-1"
                          />
                        </div>
                        <div className="flex-shrink-0 w-14">
                          <select
                            value={item.gstRate}
                            onChange={(e) => updateItem(i, 'gstRate', Number(e.target.value))}
                            className="w-full bg-background border border-border rounded focus:ring-1 focus:ring-primary text-sm px-1 py-1"
                          >
                            {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {scanned.items.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No items. Click &quot;Add&quot; to add manually.
                  </div>
                )}
              </div>

              {/* Totals — compact */}
              <div className="mt-3 pt-3 border-t border-border space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium tabular-nums">{formatINR(subtotal)}</span>
                </div>
                {scanned.discountAmount > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="font-medium text-rose-600 tabular-nums">-{formatINR(scanned.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">GST Total</span>
                  <span className="font-medium tabular-nums">{formatINR(totalGst)}</span>
                </div>
                {(scanned.cgst > 0 || scanned.sgst > 0) && (
                  <div className="flex justify-between text-[11px] text-muted-foreground pl-4">
                    <span>CGST + SGST</span>
                    <span className="tabular-nums">{formatINR(scanned.cgst)} + {formatINR(scanned.sgst)}</span>
                  </div>
                )}
                {scanned.igst > 0 && (
                  <div className="flex justify-between text-[11px] text-muted-foreground pl-4">
                    <span>IGST</span>
                    <span className="tabular-nums">{formatINR(scanned.igst)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-border">
                  <span className="font-semibold text-sm">Grand Total</span>
                  <span className="text-base font-bold tabular-nums">{formatINR(grandTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action buttons — compact */}
          <Card className="shadow-card border-border/60">
            <CardContent className="p-3">
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5 h-9" onClick={handleReset}>
                  <X className="w-3.5 h-3.5" /> Discard
                </Button>
                <Button
                  className="flex-1 gap-1.5 bg-gradient-saffron shadow-md h-9"
                  onClick={handleProceedToSave}
                >
                  <Check className="w-3.5 h-3.5" /> Verify & Save
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                Pre-fills the {billType === 'sale' ? 'sales' : 'purchase'} form — just review and save!
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
