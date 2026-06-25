'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, ShoppingCart, Truck, Package, Users, Receipt, ArrowRight, TrendingUp, IndianRupee } from 'lucide-react'
import { cn, formatINR, formatDate } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'

type SearchResult = {
  type: 'product' | 'party' | 'transaction'
  id: string
  title: string
  subtitle: string
  meta?: string
  icon: any
  color: string
}

export function GlobalSearch() {
  const { searchOpen, setSearchOpen, setView, setSelectedTransactionId, setSelectedPartyId, setPreviousView } = useAppStore()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: productsData } = useQuery({
    queryKey: ['products', 'search'],
    queryFn: async () => {
      const r = await offlineFetch('/api/products')
      return r.json()
    },
    enabled: searchOpen,
  })

  const { data: partiesData } = useQuery({
    queryKey: ['parties', 'search'],
    queryFn: async () => {
      const r = await offlineFetch('/api/parties')
      return r.json()
    },
    enabled: searchOpen,
  })

  const { data: txnData } = useQuery({
    queryKey: ['transactions', 'search'],
    queryFn: async () => {
      const r = await offlineFetch('/api/transactions?type=all&limit=200')
      return r.json()
    },
    enabled: searchOpen,
  })

  useEffect(() => {
    if (searchOpen) {
      Promise.resolve().then(() => {
        setQuery('')
        setSelectedIndex(0)
        setTimeout(() => inputRef.current?.focus(), 100)
      })
    }
  }, [searchOpen])

  // Build search results
  const results: SearchResult[] = []
  const q = query.toLowerCase().trim()

  if (q) {
    // Products
    ;(productsData?.products || []).filter((p: any) =>
      p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.hsn?.includes(q)
    ).slice(0, 5).forEach((p: any) => {
      results.push({
        type: 'product',
        id: p.id,
        title: p.name,
        subtitle: `${p.category || 'Uncategorized'} • Stock: ${p.currentStock} ${p.unit}`,
        meta: formatINR(p.salePrice),
        icon: Package,
        color: 'text-amber-600',
      })
    })

    // Parties
    ;(partiesData?.parties || []).filter((p: any) =>
      p.name?.toLowerCase().includes(q) || p.phone?.includes(q) || p.gstin?.toLowerCase().includes(q)
    ).slice(0, 5).forEach((p: any) => {
      results.push({
        type: 'party',
        id: p.id,
        title: p.name,
        subtitle: `${p.phone || 'No phone'} • ${p.type}`,
        meta: p.balance !== 0 ? formatINR(p.balance) : undefined,
        icon: Users,
        color: p.type === 'customer' ? 'text-emerald-600' : 'text-amber-600',
      })
    })

    // Transactions
    ;(txnData?.transactions || []).filter((t: any) =>
      t.invoiceNo?.toLowerCase().includes(q) || t.party?.name?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q)
    ).slice(0, 5).forEach((t: any) => {
      results.push({
        type: 'transaction',
        id: t.id,
        title: t.invoiceNo || `${t.type} - ${t.party?.name || 'Walk-in'}`,
        subtitle: `${t.party?.name || 'Walk-in'} • ${formatDate(t.date)} • ${t.items?.length || 0} items`,
        meta: formatINR(t.totalAmount),
        icon: t.type === 'sale' ? ShoppingCart : t.type === 'purchase' ? Truck : Receipt,
        color: t.type === 'sale' ? 'text-emerald-600' : t.type === 'purchase' ? 'text-amber-600' : 'text-violet-600',
      })
    })
  }

  // Quick navigation suggestions when no query
  const quickNav = !q ? [
    { type: 'nav', id: 'dashboard', title: 'Dashboard', subtitle: 'View overview & charts', icon: TrendingUp, color: 'text-primary', view: 'dashboard' as const },
    { type: 'nav', id: 'new-sale', title: 'New Sale', subtitle: 'Record a new sale', icon: ShoppingCart, color: 'text-emerald-600', view: 'new-sale' as const },
    { type: 'nav', id: 'scanner', title: 'AI Bill Scanner', subtitle: 'Scan a bill with AI', icon: Receipt, color: 'text-amber-600', view: 'scanner' as const },
    { type: 'nav', id: 'inventory', title: 'Inventory', subtitle: 'Manage products', icon: Package, color: 'text-violet-600', view: 'inventory' as const },
    { type: 'nav', id: 'reports', title: 'Reports', subtitle: 'P&L, GST, stock reports', icon: IndianRupee, color: 'text-rose-600', view: 'reports' as const },
  ] : []

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'product') {
      setPreviousView(useAppStore.getState().currentView)
      setView('inventory')
    } else if (result.type === 'party') {
      setSelectedPartyId(result.id)
      setPreviousView(useAppStore.getState().currentView)
      setView('party-profile')
    } else if (result.type === 'transaction') {
      setSelectedTransactionId(result.id)
      setPreviousView(useAppStore.getState().currentView)
      setView('transaction-detail')
    }
    setSearchOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault()
      handleSelect(results[selectedIndex])
    }
  }

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Global Search</DialogTitle>
        <DialogDescription className="sr-only">Search products, parties, and transactions</DialogDescription>
        {/* Search input */}
        <div className="flex items-center gap-3 p-4 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search products, parties, transactions... or type a command"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none text-lg"
          />
          <Badge variant="outline" className="text-[10px]">Esc</Badge>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {quickNav.length > 0 && (
            <div className="p-2">
              <p className="text-[10px] uppercase text-muted-foreground font-medium px-2 py-1">Quick Actions</p>
              {quickNav.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.view === 'new-sale') {
                        setPreviousView(useAppStore.getState().currentView)
                      }
                      setView(item.view)
                      setSearchOpen(false)
                    }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition text-left"
                  >
                    <Icon className={cn('w-4 h-4', item.color)} />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground">{item.subtitle}</p>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}

          {q && results.length === 0 && (
            <div className="p-8 text-center">
              <Search className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium">No results for &quot;{query}&quot;</p>
              <p className="text-xs text-muted-foreground mt-1">Try searching by name, phone, invoice number, or SKU</p>
            </div>
          )}

          {q && results.length > 0 && (
            <div className="p-2">
              <p className="text-[10px] uppercase text-muted-foreground font-medium px-2 py-1">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
              {results.map((result, i) => {
                const Icon = result.icon
                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={cn(
                      'w-full flex items-center gap-3 p-2.5 rounded-lg transition text-left',
                      i === selectedIndex ? 'bg-primary/10' : 'hover:bg-muted'
                    )}
                  >
                    <Icon className={cn('w-4 h-4 flex-shrink-0', result.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{result.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{result.subtitle}</p>
                    </div>
                    {result.meta && (
                      <Badge variant="outline" className="text-[10px]">{result.meta}</Badge>
                    )}
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3 px-2">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
          <span className="px-2">Powered by BahiKhata Pro</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
