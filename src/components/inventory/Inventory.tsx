'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '@/hooks/use-translation'
import { useSetting } from '@/hooks/use-setting'
import { unitProfit, purchaseRateFromCost } from '@/lib/unit-profit'
import { gstStatus, chargesGstOnSales, claimsInputCredit } from '@/lib/shop-tax'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { useNewEntryRequest } from '@/hooks/use-new-entry-request'
import { toast as sonnerToast } from 'sonner'
import { formatINR, cn } from '@/lib/utils'
import { isService } from '@/lib/inventory-tracking'
import { ProductDialog } from './ProductDialog'
import { ExemptReclassifyReview } from './ExemptReclassifyReview'
import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import { ChipRow } from '@/components/common/ChipRow'
import { FocusChip } from '@/components/common/FocusChip'
import { ITEM_SORTS, NO_CATEGORY, type ItemChip, type ItemSort } from '@/lib/items-list'
import { useIsMobile } from '@/hooks/use-mobile'
import { EmptyState } from '@/components/common/EmptyState'
import { WakingUpState } from '@/components/common/WakingUpState'
import {
  Search, Package, AlertTriangle, Edit2, FolderOpen, X, ScanLine,
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
  // 🔒 R15-1/2/3 (Round 15): Inventory screen must respect hideProfit.
  // The /api/products endpoint returns purchasePrice + salePrice (staff need
  // them for billing), so the client must hide computed profit. Was: profit
  // displayed unconditionally → staff-with-hideProfit saw every product's
  // margin + the shop's total potential profit.
  const { hideProfit, setting } = useSetting()
  // #134/#165: a shop that charges no GST (not registered or composition)
  // keeps the whole price — same rule as line-items (lib/shop-tax.ts).
  const profitOpts = { chargesGst: chargesGstOnSales(gstStatus(setting)) }
  const [search, setSearch] = useState('')
  // Phase 5e-2: the group and the order are asked of the server, over every item.
  const [chip, setChip] = useState<ItemChip>('all')
  const [sort, setSort] = useState<ItemSort>('sales')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])
  // Phase 5e-4b: opened from an Insights group (lib/list-focus.ts). Out / Running low / Not sold in 90 days
  // arrive as this list's own chip; A / B / C / Not sold this period as a group the server narrows by.
  const listFocus = useAppStore((s) => s.listFocus)
  const setListFocus = useAppStore((s) => s.setListFocus)
  const focus = listFocus?.screen === 'items' && !listFocus.focus.startsWith('chip:') ? listFocus : null
  useEffect(() => {
    if (listFocus?.screen !== 'items') return
    // The group alone, as Insights counted it: no leftover search or category on top of it.
    setSearch('')
    setInventoryCategory(null)
    if (listFocus.focus.startsWith('chip:')) {
      setChip(listFocus.focus.slice(5) as ItemChip)
      setListFocus(null)
    } else {
      setChip('all')
    }
  }, [listFocus, setListFocus, setInventoryCategory])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [subCategory, setSubCategory] = useState<string | null>(null)
  const [barcodeOpen, setBarcodeOpen] = useState(false)

  /*
   * Phase 5e-2: the list comes from /api/products/list — 60 items at a time,
   * with every chip's count, the categories and the totals worked out over ALL
   * items on the server (lib/items-list.ts). It loaded up to 5,000 products and
   * worked these out here.
   */
  const { data: pages, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['items', chip, sort, debouncedSearch, inventoryCategory, focus?.focus, focus?.from, focus?.to, refreshKey],
    queryFn: async ({ pageParam }) => {
      const qp = new URLSearchParams({ chip, sort, offset: String(pageParam) })
      if (debouncedSearch) qp.set('search', debouncedSearch)
      if (inventoryCategory) qp.set('category', inventoryCategory)
      if (focus) {
        qp.set('focus', focus.focus)
        if (focus.from) qp.set('from', focus.from)
        if (focus.to) qp.set('to', focus.to)
      }
      const r = await offlineFetch(`/api/products/list?${qp}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    initialPageParam: 0,
    getNextPageParam: (last: any) => (last.hasMore ? last.offset + last.rows.length : undefined),
    placeholderData: (prev) => prev,
    retry: (count, err) => {
      if (err instanceof OfflineError) return false
      if (err instanceof TypeError) return false
      return count < 2
    },
  })
  const data = pages?.pages?.[0]
  const products: any[] = pages?.pages?.flatMap((pg: any) => pg.rows) ?? []
  const counts: Record<ItemChip, number> | undefined = data?.counts
  const totals: { items: number; stockValue: number | null; out: number; low: number; potentialProfit: number | null } | undefined = data?.totals

  // #264: one item opened to change its price (Insights → Cost went up) — open its form with the sale
  // price selected as soon as its row arrives, once per opening.
  const [priceFocus, setPriceFocus] = useState(false)
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!focus?.focus.startsWith('item:')) { openedFor.current = null; return }
    if (openedFor.current === focus.focus) return
    const row = products.find((p) => `item:${p.id}` === focus.focus)
    if (!row) return
    openedFor.current = focus.focus
    setEditingProduct(row)
    setPriceFocus(true)
    setDialogOpen(true)
  }, [focus, products])

  // Phase 5a-3: "Add Product" / + sheet "New item" from another screen.
  useNewEntryRequest('inventory', () => { setEditingProduct(null); setDialogOpen(true) })

  // Listen for global "New Entry" trigger from Header (only if it was fired on this view)
  const lastTriggerRef = useRef(triggerNewEntry)
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

  // The shop's categories, counts and figures — from the server, over every item.
  // A value is null for staff who may not see profit (stock value is at cost): shown as nothing, never ₹0.
  const serverCats: { name: string; count: number; value: number | null }[] = data?.categories ?? []
  const categories = serverCats.map((c) => c.name)
  const categoryCounts = new Map(serverCats.map((c) => [c.name, c.count] as const))
  const categoryValues = new Map(serverCats.map((c) => [c.name, c.value] as const))
  const filtered = products
  const lowStockCount = totals?.low ?? 0
  const outOfStockCount = totals?.out ?? 0
  const totalStockValue = totals?.stockValue ?? null
  const totalPotentialProfit = totals?.potentialProfit ?? null
  const itemCount = totals?.items ?? 0
  const n = (one: string, many: string, k: number) => t(k === 1 ? one : many).replace('{n}', String(k))
  const catLabel = (c: string) => (c === NO_CATEGORY ? t('items.no_category') : c)
  // A phone always gets the compact rows; the table is a wide-screen choice.
  const isMobile = useIsMobile()
  const viewMode = isMobile ? 'grid' : inventoryViewMode

  return (
    <div className="space-y-4">
      {/* Phase 5e-2 (ledger model v4): what the stock is worth, over every item — then the groups. */}
      <section className="rounded-2xl bg-card border border-border/60 shadow-card p-4">
        {isLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : totalStockValue !== null ? (
          <>
            <p className="text-xs text-muted-foreground">{t('dash.stock_value')}</p>
            <p className="text-2xl font-bold tabular-nums">{formatINR(totalStockValue)}</p>
            <p className="text-xs text-muted-foreground">
              {n('items.count_1', 'items.count_n', itemCount)}
              {/* 🔒 R15-1: never for staff who may not see profit (the server sends null). A loss is said as a loss. */}
              {totalPotentialProfit !== null && (
                <> · <span className={cn(totalPotentialProfit < 0 && 'text-bad font-semibold')}>
                  {t(totalPotentialProfit < 0 ? 'items.could_lose' : 'items.could_earn').replace('{v}', formatINR(Math.abs(totalPotentialProfit)))}
                </span></>
              )}
            </p>
          </>
        ) : (
          // Staff who may not see profit: stock value is at cost, so the count only — never a ₹0.
          <p className="text-2xl font-bold tabular-nums">{n('items.count_1', 'items.count_n', itemCount)}</p>
        )}
      </section>

      {/*
        * #94 — items classified under the cancelled exemption notification.
        * A thing to DO, so above the list; renders nothing when there is
        * nothing to review. Phase 1c-2: a shop that is not registered files
        * no GST, so its items need no GST-rules review.
        */}
      {gstStatus(setting) !== 'unregistered' && <ExemptReclassifyReview />}

      {focus && <FocusChip label={focus.label} onClear={() => setListFocus(null)} clearLabel={t('list.clear_focus')} />}

      <ChipRow
        ariaLabel={t('items.show')}
        value={chip}
        onChange={setChip}
        chips={(['all', 'low', 'out', 'dead'] as ItemChip[]).map((c) => ({ value: c, label: t(`items.chip.${c}`), count: counts?.[c] }))}
      />

      {/* Search, category, order. A category is a picker, not a wall of buttons: a shop with 80 categories still fits.
          #269: py-0 — the card's own padding doubled the content's (≈30 px of the first phone screen). */}
      <Card className="shadow-card border-border/60 py-0">
        <CardContent className="p-3 lg:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1 w-full min-w-0">
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
                  className="min-h-12 min-w-12 inline-flex items-center justify-center absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-muted text-primary"
                  aria-label="Scan barcode"
                  title="Scan barcode"
                >
                  <ScanLine className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="flex gap-3 items-center">
              <select
                aria-label={t('items.category')}
                value={inventoryCategory ?? ''}
                onChange={(e) => setInventoryCategory(e.target.value || null)}
                className="min-h-12 min-w-0 flex-1 sm:flex-none sm:w-44 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                <option value="">{t('items.all_categories')} · {itemCount}</option>
                {serverCats.map((c) => <option key={c.name} value={c.name}>{catLabel(c.name)} · {c.count}</option>)}
                {/* A category remembered from before that no longer has items still shows as chosen. */}
                {inventoryCategory && !categoryCounts.has(inventoryCategory) && <option value={inventoryCategory}>{catLabel(inventoryCategory)} · 0</option>}
              </select>
              <select
                aria-label={t('items.sort')}
                value={sort}
                onChange={(e) => setSort(e.target.value as ItemSort)}
                className="min-h-12 min-w-0 flex-1 sm:flex-none sm:w-44 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              >
                {ITEM_SORTS.filter((k) => !(hideProfit && (k === 'value' || k === 'profit'))).map((k) => <option key={k} value={k}>{t(`items.sort.${k}`)}</option>)}
              </select>
              {!isMobile && <ViewModeToggle mode={inventoryViewMode} onChange={setInventoryViewMode} />}
            </div>
          </div>

          {/* The chosen category: its count and what its stock is worth (never for staff who may not see it). */}
          {inventoryCategory && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="text-foreground font-medium truncate">{catLabel(inventoryCategory)}</span>
              <span className="shrink-0">
                · {n('items.count_1', 'items.count_n', categoryCounts.get(inventoryCategory) ?? 0)}
                {categoryValues.get(inventoryCategory) != null && <> · {t('items.worth').replace('{v}', formatINR(categoryValues.get(inventoryCategory) ?? 0))}</>}
              </span>
              <button onClick={() => setInventoryCategory(null)} aria-label={t('items.clear_category')} className="w-12 h-12 -my-3 ml-auto -mr-3 inline-flex items-center justify-center hover:text-foreground">
                <X className="w-4 h-4" aria-hidden />
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
            {itemCount === 0 && !debouncedSearch && !inventoryCategory && !focus ? (
              <EmptyState
                icon={Package}
                title={t('items.none')}
                description={t('items.none_hint')}
                action={{
                  label: 'Add Product',
                  onClick: () => { setEditingProduct(null); setDialogOpen(true) },
                }}
              />
            ) : (
              <EmptyState
                icon={Package}
                title={t('items.none_match')}
                description={t('items.none_match_hint')}
                size="compact"
              />
            )}
          </CardContent>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {filtered.map((p) => (
            <ProductRow key={p.id} product={p} sort={sort} onEdit={() => { setEditingProduct(p); setDialogOpen(true) }} />
          ))}
        </div>
      ) : (
        <Card className="shadow-card border-border/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-3 px-4 font-medium">Product</th>
                  {/* Cost and stock value at cost would reveal the margin: hidden like profit (they showed ₹0). */}
                  {!hideProfit && <th className="py-3 px-2 font-medium text-right">{t('inv.buy_price')}</th>}
                  <th className="py-3 px-2 font-medium text-right">{t('inv.sale_price')}</th>
                  <th className="py-3 px-2 font-medium text-right">Stock</th>
                  {!hideProfit && <th className="py-3 px-2 font-medium text-right">Value</th>}
                  {/* 🔒 R15-2 (Round 15): Hide Profit/unit column for hideProfit. */}
                  {!hideProfit && <th className="py-3 px-2 font-medium text-right">Profit/unit</th>}
                  <th className="py-3 px-2 font-medium text-center">Status</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const { profit, margin } = unitProfit(p, profitOpts)
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 group">
                      <td className="py-3 px-4">
                        <div className="font-medium">{p.name}</div>
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          {p.sku && <Badge variant="outline" className="text-xs py-0">{p.sku}</Badge>}
                          {p.category && <Badge variant="secondary" className="text-xs py-0">{p.category}</Badge>}
                          <Badge variant="outline" className="text-xs py-0">GST {p.gstRate}%</Badge>
                        </div>
                      </td>
                      {!hideProfit && <td className="py-3 px-2 text-right">{formatINR(p.purchasePrice)}</td>}
                      <td className="py-3 px-2 text-right">{formatINR(p.salePrice)}</td>
                      {/* A service has no stock number. Printing "0" in red
                          would be a fabricated fact — the same rule the money
                          sweep applied to ₹0 — so it prints an em dash. */}
                      <td className={cn('py-3 px-2 text-right font-medium',
                        isService(p) ? 'text-muted-foreground' :
                        p.currentStock <= 0 ? 'text-rose-600' :
                        p.isLowStock ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                      )}>
                        {isService(p)
                          ? <span title="Service — no stock is counted">—</span>
                          : <>{p.currentStock} <span className="text-xs text-muted-foreground">{p.unit}</span></>}
                      </td>
                      {!hideProfit && <td className="py-3 px-2 text-right">{isService(p) ? '—' : formatINR(p.stockValue)}</td>}
                      {/* 🔒 R15-2 (Round 15): Hide profit cell for hideProfit. */}
                      {!hideProfit && (
                        <td className={cn('py-3 px-2 text-right font-medium',
                          profit < 0 ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400')}>
                          {formatINR(profit)}
                          <span className="text-xs text-muted-foreground ml-1">({margin.toFixed(0)}%)</span>
                        </td>
                      )}
                      <td className="py-3 px-2 text-center">
                        {isService(p) ? (
                          <Badge variant="outline" className="text-xs">Service</Badge>
                        ) : p.isLowStock ? (
                          <Badge variant="destructive" className="text-xs">
                            {p.currentStock <= 0 ? 'Out' : 'Low'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:text-emerald-300">OK</Badge>
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
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setPriceFocus(false) }}
        product={editingProduct}
        focusField={priceFocus ? 'salePrice' : undefined}
        onSuccess={() => triggerRefresh()}
      />

      {hasNextPage && (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full min-h-12 rounded-xl border border-border text-sm font-semibold hover:bg-muted disabled:opacity-60"
        >
          {t('khata.more').replace('{n}', String(Math.min(60, (data?.matched ?? 0) - products.length))).replace('{m}', String(data?.matched ?? 0))}
        </button>
      )}

      {/* Barcode scanner — scan to search products by SKU/barcode */}
      {barcodeOpen && (
        <BarcodeScanner
          onScan={(code) => {
            // Barcode, then SKU, then exact name — see find-product-by-code.
            setSearch(code)
            setBarcodeOpen(false)
            // Check if any product matches
            // Ask the server (every item, not just the rows loaded): the same search rule, barcode first.
            offlineFetch(`/api/products/list?${new URLSearchParams({ search: code })}`).then((r) => r.json()).then((j) => {
              if (j.matched > 0) sonnerToast.success(`Found: ${j.rows[0].name}`)
              else sonnerToast.info(`No product matches barcode ${code}. You can add it as a new product.`)
            }).catch(() => {})
          }}
          onClose={() => setBarcodeOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * One item, one compact row (#200, Phase 5e-2): name and stock on top, price
 * and this month's sales below, with profit per unit — or the stock value when
 * the list is ordered by it, so the figure the list is sorted by is on the row.
 * The tall card it replaces showed three items on a phone screen.
 */
function ProductRow({ product: p, sort, onEdit }: { product: any; sort: ItemSort; onEdit: () => void }) {
  const { setView, setPreviousView } = useAppStore()
  const { t } = useTranslation()
  // 🔒 R15-3 (Round 15): profit never shows for staff who may not see it.
  const { hideProfit, setting } = useSetting()
  // #134: on the price BEFORE GST, same rule as the table and the bill screen.
  const { profit, margin } = unitProfit(p, { chargesGst: chargesGstOnSales(gstStatus(setting)) })
  // A service has no stock: no number, no low/out — a "0" would be a fabricated fact.
  const state = isService(p) ? 'service' : p.currentStock < 0 ? 'oversold' : p.currentStock <= 0 ? 'out' : p.isLowStock ? 'low' : 'ok'
  const tone = { service: 'text-muted-foreground', oversold: 'text-bad', out: 'text-bad', low: 'text-check', ok: 'text-foreground' }[state]
  const badge = { service: 'bg-muted text-muted-foreground', oversold: 'bg-bad-soft text-bad', out: 'bg-bad-soft text-bad', low: 'bg-check-soft text-check', ok: 'bg-primary/10 text-primary' }[state]

  // 🔒 DI-2 (auditor spec): oversold → New Purchase pre-filled with this
  // product and the shortfall quantity.
  const handleOversoldTap = () => {
    const shortfall = Math.abs(p.currentStock)
    ;(window as any).__ledgerPreset = {
      type: 'purchase',
      data: {
        items: [{
          productId: p.id,
          name: p.name,
          quantity: shortfall,
          unitPrice: purchaseRateFromCost(p, { claimsItc: claimsInputCredit(gstStatus(setting)) }),
          gstRate: p.gstRate || 0,
          unit: p.unit || 'pcs',
          // The stored cost is the before-GST figure (what profit and stock
          // value use), so this line states it rather than following the
          // bill's "rates include GST" switch (#135).
          priceIncludesGst: false,
        }],
      },
    }
    setPreviousView('inventory')
    setView('new-purchase')
  }

  const right = sort === 'value' && p.stockValue !== undefined && state !== 'service'
    ? <span className="tabular-nums shrink-0">{t('items.worth').replace('{v}', formatINR(p.stockValue))}</span>
    : sort === 'profit' && p.profitNow !== undefined
      ? <span className={cn('tabular-nums shrink-0 font-semibold', p.profitNow < 0 ? 'text-bad' : 'text-good')}>{t('items.profit_month').replace('{v}', formatINR(p.profitNow))}</span>
    : !hideProfit
      ? <span className={cn('tabular-nums shrink-0 font-semibold', profit < 0 ? 'text-bad' : 'text-good')}>{profit >= 0 ? '+' : ''}{formatINR(profit)} · {margin.toFixed(0)}%</span>
      : null

  return (
    <div className="rounded-xl bg-card border border-border/60 shadow-card">
      <button type="button" onClick={onEdit} className="w-full min-h-16 px-3 py-2.5 flex items-center gap-3 text-left rounded-xl hover:bg-muted/40 transition-colors">
        <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm', badge)} aria-hidden>
          {p.name?.charAt(0).toUpperCase() || <Package className="w-5 h-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-sm truncate">{p.name}</span>
            <span className={cn('text-sm font-bold tabular-nums shrink-0', tone)}>
              {state === 'service' ? t('items.service') : <>{p.currentStock} {p.unit}{(state === 'low' || state === 'out') && <> · {t(`items.${state}`)}</>}</>}
            </span>
          </span>
          <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground mt-0.5">
            <span className="truncate tabular-nums">
              {formatINR(p.salePrice)}
              {p.qtyNow > 0 && <> · {t('items.sold_month').replace('{n}', `${p.qtyNow} ${p.unit}`)}</>}
            </span>
            {right}
          </span>
        </span>
      </button>
      {state === 'oversold' && (
        <button
          type="button"
          onClick={handleOversoldTap}
          className="w-full min-h-12 border-t border-border/60 flex items-center justify-center gap-1.5 text-xs font-semibold text-bad hover:bg-bad-soft rounded-b-xl"
          aria-label={`Record a purchase to fix oversold ${p.name}`}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t('items.oversold').replace('{n}', `${Math.abs(p.currentStock)} ${p.unit || 'pcs'}`)}</span>
        </button>
      )}
    </div>
  )
}
