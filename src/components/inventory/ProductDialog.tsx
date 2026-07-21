'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { track, EVENTS } from '@/lib/analytics'
import { TrendingUp } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { readError } from '@/lib/read-error'
import { useSetting } from '@/hooks/use-setting'

const GST_RATES = [0, 5, 12, 18, 28]
const UNITS = ['pcs', 'kg', 'gm', 'ltr', 'ml', 'm', 'box', 'dozen', 'packet']
// 🔒 V17 Audit §4.2: GST treatment options for GSTR-3B 3.1(c) breakdown
const GST_TREATMENTS = [
  { value: 'taxable', label: 'Taxable', desc: 'Normal GST applies' },
  { value: 'nil', label: 'Nil-rated', desc: '0% GST but taxable supply' },
  { value: 'exempt', label: 'Exempt', desc: 'No GST — not taxable' },
  { value: 'nonGst', label: 'Non-GST', desc: 'Outside GST scope' },
]

const EMPTY_FORM = {
  name: '', sku: '', hsn: '', category: '', unit: 'pcs',
  purchasePrice: '', salePrice: '', mrp: '', gstRate: '0',
  openingStock: '', lowStockThreshold: '5', notes: '',
  priceIncludesGst: false,
  gstTreatment: 'taxable',  // 🔒 V17 Audit §4.2
}

export function ProductDialog({ open, onOpenChange, product, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: any
  onSuccess?: () => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  // 🔒 R15-5 (Round 15): Read hideProfit so the margin preview box is hidden
  // for staff-with-hideProfit. Was: shown unconditionally when both prices > 0.
  const { hideProfit } = useSetting()

  // Sync form when dialog opens or product changes
  useEffect(() => {
    if (open) {
      if (product) {
        setForm({
          name: product.name || '',
          sku: product.sku || '',
          hsn: product.hsn || '',
          category: product.category || '',
          unit: product.unit || 'pcs',
          purchasePrice: String(product.purchasePrice ?? ''),
          salePrice: String(product.salePrice ?? ''),
          mrp: product.mrp ? String(product.mrp) : '',
          gstRate: String(product.gstRate ?? 0),
          openingStock: String(product.openingStock ?? ''),
          lowStockThreshold: String(product.lowStockThreshold ?? 5),
          notes: product.notes || '',
          priceIncludesGst: product.priceIncludesGst ?? false,
          gstTreatment: product.gstTreatment || 'taxable',  // 🔒 V17 Audit §4.2
        })
      } else {
        setForm(EMPTY_FORM)
      }
    }
  }, [open, product])

  const handleSave = async () => {
    if (!form.name.trim()) {
      sonnerToast.error('Product name required')
      return
    }
    // 🔒 V17 Audit Phase 1 P1.5: Client-side check for contradictory gstRate + gstTreatment.
    // Exempt/Non-GST products must have gstRate=0. The Zod schema also enforces this
    // server-side, but the client-side check gives immediate feedback before the API call.
    const gstRateNum = parseFloat(form.gstRate) || 0
    if ((form.gstTreatment === 'exempt' || form.gstTreatment === 'nonGst') && gstRateNum > 0) {
      sonnerToast.error('Contradictory GST settings', {
        description: `${form.gstTreatment === 'exempt' ? 'Exempt' : 'Non-GST'} products must have GST rate 0%. Change the GST rate to 0% or set GST Treatment to Taxable/Nil-rated.`,
      })
      return
    }
    // 🔒 R15-6 (Round 15): Client-side validation for negative values.
    // parseFloat("-50") || 0 = -50 (truthy) — the old code would send -50 to
    // the server, which rejects via zod with a 400. The user got a generic
    // error instead of inline guidance. Now: catch negatives before the API call.
    const purchasePriceNum = parseFloat(form.purchasePrice) || 0
    const salePriceNum = parseFloat(form.salePrice) || 0
    const openingStockNum = parseFloat(form.openingStock) || 0
    const lowStockThresholdNum = parseFloat(form.lowStockThreshold) || 0
    if (purchasePriceNum < 0 || salePriceNum < 0 || openingStockNum < 0 || lowStockThresholdNum < 0) {
      sonnerToast.error('Prices, stock, and thresholds cannot be negative', {
        description: 'Please enter zero or positive values only.',
      })
      return
    }
    setSaving(true)
    try {
      const url = product ? `/api/products?id=${product.id}` : '/api/products'
      const method = product ? 'PUT' : 'POST'
      // 🔒 FIX: Convert string form values to numbers before sending.
      // The form stores all numeric fields as strings (e.g., purchasePrice: "95")
      // because HTML inputs return strings. But the server's zod schema expects
      // numbers (z.number(), not z.string()). Without this conversion, every
      // product create/update fails with a 400 "Expected number, received string".
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        hsn: form.hsn.trim() || null,
        category: form.category.trim() || null,
        unit: form.unit || 'pcs',
        purchasePrice: parseFloat(form.purchasePrice) || 0,
        salePrice: parseFloat(form.salePrice) || 0,
        mrp: form.mrp ? parseFloat(form.mrp) : null,
        gstRate: parseFloat(form.gstRate) || 0,
        openingStock: parseFloat(form.openingStock) || 0,
        lowStockThreshold: parseFloat(form.lowStockThreshold) || 0,
        notes: form.notes.trim() || null,
        priceIncludesGst: form.priceIncludesGst,
        gstTreatment: form.gstTreatment,  // 🔒 V17 Audit §4.2
      }
      const r = await offlineFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        offline: { invalidate: ['/api/products', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      if (isQueuedResponse(r)) {
        sonnerToast.success('Saved offline — will sync when online')
      } else {
        sonnerToast.success(product ? 'Product updated' : 'Product added successfully')
        // 🔒 V20-025: Track product added/updated event
        if (!product) {
          track(EVENTS.PRODUCT_ADDED, { gstRate: payload.gstRate, unit: payload.unit })
        }
      }
      haptic.success()
      onSuccess?.()
      onOpenChange(false)
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || "Couldn\'t save the product")
    } finally {
      setSaving(false)
    }
  }

  const purchasePrice = parseFloat(form.purchasePrice) || 0
  const salePrice = parseFloat(form.salePrice) || 0
  const profit = salePrice - purchasePrice
  const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? 'Edit Product' : 'Add New Product'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <div className="sm:col-span-2">
            <Label htmlFor="field-product-name">Product Name *</Label>
            <Input id="field-product-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aashirvaad Atta 5kg" />
          </div>
          <div>
            <Label htmlFor="field-sku-code">SKU / Code</Label>
            <Input id="field-sku-code" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. ATA001" />
          </div>
          <div>
            <Label htmlFor="field-category">Category</Label>
            <Input id="field-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Flour" />
          </div>
          <div>
            <Label htmlFor="field-hsn-sac-code">HSN/SAC Code</Label>
            <Input id="field-hsn-sac-code" value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} placeholder="e.g. 1101" />
          </div>
          <div>
            <Label htmlFor="field-unit">Unit</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="field-purchase-price">Purchase Price (₹) *</Label>
            <Input id="field-purchase-price" type="number" inputMode="decimal" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label htmlFor="field-sale-price">Sale Price (₹) *</Label>
            <Input id="field-sale-price" type="number" inputMode="decimal" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label htmlFor="field-mrp">MRP (₹)</Label>
            <Input id="field-mrp" type="number" inputMode="decimal" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} placeholder="optional" />
          </div>
          <div>
            <Label htmlFor="field-gst-rate">GST Rate (%)</Label>
            <Select value={form.gstRate} onValueChange={(v) => setForm({ ...form, gstRate: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {/* 🔒 V17 Audit §4.2: GST treatment — for GSTR-3B 3.1(c) nil/exempt/non-GST breakdown */}
          <div>
            <Label htmlFor="field-gst-treatment">GST Treatment</Label>
            <Select value={form.gstTreatment} onValueChange={(v) => setForm({ ...form, gstTreatment: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GST_TREATMENTS.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-3xs text-muted-foreground">{t.desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* 🔒 V12: MRP / GST-inclusive pricing. When on, the Sale Price is
              treated as already including GST (the Indian retail norm) and the
              taxable value is back-calculated at sale time. */}
          <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-border/60 p-3">
            <input
              id="priceIncludesGst"
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
              checked={form.priceIncludesGst}
              onChange={(e) => setForm({ ...form, priceIncludesGst: e.target.checked })}
            />
            <label htmlFor="priceIncludesGst" className="text-sm cursor-pointer">
              <span className="font-medium">Sale price includes GST (MRP)</span>
              <span className="block text-xs text-muted-foreground">
                Turn on for MRP-priced goods (packaged items). GST is taken out of the price instead of added on top.
              </span>
            </label>
          </div>
          <div>
            <Label htmlFor="field-opening-stock">Opening Stock</Label>
            <Input id="field-opening-stock" type="number" inputMode="decimal" value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label htmlFor="field-low-stock-alert-at">Low Stock Alert At</Label>
            <Input id="field-low-stock-alert-at" type="number" inputMode="decimal" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} placeholder="5" />
          </div>
        </div>

        {/* 🔒 R15-5 (Round 15): Hide profit preview for hideProfit.
            Staff with hideProfit must not see the margin calculation. */}
        {!hideProfit && purchasePrice > 0 && salePrice > 0 && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                Profit per unit: {formatINR(profit)}
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Margin: {margin.toFixed(1)}%
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-saffron">
            {saving ? 'Saving...' : (product ? 'Update Product' : 'Add Product')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
