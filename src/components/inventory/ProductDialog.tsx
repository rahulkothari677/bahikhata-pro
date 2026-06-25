'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { TrendingUp } from 'lucide-react'
import { formatINR } from '@/lib/utils'

const GST_RATES = [0, 5, 12, 18, 28]
const UNITS = ['pcs', 'kg', 'gm', 'ltr', 'ml', 'm', 'box', 'dozen', 'packet']

const EMPTY_FORM = {
  name: '', sku: '', hsn: '', category: '', unit: 'pcs',
  purchasePrice: '', salePrice: '', mrp: '', gstRate: '0',
  openingStock: '', lowStockThreshold: '5', notes: '',
}

export function ProductDialog({ open, onOpenChange, product, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: any
  onSuccess?: () => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

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
        })
      } else {
        setForm(EMPTY_FORM)
      }
    }
  }, [open, product])

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Product name required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const url = product ? `/api/products?id=${product.id}` : '/api/products'
      const method = product ? 'PUT' : 'POST'
      const r = await offlineFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        offline: { invalidate: ['/api/products', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success(product ? 'Product updated' : 'Product added successfully')
      onSuccess?.()
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Failed to save product', variant: 'destructive' })
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
            <Label>Product Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aashirvaad Atta 5kg" />
          </div>
          <div>
            <Label>SKU / Code</Label>
            <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. ATA001" />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Flour" />
          </div>
          <div>
            <Label>HSN/SAC Code</Label>
            <Input value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} placeholder="e.g. 1101" />
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Purchase Price (₹) *</Label>
            <Input type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label>Sale Price (₹) *</Label>
            <Input type="number" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label>MRP (₹)</Label>
            <Input type="number" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} placeholder="optional" />
          </div>
          <div>
            <Label>GST Rate (%)</Label>
            <Select value={form.gstRate} onValueChange={(v) => setForm({ ...form, gstRate: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Opening Stock</Label>
            <Input type="number" value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} placeholder="0" />
          </div>
          <div>
            <Label>Low Stock Alert At</Label>
            <Input type="number" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} placeholder="5" />
          </div>
        </div>

        {purchasePrice > 0 && salePrice > 0 && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-emerald-700">
                Profit per unit: {formatINR(profit)}
              </p>
              <p className="text-xs text-emerald-600">
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
