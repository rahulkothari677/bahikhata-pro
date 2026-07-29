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

  // 🐛 FIX (audit 2026-07-28): search runs on the SERVER now.
  //
  // Was: three fetches on open — every product, every party, and the newest 200
  // transactions — then `.includes()` in the browser. Past 200 transactions
  // (about two weeks for a shop doing 20 bills a day) searching an older
  // invoice showed "No results", which reads as "that bill does not exist"
  // rather than "I only looked at the recent ones". It also shipped the shop's
  // whole catalogue to a phone on mobile data every time the box opened.
  //
  // Now: /api/search queries the database, which sees every row, and returns
  // at most five matches per type. See that route for the scale reasoning.
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Wait for a pause in typing before hitting the database. Without this, every
  // keystroke is a query — "sharma" would fire six.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(id)
  }, [query])

  const { data: searchData, isFetching: searchLoading, isError: searchFailed } = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: async () => {
      const r = await offlineFetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`)
      if (!r.ok) throw new Error('Search request failed')
      return r.json()
    },
    // Two characters is the server's floor as well; asking below it is wasted.
    enabled: searchOpen && debouncedQuery.length >= 2,
    // Results are cheap to re-fetch and stale ones are misleading after a sale.
    staleTime: 15_000,
    retry: 1,
  })

  const productsData = searchData
  const partiesData = searchData
  const txnData = searchData

  useEffect(() => {
    if (searchOpen) {
      Promise.resolve().then(() => {
        setQuery('')
        setDebouncedQuery('')
        setSelectedIndex(0)
        setTimeout(() => inputRef.current?.focus(), 100)
      })
    }
  }, [searchOpen])

  // Build search results
  const results: SearchResult[] = []
  const q = query.toLowerCase().trim()

  // No client-side filtering any more — the server already matched and capped
  // these. Re-filtering here would silently drop rows the database matched (the
  // two use different case rules), which is how a "search" starts lying again.
  if (q) {
    // Products
    ;(productsData?.products || []).forEach((p: any) => {
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
    ;(partiesData?.parties || []).forEach((p: any) => {
      results.push({
        type: 'party',
        id: p.id,
        title: p.name,
        subtitle: `${p.phone || 'No phone'} • ${p.type}`,
        // No balance badge: the search endpoint deliberately does not compute
        // party balances (it would mean aggregating every transaction on each
        // keystroke). Tapping through shows the real figure.
        meta: undefined,
        icon: Truck,
        color: p.type === 'customer' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
      })
    })

    // Transactions
    ;(txnData?.transactions || []).forEach((t: any) => {
      results.push({
        type: 'transaction',
        id: t.id,
        title: t.invoiceNo || `${t.type} - ${t.party?.name || 'Walk-in'}`,
        subtitle: `${t.party?.name || 'Walk-in'} • ${formatDate(t.date)} • ${t.itemCount ?? 0} items`,
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
          {/* 🐛 FIX (audit 2026-07-28): "No results" must mean NO RESULTS.
              Previously this branch also covered "still loading" and "the
              request failed", so a slow connection or a database blip told the
              shopkeeper their bill did not exist. Each state now says what is
              actually happening. */}
          {searchFailed && q ? (
            <div className="p-8 text-center">
              <Search className="w-8 h-8 mx-auto text-destructive/50 mb-2" />
              <p className="text-sm font-medium">Search isn&apos;t working right now</p>
              <p className="text-xs text-muted-foreground mt-1">
                This is a connection problem, not a missing record. Please try again.
              </p>
            </div>
          ) : searchLoading && q ? (
            <div className="p-8 text-center">
              <Search className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2 animate-pulse" />
              <p className="text-sm font-medium">Searching…</p>
            </div>
          ) : allResults.length === 0 && q ? (
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
