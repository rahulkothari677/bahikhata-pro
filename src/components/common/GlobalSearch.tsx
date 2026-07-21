'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Search, ArrowRight, ShoppingCart, Truck, Receipt } from 'lucide-react'
import { cn, formatINR, formatDate } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 6): GlobalSearch now renders commands from
// the NavRegistry, filtered by surfaces: ['global-search'].
import { NAV_REGISTRY, filterByPermissions, type NavDestination } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { useTranslation } from '@/hooks/use-translation'
import { useSession } from 'next-auth/react'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'

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
  const { t } = useTranslation()
  const { searchOpen, setSearchOpen, setView, setSelectedTransactionId, setSelectedPartyId, setPreviousView } = useAppStore()
  const { data: session } = useSession()
  const { canAccess } = useStaffPermissions()
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
    queryKey: ['parties'],
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
        icon: ShoppingCart,
        color: 'text-amber-600 dark:text-amber-400',
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
        icon: Truck,
        color: p.type === 'customer' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
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
        color: t.type === 'sale' ? 'text-emerald-600 dark:text-emerald-400' : t.type === 'purchase' ? 'text-amber-600 dark:text-amber-400' : 'text-violet-600',
      })
    })
  }

  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 6): Commands from NavRegistry, filtered by
  // surfaces: ['global-search']. Was: hardcoded allCommands array (13 items with
  // inline action functions). Now: registry-driven, with handleNavAction() for clicks.
  // 🔒 V26 N9: Apply filterByPermissions (was: raw filter — staff saw commands
  // for modules they can't access). Now: same filtering as every other surface.
  const isOwner = session?.user?.role === 'owner'
  const isFounder = useAppStore((s) => s.isFounder)
  const allCommands = useMemo(() => {
    return filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('global-search')),
      { canAccess, isFlagEnabled: (flag: string) => {
        const features = useAppStore.getState().features
        return features?.[flag as keyof typeof features] ?? false
      }, isOwner, isFounder }
    ).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isOwner, isFounder])

  // Filter commands by query — match label, description, or keywords.
  // 🔒 V26 N22: Also match the TRANSLATED label/description (via t(labelKey) /
  // t(descKey)) so a Hindi user typing the Hindi label they see gets a match.
  // Was: matched English `label`/`description`/`keywords` only — a Hindi user
  // typing "बिक्री" (the visible label) got no match.
  const filteredCommands = q
    ? allCommands.filter(c => {
        const ql = q.toLowerCase()
        const tLabel = c.labelKey ? t(c.labelKey) : c.label
        const tDesc = c.descKey ? t(c.descKey) : c.description
        return (
          c.label.toLowerCase().includes(ql) ||
          (c.description?.toLowerCase().includes(ql)) ||
          (c.keywords?.toLowerCase().includes(ql)) ||
          (tLabel && tLabel.toLowerCase().includes(ql)) ||
          (tDesc && tDesc.toLowerCase().includes(ql))
        )
      })
    : allCommands

  const handleSelect = (result: any) => {
    if (result.type === 'command') {
      // 🔒 AUDIT V25 §6.1 (Phase 6): Use shared handleNavAction for registry commands.
      // Was: inline action() functions per command. Now: single shared handler.
      const dest = result as NavDestination
      if (dest.actionKind === 'custom') {
        // Custom actions (none in GlobalSearch currently — all are navigate-based)
        return
      }
      handleNavAction(dest)
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
  // Convert NavDestination[] to a format compatible with the rendering
  const commandResults = filteredCommands.map(c => ({ type: 'command' as const, ...c }))
  const allResults = [...commandResults, ...results]

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
          <Badge variant="outline" className="text-3xs">Esc</Badge>
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
              {commandResults.length > 0 && (
                <>
                  <p className="text-3xs uppercase text-muted-foreground font-medium px-2 py-1">
                    {q ? 'Matching commands' : 'Quick Actions'}
                  </p>
                  {commandResults.map((cmd) => {
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
                        <Icon className={cn('w-4 h-4 flex-shrink-0', cmd.iconColor || 'text-muted-foreground')} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{cmd.labelKey ? t(cmd.labelKey) : cmd.label}</p>
                          <p className="text-2xs text-muted-foreground truncate">{cmd.descKey ? t(cmd.descKey) : cmd.description}</p>
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
                  <p className="text-3xs uppercase text-muted-foreground font-medium px-2 py-1 mt-2">
                    {results.length} search result{results.length !== 1 ? 's' : ''}
                  </p>
                  {results.map((result) => {
                    const globalIdx = allResults.indexOf(result)
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
                          <p className="text-2xs text-muted-foreground truncate">{result.subtitle}</p>
                        </div>
                        {result.meta && (
                          <Badge variant="outline" className="text-3xs">{result.meta}</Badge>
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
        <div className="p-2 border-t border-border flex items-center justify-between text-3xs text-muted-foreground">
          <div className="flex items-center gap-3 px-2">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
          <span className="px-2">Powered by EkBook</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
