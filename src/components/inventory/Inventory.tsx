'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { toast as sonnerToast } from 'sonner'
import { formatINR, cn } from '@/lib/utils'
import { ProductDialog } from './ProductDialog'
import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import {
  Plus, Search, Package, AlertTriangle, Edit2, TrendingUp, IndianRupee,
  ChevronRight, Folder, FolderOpen, LayoutGrid, List, X,
} from 'lucide-react'

export function Inventory() {
  const {
    refreshKey, triggerRefresh, inventoryViewMode, setInventoryViewMode,
    inventoryCategory, setInventoryCategory, triggerNewEntry, triggerNewEntryView,
  } = useAppStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [subCategory, setSubCategory] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['products', refreshKey],
    queryFn: async () => {
      const r = await fetch('/api/products')
      return r.json()
    },
  })

  const products: any[] = data?.products || []

  // Listen for global "New Entry" trigger from Header (only if it was fired on this view)
  const lastTriggerRef = useRef(0)
  useEffect(() => {
    if (triggerNewEntry > lastTriggerRef.current && triggerNewEntryView === 'inventory') {
      lastTriggerRef.current = triggerNewEntry
      Promise.resolve().then(() => {
        setEditingProduct(null)
        setDialogOpen(true)
      })
    } else if (triggerNewEntry > lastTriggerRef.current) {
      lastTriggerRef.current = triggerNewEntry
    }
  }, [triggerNewEntry, triggerNewEntryView])

  // Build category tree
  const categoryTree = new Map<string, Set<string>>()
  products.forEach(p => {
    const cat = p.category || 'Uncategorized'
    if (!categoryTree.has(cat)) categoryTree.set(cat, new Set())
    // Sub-category: derive from name pattern or use empty
    // For now, we use category as primary grouping
  })

  const categories = Array.from(categoryTree.keys()).sort()
  const categoryCounts = new Map<string, number>()
  const categoryValues = new Map<string, number>()
  products.forEach(p => {
    const cat = p.category || 'Uncategorized'
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
    categoryValues.set(cat, (categoryValues.get(cat) || 0) + (p.stockValue || 0))
  })

  const filtered = products.filter(p => {
    if (inventoryCategory && (p.category || 'Uncategorized') !== inventoryCategory) return false
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

      {/* Category navigation */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Folder className="w-4 h-4 text-amber-600" />
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setInventoryCategory(null)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border',
                !inventoryCategory
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted'
              )}
            >
              All Products
              <span className={cn('text-[10px]', !inventoryCategory ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                {products.length}
              </span>
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setInventoryCategory(inventoryCategory === cat ? null : cat)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border',
                  inventoryCategory === cat
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-muted'
                )}
              >
                {inventoryCategory === cat ? <FolderOpen className="w-3 h-3" /> : <Folder className="w-3 h-3" />}
                {cat}
                <span className={cn('text-[10px]', inventoryCategory === cat ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                  {categoryCounts.get(cat) || 0}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Toolbar - removed duplicate Add Product button (it's in header now) */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products, SKU, HSN..."
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
            <ViewModeToggle mode={inventoryViewMode} onChange={setInventoryViewMode} />
          </div>

          {/* Breadcrumb for active category */}
          {inventoryCategory && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
              <button onClick={() => setInventoryCategory(null)} className="hover:text-foreground">
                All Products
              </button>
              <ChevronRight className="w-3 h-3" />
              <span className="text-foreground font-medium">{inventoryCategory}</span>
              <span>• {categoryCounts.get(inventoryCategory)} products • {formatINR(categoryValues.get(inventoryCategory) || 0)} value</span>
              <button onClick={() => setInventoryCategory(null)} className="ml-2 hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Products - Grid or List */}
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
              {products.length === 0 ? 'Add your first product to start tracking inventory' : 'Try a different search or category'}
            </p>
          </CardContent>
        </Card>
      ) : inventoryViewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProductGridCard key={p.id} product={p} onEdit={() => { setEditingProduct(p); setDialogOpen(true) }} />
          ))}
        </div>
      ) : (
        <Card className="shadow-card border-border/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 px-4 font-medium">Product</th>
                  <th className="py-3 px-2 font-medium text-right">Buy Price</th>
                  <th className="py-3 px-2 font-medium text-right">Sale Price</th>
                  <th className="py-3 px-2 font-medium text-right">Stock</th>
                  <th className="py-3 px-2 font-medium text-right">Value</th>
                  <th className="py-3 px-2 font-medium text-right">Profit/unit</th>
                  <th className="py-3 px-2 font-medium text-center">Status</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const profit = (p.salePrice || 0) - (p.purchasePrice || 0)
                  const margin = p.salePrice > 0 ? (profit / p.salePrice) * 100 : 0
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 group">
                      <td className="py-3 px-4">
                        <div className="font-medium">{p.name}</div>
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          {p.sku && <Badge variant="outline" className="text-[10px] py-0">{p.sku}</Badge>}
                          {p.category && <Badge variant="secondary" className="text-[10px] py-0">{p.category}</Badge>}
                          <Badge variant="outline" className="text-[10px] py-0">GST {p.gstRate}%</Badge>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right">{formatINR(p.purchasePrice)}</td>
                      <td className="py-3 px-2 text-right">{formatINR(p.salePrice)}</td>
                      <td className={cn('py-3 px-2 text-right font-medium',
                        p.currentStock <= 0 ? 'text-rose-600' :
                        p.isLowStock ? 'text-amber-600' : 'text-emerald-600'
                      )}>
                        {p.currentStock} <span className="text-[10px] text-muted-foreground">{p.unit}</span>
                      </td>
                      <td className="py-3 px-2 text-right">{formatINR(p.stockValue)}</td>
                      <td className="py-3 px-2 text-right text-emerald-600 font-medium">
                        {formatINR(profit)}
                        <span className="text-[10px] text-muted-foreground ml-1">({margin.toFixed(0)}%)</span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        {p.isLowStock ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {p.currentStock <= 0 ? 'Out' : 'Low'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">OK</Badge>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                          onClick={() => { setEditingProduct(p); setDialogOpen(true) }}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
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

function ProductGridCard({ product: p, onEdit }: { product: any; onEdit: () => void }) {
  const profit = (p.salePrice || 0) - (p.purchasePrice || 0)
  const margin = p.salePrice > 0 ? (profit / p.salePrice) * 100 : 0
  return (
    <Card className="shadow-card border-border/60 hover:shadow-md transition group cursor-pointer" onClick={onEdit}>
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
            onClick={(e) => { e.stopPropagation(); onEdit() }}
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
}
