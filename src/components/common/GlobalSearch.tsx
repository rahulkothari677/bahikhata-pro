'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, ShoppingCart, Truck, Package, Users, Receipt, ArrowRight, TrendingUp, IndianRupee, LayoutDashboard, Wallet, FileBarChart, Settings, Plus, UserPlus, ScanLine, Bell } from 'lucide-react'
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

  // All available commands — shown when no query, filtered when typing
  const allCommands = [
    // Actions (create new)
    { type: 'command', id: 'cmd-new-sale', title: 'New Sale', subtitle: 'Record a new sale transaction', icon: ShoppingCart, color: 'text-emerald-600', keywords: 'new sale create add record', action: () => { setPreviousView(useAppStore.getState().currentView); setView('new-sale') } },
    { type: 'command', id: 'cmd-new-purchase', title: 'New Purchase', subtitle: 'Record a new stock purchase', icon: Truck, color: 'text-amber-600', keywords: 'new purchase create add record buy stock', action: () => { setPreviousView(useAppStore.getState().currentView); setView('new-purchase') } },
    { type: 'command', id: 'cmd-add-product', title: 'Add Product', subtitle: 'Add a new product to inventory', icon: Plus, color: 'text-violet-600', keywords: 'add new product create inventory item', action: () => { setView('inventory') } },
    { type: 'command', id: 'cmd-add-party', title: 'Add Customer/Supplier', subtitle: 'Add a new party', icon: UserPlus, color: 'text-blue-600', keywords: 'add new customer supplier party create', action: () => { setView('parties') } },
    { type: 'command', id: 'cmd-scan', title: 'Scan Bill with AI', subtitle: 'Snap a bill photo, auto-fill data', icon: ScanLine, color: 'text-amber-600', keywords: 'scan bill ai camera photo ocr', action: () => { setView('scanner') } },
    // Navigation (go to)
    { type: 'command', id: 'cmd-dashboard', title: 'Go to Dashboard', subtitle: 'View overview & charts', icon: LayoutDashboard, color: 'text-primary', keywords: 'dashboard home overview charts stats kpi', action: () => { setView('dashboard') } },
    { type: 'command', id: 'cmd-sales', title: 'Go to Sales Ledger', subtitle: 'View all sales transactions', icon: ShoppingCart, color: 'text-emerald-600', keywords: 'sales ledger transactions history', action: () => { setView('sales') } },
    { type: 'command', id: 'cmd-purchases', title: 'Go to Purchase Ledger', subtitle: 'View all purchase transactions', icon: Truck, color: 'text-amber-600', keywords: 'purchases ledger transactions buy stock', action: () => { setView('purchases') } },
    { type: 'command', id: 'cmd-inventory', title: 'Go to Inventory', subtitle: 'Manage products & stock', icon: Package, color: 'text-violet-600', keywords: 'inventory products stock items', action: () => { setView('inventory') } },
    { type: 'command', id: 'cmd-parties', title: 'Go to Parties', subtitle: 'Customers & suppliers', icon: Users, color: 'text-blue-600', keywords: 'parties customers suppliers dues balance', action: () => { setView('parties') } },
    { type: 'command', id: 'cmd-income', title: 'Go to Income & Expense', subtitle: 'Record rent, salary, other income', icon: Wallet, color: 'text-emerald-600', keywords: 'income expense rent salary money', action: () => { setView('income-expense') } },
    { type: 'command', id: 'cmd-reports', title: 'Go to Reports', subtitle: 'P&L, GST, stock reports', icon: FileBarChart, color: 'text-rose-600', keywords: 'reports gst pl profit loss stock analysis', action: () => { setView('reports') } },
    { type: 'command', id: 'cmd-settings', title: 'Go to Settings', subtitle: 'Shop profile, features, theme', icon: Settings, color: 'text-slate-600', keywords: 'settings profile theme features configuration', action: () => { setView('settings') } },
  ]

  // Filter commands by query — match title, subtitle, or keywords
  const filteredCommands = q
    ? allCommands.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        c.keywords.toLowerCase().includes(q)
      )
    : allCommands

  const handleSelect = (result: any) => {
    if (result.type === 'command') {
      result.action()
      setSearchOpen(false)
    } else if (result.type === 'product') {
      setPreviousView(useAppStore.getState().currentView)
      setView('inventory')
      setSearchOpen(false)
    } else if (result.type === 'party') {
      setSelectedPartyId(result.id)
      setPreviousView(useAppStore.getState().currentView)
      setView('party-profile')
      setSearchOpen(false)
    } else if (result.type === 'transaction') {
      setSelectedTransactionId(result.id)
      setPreviousView(useAppStore.getState().currentView)
      setView('transaction-detail')
      setSearchOpen(false)
    }
  }

  // Combined list: commands first, then search results
  const allResults = [...filteredCommands, ...results]

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      e.preventDefault()
      handleSelect(allResults[selectedIndex])
    }
  }

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="max-w-2xl w-[95vw] sm:w-full p-0 gap-0 overflow-hidden">
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

        {/* Results — unified list of commands + search results */}
        <div className="max-h-96 overflow-y-auto">
          {allResults.length === 0 && q ? (
            <div className="p-8 text-center">
              <Search className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium">No results for &quot;{query}&quot;</p>
              <p className="text-xs text-muted-foreground mt-1">Try searching by name, phone, invoice number, or SKU</p>
            </div>
          ) : (
            <div className="p-2">
              {/* Commands section */}
              {filteredCommands.length > 0 && (
                <>
                  <p className="text-[10px] uppercase text-muted-foreground font-medium px-2 py-1">
                    {q ? 'Matching commands' : 'Quick Actions'}
                  </p>
                  {filteredCommands.map((cmd) => {
                    const globalIdx = allResults.indexOf(cmd)
                    const Icon = cmd.icon
                    return (
                      <button
                        key={cmd.id}
                        onClick={() => handleSelect(cmd)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        className={cn(
                          'w-full flex items-center gap-3 p-2.5 rounded-lg transition text-left',
                          globalIdx === selectedIndex ? 'bg-primary/10' : 'hover:bg-muted'
                        )}
                      >
                        <Icon className={cn('w-4 h-4 flex-shrink-0', cmd.color)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{cmd.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{cmd.subtitle}</p>
                        </div>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      </button>
                    )
                  })}
                </>
              )}

              {/* Search results section */}
              {results.length > 0 && (
                <>
                  <p className="text-[10px] uppercase text-muted-foreground font-medium px-2 py-1 mt-2">
                    {results.length} search result{results.length !== 1 ? 's' : ''}
                  </p>
                  {results.map((result) => {
                    const globalIdx = allResults.indexOf(result) + filteredCommands.length
                    const Icon = result.icon
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        className={cn(
                          'w-full flex items-center gap-3 p-2.5 rounded-lg transition text-left',
                          globalIdx === selectedIndex ? 'bg-primary/10' : 'hover:bg-muted'
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
                </>
              )}
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
