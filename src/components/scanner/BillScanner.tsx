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
  ImageIcon, FileText, ArrowRight, Trash2, ShoppingCart, Truck,
} from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'

export function BillScanner() {
  const { t } = useTranslation()
  const { setView, scannerBillType, setScannerBillType, setScannerResult } = useAppStore()
  const { toast } = useToast()
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<any>(null)
  const [preview, setPreview] = useState<string>('')
  const [billType, setBillType] = useState<'sale' | 'purchase'>(scannerBillType)
  const [editMode, setEditMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file) return
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
    const compressImage = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const img = new Image()
          img.onload = () => {
            // Max dimensions: 1200x1600 (enough for AI to read, small enough for API)
            const MAX_WIDTH = 1200
            const MAX_HEIGHT = 1600
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

            // Compress as JPEG with quality 0.85
            const compressed = canvas.toDataURL('image/jpeg', 0.85)
            resolve(compressed)
          }
          img.onerror = () => reject(new Error('Failed to load image'))
          img.src = e.target?.result as string
        }
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
    }

    try {
      // Compress the image first
      const base64 = await compressImage(file)
      setPreview(base64)
      setScanning(true)
      setScanned(null)
      try {
        // Step 1: Upload to Cloudinary (gets a URL, stores image for future)
        const uploadRes = await offlineFetch('/api/upload-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 }),
        })
        const uploadData = await uploadRes.json()

        // Step 2: Send to AI scanner (use Cloudinary URL if upload succeeded, else base64)
        const imageUrl = uploadData.success ? uploadData.url : null
        const scanRes = await offlineFetch('/api/scan-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(imageUrl ? { imageUrl, billType } : { imageBase64: base64, billType }),
        })
        const data = await scanRes.json()
        if (data.error) {
          toast({
            title: 'Scan failed',
            description: data.error,
            variant: 'destructive',
          })
          if (data.rawContent) {
            console.log('Raw AI output:', data.rawContent)
          }
        } else {
          setScanned(data.bill)
          sonnerToast.success('Bill scanned! Review and verify the data.')
        }
      } catch (e) {
        toast({
          title: 'Scan failed',
          description: 'Please try again or enter manually',
          variant: 'destructive',
        })
      } finally {
        setScanning(false)
      }
    } catch (compressError) {
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
                      onClick={() => cameraInputRef.current?.click()}
                      className="bg-gradient-saffron gap-2 shadow-lg"
                    >
                      <Camera className="w-5 h-5" /> {t('scanner.take_photo')}
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </CardContent>
          </Card>
        </>
      )}

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
                  <Button variant="outline" size="sm" onClick={() => setEditMode(!editMode)} className="gap-1">
                    {editMode ? <Check className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                    {editMode ? 'Done editing' : 'Edit items'}
                  </Button>
                  <Button size="sm" onClick={addItem} className="bg-gradient-saffron gap-1">
                    <ScanLine className="w-3.5 h-3.5" /> Add item
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
                    <div className="col-span-12 md:col-span-4">
                      {editMode ? (
                        <input
                          value={item.name}
                          onChange={(e) => updateItem(i, 'name', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md"
                        />
                      ) : (
                        <p className="text-sm font-medium truncate">{item.name || '—'}</p>
                      )}
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      {editMode ? (
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md"
                        />
                      ) : (
                        <p className="text-sm">{item.quantity} {item.unit || 'pcs'}</p>
                      )}
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      {editMode ? (
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(i, 'unitPrice', Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md"
                        />
                      ) : (
                        <p className="text-sm">{formatINR(item.unitPrice || 0)}</p>
                      )}
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      {editMode ? (
                        <select
                          value={item.gstRate}
                          onChange={(e) => updateItem(i, 'gstRate', Number(e.target.value))}
                          className="w-full px-1 py-1.5 text-sm bg-background border border-border rounded-md"
                        >
                          {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      ) : (
                        <p className="text-sm">{item.gstRate || 0}%</p>
                      )}
                    </div>
                    <div className="col-span-2 md:col-span-2 text-right">
                      <p className="text-sm font-semibold">{formatINR(item.total || 0)}</p>
                    </div>
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
