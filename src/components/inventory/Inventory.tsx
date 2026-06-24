'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { toast as sonnerToast } from 'sonner'
import { useToast } from '@/hooks/use-toast'
import { formatINR, cn } from '@/lib/utils'
import { ProductDialog } from './ProductDialog'
import { Plus, Search, Package, AlertTriangle, Edit2, TrendingUp, IndianRupee } from 'lucide-react'

export function Inventory() {
  const { refreshKey, triggerRefresh } = useAppStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['products', refreshKey],
    queryFn: async () => {
      const r = await fetch('/api/products')
      return r.json()
    },
  })

  const products: any[] = data?.products || []

  const filtered = products.filter(p => {
    if (search) {
      const q = search.toLowerCase()
      const matchSearch = p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.hsn?.toLowerCase().includes(q)
      if (!matchSearch) return false
    }
    if (filter === 'low' && !p.isLowStock) return false
    if (filter === 'out' && p.currentStock > 0) return false
    return true
  })

  const lowStockCount = products.filter(p => p.isLowStock).length
  const outOfStockCount = products.filter(p => p.currentStock <= 0).length
  const totalStockValue = products.reduce((s, p) => s + (p.stockValue || 0), 0)
  const totalPotentialProfit = products.reduce((s, p) => s + ((p.currentStock || 0) * ((p.salePrice || 0) - (p.purchasePrice || 0))), 0)

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this product? This cannot be undone.')) return
    const r = await fetch(`/api/products?id=${id}`, { method: 'DELETE' })
    if (r.ok) {
      sonnerToast.success('Product deleted')
      triggerRefresh()
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-amber-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Total Products</p>
            </div>
            <p className="text-xl font-bold">{products.length}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee className="w-4 h-4 text-emerald-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Stock Value</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalStockValue)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-violet-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Potential Profit</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalPotentialProfit)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Low/Out of Stock</p>
            </div>
            <p className="text-xl font-bold">{lowStockCount} <span className="text-sm text-muted-foreground">/ {outOfStockCount}</span></p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products, SKU, HSN, category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                <SelectItem value="low">Low Stock</SelectItem>
                <SelectItem value="out">Out of Stock</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => { setEditingProduct(null); setDialogOpen(true) }}
              className="bg-gradient-saffron gap-2 shadow-md"
            >
              <Plus className="w-4 h-4" /> Add Product
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Products list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="py-16 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium">No products found</p>
            <p className="text-xs text-muted-foreground mt-1">
              {products.length === 0 ? 'Add your first product to start tracking inventory' : 'Try a different search'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p) => {
            const profit = (p.salePrice || 0) - (p.purchasePrice || 0)
            const margin = p.salePrice > 0 ? (profit / p.salePrice) * 100 : 0
            return (
              <Card key={p.id} className="shadow-card border-border/60 hover:shadow-md transition group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate">{p.name}</h3>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {p.sku && <Badge variant="outline" className="text-[10px] py-0">{p.sku}</Badge>}
                        {p.category && <Badge variant="secondary" className="text-[10px] py-0">{p.category}</Badge>}
                        <Badge variant="outline" className="text-[10px] py-0">GST {p.gstRate}%</Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                      onClick={() => { setEditingProduct(p); setDialogOpen(true) }}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mt-3">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">Buy Price</p>
                      <p className="font-semibold mt-0.5">{formatINR(p.purchasePrice)}</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">Sale Price</p>
                      <p className="font-semibold mt-0.5">{formatINR(p.salePrice)}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Stock</p>
                      <p className={cn(
                        'text-sm font-semibold',
                        p.currentStock <= 0 ? 'text-rose-600' :
                        p.isLowStock ? 'text-amber-600' : 'text-emerald-600'
                      )}>
                        {p.currentStock} {p.unit}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase">Profit / unit</p>
                      <p className="text-sm font-semibold text-emerald-600">
                        {formatINR(profit)}
                        <span className="text-[10px] text-muted-foreground ml-1">({margin.toFixed(0)}%)</span>
                      </p>
                    </div>
                  </div>

                  {p.isLowStock && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 rounded-md px-2 py-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>{p.currentStock <= 0 ? 'Out of stock! Restock immediately' : `Below threshold (${p.lowStockThreshold} ${p.unit})`}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editingProduct}
        onSuccess={() => triggerRefresh()}
      />
    </div>
  )
}
