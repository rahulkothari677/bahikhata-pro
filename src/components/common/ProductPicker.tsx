'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Package, ChevronDown, X, Folder } from 'lucide-react'
import { cn, formatINR } from '@/lib/utils'

export type ProductSelectValue = {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  gstRate: number
  unit: string
}

export function ProductPicker({
  value,
  onChange,
  isSale,
}: {
  value: ProductSelectValue
  onChange: (v: ProductSelectValue) => void
  isSale: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const { data: productsData } = useQuery({
    queryKey: ['products', 'for-picker'],
    queryFn: async () => {
      const r = await fetch('/api/products')
      return r.json()
    },
  })

  const products: any[] = productsData?.products || []

  // Build categories
  const categories = Array.from(new Set(products.map(p => p.category || 'Uncategorized'))).sort()
  const categoryCounts = new Map<string, number>()
  products.forEach(p => {
    const cat = p.category || 'Uncategorized'
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
  })

  const filtered = products.filter(p => {
    if (categoryFilter && (p.category || 'Uncategorized') !== categoryFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.hsn?.toLowerCase().includes(q)
    }
    return true
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (product: any) => {
    // Auto-fill all fields from inventory
    onChange({
      productId: product.id,
      productName: product.name,
      quantity: value.quantity || 1,
      unitPrice: isSale ? product.salePrice : product.purchasePrice,
      gstRate: product.gstRate,
      unit: product.unit,
    })
    setOpen(false)
    setSearch('')
    setCategoryFilter(null)
  }

  const handleClear = () => {
    onChange({
      productId: '',
      productName: '',
      quantity: 1,
      unitPrice: 0,
      gstRate: 0,
      unit: 'pcs',
    })
  }

  const selectedProduct = products.find(p => p.id === value.productId)

  return (
    <div className="relative" ref={ref}>
      {selectedProduct ? (
        <div className="flex items-center gap-2 p-2 border border-border rounded-lg bg-muted/30">
          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Package className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedProduct.name}</p>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{formatINR(value.unitPrice)}</span>
              <span>•</span>
              <span>GST {value.gstRate}%</span>
              {selectedProduct.currentStock !== undefined && (
                <>
                  <span>•</span>
                  <span className={cn(
                    selectedProduct.currentStock <= 0 ? 'text-rose-600' :
                    selectedProduct.isLowStock ? 'text-amber-600' : 'text-emerald-600'
                  )}>
                    Stock: {selectedProduct.currentStock} {selectedProduct.unit}
                  </span>
                </>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleClear}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search product by name, SKU, HSN..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            className="pl-9"
          />
        </div>
      )}

      {/* Dropdown with category filter */}
      {open && !selectedProduct && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-lg shadow-lg">
          {/* Category filter chips */}
          {categories.length > 1 && (
            <div className="p-2 border-b border-border flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              <button
                onClick={() => setCategoryFilter(null)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-medium transition',
                  !categoryFilter ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                )}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                  className={cn(
                    'px-2 py-0.5 rounded text-[10px] font-medium transition flex items-center gap-1',
                    categoryFilter === cat ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <Folder className="w-2.5 h-2.5" />
                  {cat}
                  <span className="opacity-60">{categoryCounts.get(cat)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Product list */}
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-4 text-center">
                <Package className="w-8 h-8 mx-auto text-muted-foreground/50 mb-1" />
                <p className="text-xs text-muted-foreground">
                  {search ? `No products match "${search}"` : 'No products in inventory'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Add products in Inventory first, or type a custom name below
                </p>
              </div>
            ) : (
              filtered.slice(0, 30).map(p => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  className="w-full flex items-center gap-2 p-2 hover:bg-muted transition text-left border-b border-border/30 last:border-0"
                >
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {p.category && <Badge variant="outline" className="text-[9px] py-0">{p.category}</Badge>}
                      <span>{formatINR(isSale ? p.salePrice : p.purchasePrice)}</span>
                      <span>•</span>
                      <span>GST {p.gstRate}%</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={cn(
                      'text-[11px] font-medium',
                      p.currentStock <= 0 ? 'text-rose-600' :
                      p.isLowStock ? 'text-amber-600' : 'text-emerald-600'
                    )}>
                      {p.currentStock} {p.unit}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Custom name fallback */}
          {search && filtered.length === 0 && (
            <div className="p-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  onChange({
                    productId: '',
                    productName: search,
                    quantity: value.quantity || 1,
                    unitPrice: 0,
                    gstRate: 0,
                    unit: 'pcs',
                  })
                  setOpen(false)
                  setSearch('')
                }}
              >
                Use &quot;{search}&quot; as custom product
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
