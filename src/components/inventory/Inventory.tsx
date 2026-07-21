'use client'

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '@/hooks/use-translation'
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
import { EmptyState } from '@/components/common/EmptyState'
import { WakingUpState } from '@/components/common/WakingUpState'
import {
  Plus, Search, Package, AlertTriangle, Edit2, TrendingUp, IndianRupee,
  ChevronRight, Folder, FolderOpen, LayoutGrid, List, X, ScanLine,
  AlertCircle, RefreshCw,
} from 'lucide-react'
import { offlineFetch, isOnline, OfflineError } from '@/lib/offline-fetch'
import { OfflineNoData } from '@/components/common/OfflineNoData'
import { BarcodeScanner } from '@/components/common/BarcodeScanner'

export function Inventory() {
  const {
    refreshKey, triggerRefresh, inventoryViewMode, setInventoryViewMode,
    inventoryCategory, setInventoryCategory, triggerNewEntry, triggerNewEntryView,
    features,
  } = useAppStore()
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [subCategory, setSubCategory] = useState<string | null>(null)
  const [barcodeOpen, setBarcodeOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['products', refreshKey],
    queryFn: async () => {
      const r = await offlineFetch('/api/products')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    retry: (count, err) => {
      if (err instanceof OfflineError) return false
      if (err instanceof TypeError) return false
      return count < 2
    },
    // 🔒 FIX M12: Keep previous data while refetching.
    placeholderData: keepPreviousData,
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
      {/* Stats — show skeletons during loading */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
        <Card className="shadow-card border-border/60 border-t-4 border-t-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('stat.total_products')}</p>
            </div>
            <p className="text-xl font-bold">{products.length}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60 border-t-4 border-t-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('dash.stock_value')}</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalStockValue)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60 border-t-4 border-t-violet-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-violet-600" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('stat.potential_profit')}</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalPotentialProfit)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60 border-t-4 border-t-rose-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <p className="text-2xs text-muted-foreground uppercase tracking-wide font-medium">{t('stat.low_out_stock')}</p>
            </div>
            <p className="text-xl font-bold">{lowStockCount} <span className="text-sm text-muted-foreground">/ {outOfStockCount}</span></p>
          </CardContent>
        </Card>
          </>
        )}
      </div>

      {/* Category navigation */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Folder className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('inv.categories')}</p>
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
              <span className={cn('text-3xs', !inventoryCategory ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
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
                <span className={cn('text-3xs', inventoryCategory === cat ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
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
                placeholder={t('inv.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-12"
              />
              {features?.barcodeScanner && (
                <button
                  onClick={() => setBarcodeOpen(true)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-muted text-primary"
                  aria-label="Scan barcode"
                  title="Scan barcode"
                >
                  <ScanLine className="w-5 h-5" />
                </button>
              )}
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('inv.all_products')}</SelectItem>
                <SelectItem value="low">{t('inv.low_stock')}</SelectItem>
                <SelectItem value="out">{t('inv.out_stock')}</SelectItem>
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
      {!isOnline() && !!error && !data ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-0">
            <OfflineNoData
              title="No cached inventory"
              message="You're offline and your product list hasn't been cached yet. Connect to internet once to load it — after that, inventory works offline."
              onRetry={() => triggerRefresh()}
            />
          </CardContent>
        </Card>
      ) : isLoading ? (
        <WakingUpState rows={6} />
      ) : error && isOnline() ? (
        // 🔒 FIX H8: Was falling through to the empty state "No products yet"
        // when the API returned a 500 (DB cold start). Now shows a clear
        // error with retry.
        <Card className="shadow-card border-border/60">
          <CardContent className="py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6 text-rose-600" />
            </div>
            <p className="text-sm font-medium mb-1">Couldn't load inventory</p>
            <p className="text-xs text-muted-foreground mb-4">The database might be warming up. Please try again.</p>
            <Button variant="outline" size="sm" onClick={() => triggerRefresh()} className="gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-0">
            {products.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No products yet"
                description="Add your first product to start tracking inventory, stock levels, and profit margins. Use barcode or manual entry — your choice."
                action={{
                  label: 'Add Product',
                  onClick: () => { setEditingProduct(null); setDialogOpen(true) },
                }}
              />
            ) : (
              <EmptyState
                icon={Package}
                title="No products match your search"
                description="Try a different search term, category, or clear the filters to see all products."
                size="compact"
              />
            )}
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
                  <th className="py-3 px-2 font-medium text-right">{t('inv.buy_price')}</th>
                  <th className="py-3 px-2 font-medium text-right">{t('inv.sale_price')}</th>
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
                          {p.sku && <Badge variant="outline" className="text-3xs py-0">{p.sku}</Badge>}
                          {p.category && <Badge variant="secondary" className="text-3xs py-0">{p.category}</Badge>}
                          <Badge variant="outline" className="text-3xs py-0">GST {p.gstRate}%</Badge>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right">{formatINR(p.purchasePrice)}</td>
                      <td className="py-3 px-2 text-right">{formatINR(p.salePrice)}</td>
                      <td className={cn('py-3 px-2 text-right font-medium',
                        p.currentStock <= 0 ? 'text-rose-600' :
                        p.isLowStock ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                      )}>
                        {p.currentStock} <span className="text-3xs text-muted-foreground">{p.unit}</span>
                      </td>
                      <td className="py-3 px-2 text-right">{formatINR(p.stockValue)}</td>
                      <td className="py-3 px-2 text-right text-emerald-600 dark:text-emerald-400 font-medium">
                        {formatINR(profit)}
                        <span className="text-3xs text-muted-foreground ml-1">({margin.toFixed(0)}%)</span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        {p.isLowStock ? (
                          <Badge variant="destructive" className="text-3xs">
                            {p.currentStock <= 0 ? 'Out' : 'Low'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-3xs bg-emerald-100 text-emerald-700 dark:text-emerald-300">OK</Badge>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        <Button
                          variant="ghost"
                          size="iconTouch"
                          className="lg:size-8 lg:p-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                          onClick={() => { setEditingProduct(p); setDialogOpen(true) }}
                          aria-label="Edit product"
                        >
                          <Edit2 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
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

      {/* Barcode scanner — scan to search products by SKU/barcode */}
      {barcodeOpen && (
        <BarcodeScanner
          onScan={(code) => {
            // Search for the scanned code in the product list
            setSearch(code)
            setBarcodeOpen(false)
            // Check if any product matches
            const match = products.find((p: any) =>
              p.sku === code || p.barcode === code || p.name?.toLowerCase() === code.toLowerCase()
            )
            if (match) {
              sonnerToast.success(`Found: ${match.name}`)
            } else {
              sonnerToast.info(`No product matches barcode ${code}. You can add it as a new product.`)
            }
          }}
          onClose={() => setBarcodeOpen(false)}
        />
      )}
    </div>
  )
}

function ProductGridCard({ product: p, onEdit }: { product: any; onEdit: () => void }) {
  const { setView, setPreviousView } = useAppStore()
  const profit = (p.salePrice || 0) - (p.purchasePrice || 0)
  const margin = p.salePrice > 0 ? (profit / p.salePrice) * 100 : 0
  const stockPct = p.lowStockThreshold > 0
    ? Math.min(100, Math.max(0, (p.currentStock / (p.lowStockThreshold * 2)) * 100))
    : p.currentStock > 0 ? 100 : 0

  // 🔒 DI-2 (auditor spec): tap the OVERSOLD badge → opens New Purchase
  // pre-filled with this product + the shortfall quantity. Reduces the
  // friction of fixing negative stock (was: just a label, user had to
  // navigate manually).
  const handleOversoldTap = (e: React.MouseEvent) => {
    e.stopPropagation()
    const shortfall = Math.abs(p.currentStock)
    ;(window as any).__ledgerPreset = {
      type: 'purchase',
      data: {
        items: [{
          productId: p.id,
          name: p.name,
          quantity: shortfall,
          unitPrice: p.purchasePrice || 0,
          gstRate: p.gstRate || 0,
          unit: p.unit || 'pcs',
        }],
      },
    }
    setPreviousView('inventory')
    setView('new-purchase')
  }

  return (
    <Card className="shadow-card border-border/60 hover:shadow-md transition group cursor-pointer" onClick={onEdit}>
      <CardContent className="p-3">
        {/* Top row: Product icon + name + edit */}
        <div className="flex items-start gap-2.5 mb-3">
          {/* Product icon — colored circle with first letter */}
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm text-white',
            p.currentStock <= 0 ? 'bg-gradient-to-br from-rose-500 to-red-600' :
            p.isLowStock ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
            'bg-gradient-to-br from-blue-500 to-indigo-600'
          )}>
            {p.name?.charAt(0).toUpperCase() || <Package className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate">{p.name}</h3>
            <div className="flex flex-wrap items-center gap-1 mt-0.5">
              {p.category && <Badge variant="secondary" className="text-3xs py-0">{p.category}</Badge>}
              {p.sku && <span className="text-3xs text-muted-foreground font-mono">{p.sku}</span>}
            </div>
          </div>
          <Button
            variant="ghost"
            size="iconTouch"
            className="lg:size-8 lg:p-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 flex-shrink-0"
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            aria-label="Edit product"
          >
            <Edit2 className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
          </Button>
        </div>

        {/* Price row — sale price prominent, buy price secondary */}
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <p className="text-3xs text-muted-foreground uppercase">Sale Price</p>
            <p className="text-lg font-bold tabular-nums">{formatINR(p.salePrice)}</p>
          </div>
          <div className="text-right">
            <p className="text-3xs text-muted-foreground uppercase">Profit</p>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              +{formatINR(profit)}
              <span className="text-3xs text-muted-foreground ml-0.5">({margin.toFixed(0)}%)</span>
            </p>
          </div>
        </div>

        {/* Stock indicator — visual bar */}
        <div className="mt-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-3xs text-muted-foreground uppercase">Stock</span>
            <span className={cn(
              'text-xs font-bold tabular-nums',
              p.currentStock <= 0 ? 'text-rose-600' :
              p.isLowStock ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
            )}>
              {p.currentStock} {p.unit}
            </span>
          </div>
          {/* Stock level bar — visual indicator */}
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                p.currentStock <= 0 ? 'bg-rose-500' :
                p.isLowStock ? 'bg-amber-500' : 'bg-emerald-500'
              )}
              style={{ width: `${stockPct}%` }}
            />
          </div>
        </div>

        {/* Low stock alert / Oversold alert */}
        {p.currentStock < 0 ? (
          // 🔒 V11: Distinct OVERSOLD badge for negative stock (separate from "Out").
          // 🔒 DI-2 (auditor spec): badge is now a BUTTON — tap to open New
          // Purchase pre-filled with this product + the shortfall quantity.
          // Was: a non-interactive <div> that just displayed the warning.
          <button
            type="button"
            onClick={handleOversoldTap}
            className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-white bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800 active:scale-[0.98] transition rounded-md px-2 py-1.5 font-semibold min-h-[32px]"
            aria-label={`Record a purchase to fix oversold ${p.name}`}
          >
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">OVERSOLD — tap to record purchase (+{Math.abs(p.currentStock)} {p.unit || 'pcs'})</span>
          </button>
        ) : p.isLowStock ? (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 rounded-md px-2 py-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{p.currentStock <= 0 ? 'Out of stock!' : `Low stock (threshold: ${p.lowStockThreshold} ${p.unit})`}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
