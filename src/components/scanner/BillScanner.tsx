'use client'

import { useState, useRef } from 'react'
import { useTranslation } from '@/hooks/use-translation'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
      sonnerToast.info('DEBUG: Camera plugin loaded')

      // Explicitly request camera permission before calling getPhoto.
      try {
        const permStatus = await Camera.checkPermissions()
        sonnerToast.info('DEBUG: Permission', { description: `camera: ${permStatus.camera}` })
        if (permStatus.camera !== 'granted') {
          const reqResult = await Camera.requestPermissions({ permissions: ['camera'] })
          sonnerToast.info('DEBUG: After request', { description: `camera: ${reqResult.camera}` })
          if (reqResult.camera !== 'granted') {
            sonnerToast.error('DEBUG: Permission denied')
            return null
          }
        }
      } catch (permErr) {
        sonnerToast.info('DEBUG: Permission check failed', { description: String(permErr) })
      }

      sonnerToast.info('DEBUG: Opening camera...')
      const photo = await Camera.getPhoto({
        quality: 60,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        saveToGallery: false,
      })
      sonnerToast.info('DEBUG: Photo received', { description: `path: ${photo.path}, webPath: ${photo.webPath ? 'yes' : 'no'}, format: ${photo.format}` })

      // Read the file from the URI using Capacitor Filesystem API
      if (photo.path) {
        try {
          const { Filesystem } = await import('@capacitor/filesystem')
          sonnerToast.info('DEBUG: Reading file...')
          const fileResult = await Filesystem.readFile({ path: photo.path })
          sonnerToast.info('DEBUG: File read', { description: `data length: ${fileResult.data?.length || 0}` })

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
          sonnerToast.success('DEBUG: File created', { description: `${file.name} (${file.size} bytes)` })
          return file
        } catch (fsErr) {
          sonnerToast.error('DEBUG: Filesystem failed', { description: String(fsErr) })
          if (photo.webPath) {
            sonnerToast.info('DEBUG: Trying webPath fallback')
            const res = await fetch(photo.webPath)
            const blob = await res.blob()
            const format = photo.format || 'jpeg'
            return new File([blob], `bill_${Date.now()}.${format}`, { type: `image/${format}` })
          }
          throw fsErr
        }
      }

      if (photo.webPath) {
        sonnerToast.info('DEBUG: Using webPath only')
        const res = await fetch(photo.webPath)
        const blob = await res.blob()
        const format = photo.format || 'jpeg'
        return new File([blob], `bill_${Date.now()}.${format}`, { type: `image/${format}` })
      }

      sonnerToast.error('DEBUG: No path or webPath')
      return null
    } catch (err: any) {
      const msg = String(err?.message || err || '').toLowerCase()
      if (msg.includes('cancelled') || msg.includes('user denied') || msg.includes('canceled')) {
        sonnerToast.info('DEBUG: User cancelled')
        return null
      }
      sonnerToast.error('DEBUG: Camera failed', { description: String(err?.message || err) })
      throw new Error(err?.message || String(err))
    }
  }
  sonnerToast.info('DEBUG: Not native platform')
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
        console.log('[Camera] Photos permission status:', permStatus)
        if (permStatus.photos !== 'granted' && permStatus.photos !== 'limited') {
          const reqResult = await Camera.requestPermissions({ permissions: ['photos'] })
          console.log('[Camera] Photos request result:', reqResult)
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
        console.log('[Camera] User cancelled photo pick')
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
  const [editMode, setEditMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    sonnerToast.info('DEBUG: handleFile started', { description: `file: ${file.name}, size: ${file.size}, type: ${file.type}` })
    // Subscription gating — requires Pro plan for AI scanner
    if (!requireFeature('ai_scanner')) {
      sonnerToast.error('DEBUG: requireFeature returned false — subscription blocked')
      return
    }
    sonnerToast.info('DEBUG: Subscription OK')
    if (!file) {
      sonnerToast.error('DEBUG: No file')
      return
    }
    if (!file.type.startsWith('image/')) {
      sonnerToast.error('DEBUG: Not an image', { description: file.type })
      toast({ title: 'Please select an image file', variant: 'destructive' })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      sonnerToast.error('DEBUG: Too large', { description: `${file.size} bytes` })
      toast({ title: 'Image too large. Max 10MB', variant: 'destructive' })
      return
    }
    sonnerToast.info('DEBUG: File valid, compressing...')

    // Compress and resize image on client side before sending to API
    // This prevents Vercel serverless timeout on large phone photos
    // Made more aggressive (smaller dimensions + lower quality) to handle
    // large phone photos that were causing timeouts/failures
    const compressImage = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          sonnerToast.info('DEBUG: FileReader loaded')
          const img = new Image()
          img.onload = () => {
            sonnerToast.info('DEBUG: Image loaded', { description: `${img.width}x${img.height}` })
            // Reduced max dimensions for more aggressive compression
            // 800x1000 is still enough for AI to read text on bills
            const MAX_WIDTH = 800
            const MAX_HEIGHT = 1000
            let width = img.width
            let height = img.height

            if (width > MAX_WIDTH || height > MAX_HEIGHT) {
              const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height)
              width = Math.round(width * ratio)
              height = Math.round(height * ratio)
            }
            sonnerToast.info('DEBUG: Resizing to', { description: `${width}x${height}` })

            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              sonnerToast.error('DEBUG: Canvas not supported')
              reject(new Error('Canvas not supported'))
              return
            }
            ctx.drawImage(img, 0, 0, width, height)

            // Lower quality (0.7 = 70%) for more aggressive compression
            // JPEG at 70% quality on an 800x1000 image is usually under 200KB
            const compressed = canvas.toDataURL('image/jpeg', 0.7)
            const sizeKB = Math.round(compressed.length / 1024)
            sonnerToast.info('DEBUG: Compressed', { description: `${sizeKB} KB` })
            resolve(compressed)
          }
          img.onerror = () => {
            sonnerToast.error('DEBUG: Image load failed')
            reject(new Error('Failed to load image'))
          }
          img.src = e.target?.result as string
        }
        reader.onerror = () => {
          sonnerToast.error('DEBUG: FileReader failed')
          reject(new Error('Failed to read file'))
        }
        reader.readAsDataURL(file)
      })
    }

    // Fallback compression for Capacitor WebView — if FileReader/Image fails,
    // convert the file to base64 directly without going through Image/canvas
    const compressImageFallback = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        sonnerToast.info('DEBUG: Using fallback compression')
        const reader = new FileReader()
        reader.onload = (e) => {
          const result = e.target?.result as string
          if (result) {
            sonnerToast.info('DEBUG: Fallback got base64', { description: `${Math.round(result.length / 1024)} KB` })
            resolve(result)
          } else {
            sonnerToast.error('DEBUG: Fallback failed — no result')
            reject(new Error('FileReader returned no result'))
          }
        }
        reader.onerror = () => {
          sonnerToast.error('DEBUG: Fallback FileReader failed')
          reject(new Error('FileReader failed'))
        }
        reader.readAsDataURL(file)
      })
    }

    try {
      // Compress the image first — try main method, fall back to direct base64
      let base64: string
      try {
        base64 = await compressImage(file)
      } catch (compressErr) {
        sonnerToast.info('DEBUG: Main compression failed, trying fallback')
        base64 = await compressImageFallback(file)
      }
      sonnerToast.info('DEBUG: Compression done', { description: `${Math.round(base64.length / 1024)} KB` })
      setPreview(base64)
      setScanning(true)
      sonnerToast.info('DEBUG: Scanning started, calling API...')
      // Save existing items before scanning (for "adding more" mode)
      const existingItems = scanned?._isAddingMore ? (scanned?.items || []) : []
      const isAddingMore = scanned?._isAddingMore || false
      // Don't set scanned to null if we're adding more — keep showing items
      if (!isAddingMore) {
        setScanned(null)
      }
      try {
        // Step 1: Upload to Cloudinary (gets a URL, stores image for future)
        sonnerToast.info('DEBUG: Uploading to Cloudinary...')
        const uploadRes = await offlineFetch('/api/upload-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 }),
        })
        const uploadData = await uploadRes.json()
        sonnerToast.info('DEBUG: Upload result', { description: `success: ${uploadData.success}, url: ${uploadData.url ? 'yes' : 'no'}` })

        // Step 2: Send to AI scanner (use Cloudinary URL if upload succeeded, else base64)
        const imageUrl = uploadData.success ? uploadData.url : null
        sonnerToast.info('DEBUG: Calling scan API...', { description: imageUrl ? 'with URL' : 'with base64' })
        const scanRes = await offlineFetch('/api/scan-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(imageUrl ? { imageUrl, billType } : { imageBase64: base64, billType }),
        })
        const data = await scanRes.json()
        sonnerToast.info('DEBUG: Scan API response', { description: `error: ${data.error || 'none'}, bill: ${data.bill ? 'yes' : 'no'}, items: ${data.bill?.items?.length || 0}` })
        if (data.error) {
          sonnerToast.error('DEBUG: Scan failed', { description: data.error })
          toast({
            title: 'Scan failed',
            description: data.error,
            variant: 'destructive',
          })
          // Raw AI output logging removed — was leaking raw response to console
        } else {
          sonnerToast.success('DEBUG: Scan success!', { description: `${data.bill?.items?.length || 0} items found` })
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
            sonnerToast.success('Bill scanned! Review and verify the data.')
          }
        }
      } catch (e: any) {
        sonnerToast.error('DEBUG: API error', { description: String(e?.message || e) })
        toast({
          title: 'Scan failed',
          description: 'Please try again or enter manually',
          variant: 'destructive',
        })
      } finally {
        setScanning(false)
      }
    } catch (compressError: any) {
      sonnerToast.error('DEBUG: Compression error', { description: String(compressError?.message || compressError) })
      toast({
        title: 'Failed to process image',
        description: 'Please try a different image',
        variant: 'destructive',
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
    console.log('[Scanner] Take Photo clicked, native:', Capacitor.isNativePlatform())
    // VISIBLE DEBUG TOAST — shows on screen so we can see what's happening
    sonnerToast.info('DEBUG: Take Photo clicked', { description: `Native: ${Capacitor.isNativePlatform()}` })
    try {
      const file = await takePhotoNative()
      console.log('[Scanner] takePhotoNative returned:', file ? `${file.name} (${file.size} bytes)` : 'null')
      sonnerToast.info('DEBUG: Photo result', { description: file ? `Got file: ${file.name} (${file.size} bytes)` : 'Returned null — camera failed or cancelled' })
      if (file) {
        handleFile(file)
      } else if (!Capacitor.isNativePlatform()) {
        // Web fallback — trigger the hidden input with capture attribute
        cameraInputRef.current?.click()
      } else {
        toast({
          title: 'Camera unavailable',
          description: 'Camera may be in use by another app, or permission was denied. Check Android Settings → Apps → BahiKhata Pro → Permissions.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('[Scanner] handleTakePhoto error:', err)
      sonnerToast.error('DEBUG: Error', { description: String(err?.message || err) })
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
    console.log('[Scanner] Pick Photo clicked, native:', Capacitor.isNativePlatform())
    sonnerToast.info('DEBUG: Upload Image clicked', { description: `Native: ${Capacitor.isNativePlatform()}` })
    try {
      const file = await pickPhotoNative()
      console.log('[Scanner] pickPhotoNative returned:', file ? `${file.name} (${file.size} bytes)` : 'null')
      sonnerToast.info('DEBUG: Pick result', { description: file ? `Got file: ${file.name} (${file.size} bytes)` : 'Returned null' })
      if (file) {
        handleFile(file)
      } else if (!Capacitor.isNativePlatform()) {
        // Web fallback — trigger the hidden file input
        fileInputRef.current?.click()
      } else {
        toast({
          title: 'Photo picker unavailable',
          description: 'Could not open photo gallery. Check storage permissions in Android Settings.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('[Scanner] handlePickPhoto error:', err)
      sonnerToast.error('DEBUG: Error', { description: String(err?.message || err) })
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
                <div className="py-8">
                  <div className="relative w-20 h-20 mx-auto mb-4">
                    <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
                    <div className="absolute inset-2 rounded-full bg-primary/20 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    </div>
                  </div>
                  <h3 className="font-semibold text-lg">{t('scanner.scanning')}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{t('scanner.extracting')}</p>
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
        <div className="space-y-4">
          {/* Header with bill summary */}
          <Card className="shadow-card border-border/60 overflow-hidden">
            <div className={cn('p-4 text-white', billType === 'sale' ? 'bg-gradient-emerald' : 'bg-gradient-saffron')}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className="bg-white/20 text-white border-0 gap-1">
                    <Sparkles className="w-3 h-3" /> {t('scanner.ai_extracted')}
                  </Badge>
                  <span className="text-sm font-medium">{billType === 'sale' ? t('scanner.sales_bill') : t('scanner.purchase_bill')}</span>
                </div>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={handleReset}>
                  <X className="w-4 h-4" /> Start Over
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-white/70 uppercase">Invoice No.</p>
                  <p className="font-semibold text-sm">{scanned.invoiceNo || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/70 uppercase">Date</p>
                  <p className="font-semibold text-sm">{scanned.date || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/70 uppercase">Party</p>
                  <p className="font-semibold text-sm truncate">{scanned.sellerName || 'Walk-in'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-white/70 uppercase">Payment</p>
                  <p className="font-semibold text-sm capitalize">{scanned.paymentMode || 'cash'}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Items table - editable */}
          <Card className="shadow-card border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Items ({scanned.items.length})
                </CardTitle>
                <div className="flex gap-2">
                  {/* Manual add — for adding a blank row by hand */}
                  <Button variant="outline" size="sm" onClick={addItem} className="gap-1">
                    <Plus className="w-3.5 h-3.5" /> Manual
                  </Button>
                  {/* Scan more items — opens camera to scan another bill,
                      new items get APPENDED to existing list */}
                  <Button
                    size="sm"
                    onClick={() => {
                      // Keep existing items, mark as "adding more"
                      setScanned({ ...scanned, _isAddingMore: true })
                      setPreview('')
                      // Use native camera on Capacitor, otherwise the hidden input
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
                    className="bg-gradient-saffron gap-1"
                  >
                    <ScanLine className="w-3.5 h-3.5" /> Scan More Items
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {/* Header row */}
                <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] uppercase font-medium text-muted-foreground px-2">
                  <div className="col-span-4">Product Name</div>
                  <div className="col-span-2">Qty</div>
                  <div className="col-span-2">Unit Price</div>
                  <div className="col-span-1">GST%</div>
                  <div className="col-span-2 text-right">Total</div>
                  <div className="col-span-1"></div>
                </div>

                {scanned.items.map((item: any, i: number) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition">
                    {/* Product name — always editable */}
                    <div className="col-span-12 md:col-span-4">
                      <input
                        value={item.name}
                        onChange={(e) => updateItem(i, 'name', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm bg-transparent border border-transparent rounded-md focus:bg-background focus:border-border transition"
                        placeholder="Product name"
                      />
                    </div>
                    {/* Quantity — always editable */}
                    <div className="col-span-3 md:col-span-2">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))}
                        className="w-full px-2 py-1.5 text-sm bg-transparent border border-transparent rounded-md focus:bg-background focus:border-border transition"
                      />
                    </div>
                    {/* Unit price — always editable */}
                    <div className="col-span-4 md:col-span-2">
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(i, 'unitPrice', Number(e.target.value))}
                        className="w-full px-2 py-1.5 text-sm bg-transparent border border-transparent rounded-md focus:bg-background focus:border-border transition"
                      />
                    </div>
                    {/* GST — always editable */}
                    <div className="col-span-2 md:col-span-1">
                      <select
                        value={item.gstRate}
                        onChange={(e) => updateItem(i, 'gstRate', Number(e.target.value))}
                        className="w-full px-1 py-1.5 text-sm bg-transparent border border-transparent rounded-md focus:bg-background focus:border-border transition"
                      >
                        {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </div>
                    {/* Total (auto-calculated, read-only) */}
                    <div className="col-span-2 md:col-span-2 text-right">
                      <p className="text-sm font-semibold">{formatINR(item.total || 0)}</p>
                    </div>
                    {/* Delete */}
                    <div className="col-span-1 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50"
                        onClick={() => removeItem(i)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                {scanned.items.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No items. Click &quot;Add item&quot; to add manually.
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="mt-4 pt-4 border-t border-border space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatINR(subtotal)}</span>
                </div>
                {scanned.discountAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="font-medium text-rose-600">-{formatINR(scanned.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">GST Total</span>
                  <span className="font-medium">{formatINR(totalGst)}</span>
                </div>
                {(scanned.cgst > 0 || scanned.sgst > 0) && (
                  <div className="flex justify-between text-xs text-muted-foreground pl-4">
                    <span>CGST + SGST</span>
                    <span>{formatINR(scanned.cgst)} + {formatINR(scanned.sgst)}</span>
                  </div>
                )}
                {scanned.igst > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground pl-4">
                    <span>IGST</span>
                    <span>{formatINR(scanned.igst)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-border">
                  <span className="font-semibold">Grand Total</span>
                  <span className="text-lg font-bold">{formatINR(grandTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action buttons */}
          <Card className="shadow-card border-border/60">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Button variant="outline" className="flex-1 gap-2" onClick={handleReset}>
                  <X className="w-4 h-4" /> {t('scanner.discard')}
                </Button>
                <Button
                  className="flex-1 gap-2 bg-gradient-saffron shadow-md"
                  onClick={handleProceedToSave}
                >
                  <Check className="w-4 h-4" /> {t('scanner.verify_save')}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                You&apos;ll be taken to the {billType === 'sale' ? 'sales' : 'purchase'} form with everything pre-filled. Just review and save!
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
